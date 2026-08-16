#!/usr/bin/env node
/**
 * One-off backfill for the Knowledge Base RAG index.
 *
 * `publishKnowledgeArticleAction` schedules an embedding reindex
 * via `next/server` `after()` in the happy path, but that only
 * covers articles published AFTER the RAG integration shipped.
 * This script fills the gap for:
 *
 *   1. Articles whose `status = 'PUBLISHED'` but have no row in
 *      `knowledge_article_embeddings` — published before Fase 2
 *      landed, or the `after()` hook silently failed at publish
 *      time (e.g. Gemini API was down).
 *   2. Articles whose latest embedding was written under a
 *      different `model_id` — used when we bump the embedding
 *      model version and want the corpus on the new one.
 *
 * Run against staging first, then production. Use `--dry-run` to
 * preview without touching Gemini or the DB.
 *
 * ## Env
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   HELP_EMBEDDING_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY)
 *
 * ## Flags
 *   --dry-run   List work without writing anything.
 *   --force     Re-embed EVERY published article, not just the
 *               stale/missing subset. Use after a prompt template
 *               change or content-model shift.
 *   --verbose   Print each article's slug as we go.
 */
import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");
const VERBOSE = process.argv.includes("--verbose");
const FORCE = process.argv.includes("--force");

// Must match `src/lib/help/embeddings.ts::EMBEDDING_MODEL_ID` and
// `EMBEDDING_DIM`. Duplicated here because scripts don't run through
// the Next.js path alias resolver — plain node.
const EMBEDDING_MODEL_ID = "gemini-embedding-001";
const EMBEDDING_DIM = 768;
const MAX_INPUT_CHARS = 20_000;

function l2normalize(v) {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v.slice();
  return v.map((x) => x / norm);
}

async function embed(text, apiKey) {
  // Use the same Google Generative AI package the server code does
  // so the vector geometry matches. Dynamic import so the script
  // starts cheap when `--dry-run`.
  const [{ createGoogleGenerativeAI }, { embed: sdkEmbed }] = await Promise.all(
    [import("@ai-sdk/google"), import("ai")],
  );
  const provider = createGoogleGenerativeAI({ apiKey });
  const model =
    typeof provider.embedding === "function"
      ? provider.embedding(EMBEDDING_MODEL_ID)
      : provider.textEmbeddingModel(EMBEDDING_MODEL_ID);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const result = await sdkEmbed({
      model,
      value: text,
      abortSignal: controller.signal,
    });
    if (!Array.isArray(result.embedding)) return null;
    if (result.embedding.length < EMBEDDING_DIM) return null;
    return l2normalize(result.embedding.slice(0, EMBEDDING_DIM));
  } finally {
    clearTimeout(timer);
  }
}

function buildInput(article) {
  const parts = [article.title];
  if (article.summary && article.summary.trim().length > 0) {
    parts.push(article.summary);
  }
  parts.push(article.body_md.slice(0, MAX_INPUT_CHARS));
  return parts.join("\n\n");
}

async function reindexOne(supabase, apiKey, article) {
  const input = buildInput(article);
  const vector = await embed(input, apiKey);
  if (!vector) throw new Error("empty_vector");
  const { error: delErr } = await supabase
    .from("knowledge_article_embeddings")
    .delete()
    .eq("article_id", article.id);
  if (delErr && VERBOSE) {
    console.warn(`  warn: clear failed for ${article.slug}: ${delErr.message}`);
  }
  const { error: insErr } = await supabase
    .from("knowledge_article_embeddings")
    .insert({
      tenant_id: article.tenant_id,
      article_id: article.id,
      chunk_index: 0,
      content: input.slice(0, 4_000),
      embedding: vector,
      model_id: EMBEDDING_MODEL_ID,
    });
  if (insErr) throw new Error(insErr.message);
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exit(1);
  }
  const apiKey =
    process.env.HELP_EMBEDDING_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey && !DRY_RUN) {
    console.error(
      "Missing HELP_EMBEDDING_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY " +
        "(required unless --dry-run).",
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: articles, error: articleErr } = await supabase
    .from("knowledge_articles")
    .select("id, tenant_id, slug, title, summary, body_md")
    .eq("status", "PUBLISHED");
  if (articleErr) {
    console.error("Failed to list articles:", articleErr.message);
    process.exit(1);
  }
  if (!articles || articles.length === 0) {
    console.log("No published articles found. Nothing to do.");
    return;
  }

  const { data: embeddings, error: embErr } = await supabase
    .from("knowledge_article_embeddings")
    .select("article_id, model_id");
  if (embErr) {
    console.error("Failed to list embeddings:", embErr.message);
    process.exit(1);
  }

  const byArticle = new Map();
  for (const row of embeddings ?? []) {
    const cur = byArticle.get(row.article_id);
    if (!cur) byArticle.set(row.article_id, [row.model_id]);
    else cur.push(row.model_id);
  }

  const missing = [];
  const stale = [];
  const ok = [];
  for (const art of articles) {
    const models = byArticle.get(art.id);
    if (!models || models.length === 0) missing.push(art);
    else if (!models.includes(EMBEDDING_MODEL_ID)) stale.push(art);
    else ok.push(art);
  }

  console.log(`Published articles:   ${articles.length}`);
  console.log(`  · already indexed:  ${ok.length}`);
  console.log(`  · missing index:    ${missing.length}`);
  console.log(`  · stale model:      ${stale.length}`);

  const todo = FORCE ? articles : [...missing, ...stale];
  if (todo.length === 0) {
    console.log("Nothing to reindex.");
    return;
  }

  if (DRY_RUN) {
    console.log(`\nDRY RUN — would reindex ${todo.length} article(s).`);
    for (const a of todo) console.log(`  - ${a.slug}`);
    return;
  }

  console.log(`\nReindexing ${todo.length} article(s)…`);
  let success = 0;
  let failed = 0;
  for (const art of todo) {
    try {
      await reindexOne(supabase, apiKey, art);
      success++;
      if (VERBOSE) console.log(`  ✓ ${art.slug}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${art.slug}: ${err?.message ?? err}`);
    }
  }
  console.log(`\nDone. success=${success} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
