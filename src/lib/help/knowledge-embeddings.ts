import "server-only";

import { log } from "@/lib/observability/log";
import { createServiceRoleClient } from "@/lib/supabase/server";

import { EMBEDDING_DIM, EMBEDDING_MODEL_ID, normalize } from "./embeddings";

/**
 * Write-side of the tenant Knowledge Base RAG loop.
 *
 * This module owns the `knowledge_article_embeddings` table:
 *   - `reindexKnowledgeArticle(articleId)` — compute the embedding
 *     for a single published article and upsert it. Called from the
 *     publish / update / restore Server Actions via `next/server`
 *     `after()` so the mutation returns immediately and the reader
 *     doesn't wait ~500ms for Gemini to respond.
 *   - `dropKnowledgeArticleEmbeddings(articleId)` — clear the rows
 *     when an article is archived. We don't want archived content
 *     to keep surfacing in RAG results.
 *
 * ## Why a single chunk per article (MVP)
 *
 * Articles in this KB are typically 500–5000 chars. That comfortably
 * fits into a single embedding call (Gemini accepts up to ~30k
 * chars). Storing one chunk keeps the retriever's dedupe-by-article
 * logic in `knowledge-retrieval.ts` a no-op and avoids over-tuning
 * before we've seen how the corpus actually grows.
 *
 * When to chunk: articles routinely exceed ~4k chars OR retrieval
 * accuracy starts dropping because the "best chunk" scoring loses
 * signal against the article as a whole. At that point, split by
 * heading blocks with ~200 char overlap and keep the same
 * `chunk_index` unique constraint.
 *
 * ## Failure semantics
 *
 * Every function here is best-effort. The Server Action that
 * schedules the reindex has already committed the DB change; if
 * embedding fails, the article still exists, just isn't indexed.
 * We log a warning and move on. A backfill script (`pnpm
 * knowledge:reindex`) can re-run against any published article that
 * doesn't have an up-to-date row.
 */

const EMBED_TIMEOUT_MS = 15_000;
const MAX_INPUT_CHARS = 20_000;

/**
 * Truncate an article body to something the embedding provider can
 * handle. Gemini's own limit is well above 20k chars but longer
 * articles carry mostly diminishing information for retrieval —
 * the beginning of a knowledge article is the highest-signal
 * region anyway (title, summary, opening paragraphs).
 */
function buildEmbedInput(article: {
  title: string;
  summary: string | null;
  body_md: string;
}): string {
  const bodyPreview = article.body_md.slice(0, MAX_INPUT_CHARS);
  const parts = [article.title];
  if (article.summary && article.summary.trim().length > 0) {
    parts.push(article.summary);
  }
  parts.push(bodyPreview);
  return parts.join("\n\n");
}

/**
 * Load and return an embedding for the given text. Cloned from the
 * repo-side `embedQuery` in `embeddings.ts` but with a longer
 * timeout — writes can afford to wait a bit longer than
 * request-time queries.
 */
async function embedForWrite(input: string): Promise<number[] | null> {
  const apiKey =
    process.env.HELP_EMBEDDING_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);
  try {
    // Direct static imports so Next.js's file tracer bundles the SDK.
    // Same rationale as `embeddings.ts`.
    const [{ createGoogleGenerativeAI }, { embed }] = await Promise.all([
      import("@ai-sdk/google"),
      import("ai"),
    ]);
    const provider = createGoogleGenerativeAI({ apiKey });
    const model =
      typeof (provider as { embedding?: unknown }).embedding === "function"
        ? (
            provider as unknown as {
              embedding: (id: string) => unknown;
            }
          ).embedding(EMBEDDING_MODEL_ID)
        : (
            provider as unknown as {
              textEmbeddingModel: (id: string) => unknown;
            }
          ).textEmbeddingModel(EMBEDDING_MODEL_ID);
    const result = await embed({
      model: model as Parameters<typeof embed>[0]["model"],
      value: input,
      abortSignal: controller.signal,
    });
    if (!Array.isArray(result.embedding)) return null;
    if (result.embedding.length < EMBEDDING_DIM) {
      log.warn("knowledge_embed_short_vector", {
        got: result.embedding.length,
        expected: EMBEDDING_DIM,
      });
      return null;
    }
    return normalize(result.embedding.slice(0, EMBEDDING_DIM));
  } catch (err) {
    log.info("knowledge_embed_call_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Compute + persist the embedding for a single article. Idempotent
 * — safe to call repeatedly against the same article; the delete-
 * then-insert pattern ensures we never have stale + fresh chunks
 * competing.
 *
 * Only PUBLISHED articles are embedded. Drafts stay out of the
 * chatbot's reach on purpose (a half-written SOP surfacing in AI
 * answers would be worse than no answer).
 *
 * The client is escalated to service-role because migration 0095
 * intentionally has NO user-role INSERT policy on
 * `knowledge_article_embeddings` — index writes are a background
 * job concern, not user surface. The escalation is safe here
 * because:
 *   - This module is `server-only` (import fails from a client
 *     component).
 *   - The caller identifies the article by id; we still load
 *     `tenant_id` from the row and stamp it on the insert so
 *     tenant isolation is preserved.
 *   - Failures are swallowed — this is the "best effort" contract.
 */
export async function reindexKnowledgeArticle(
  articleId: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data: article, error: loadErr } = await supabase
    .from("knowledge_articles")
    .select("id, tenant_id, slug, title, summary, body_md, status")
    .eq("id", articleId)
    .maybeSingle();
  if (loadErr) {
    log.info("knowledge_reindex_load_failed", {
      article_id: articleId,
      error: loadErr.message,
    });
    return;
  }
  if (!article) {
    // Article gone (deleted by another actor between publish and reindex).
    // Nothing to embed. If any orphan embeddings existed, the cascade
    // delete on the FK would have removed them.
    return;
  }
  if (article.status !== "PUBLISHED") {
    // Draft or archived — clear any stale rows and skip embedding.
    // Draft rows may have been marked draft again after a prior
    // publish; keeping their old embedding would leak un-published
    // content into RAG.
    await supabase
      .from("knowledge_article_embeddings")
      .delete()
      .eq("article_id", articleId);
    return;
  }

  const input = buildEmbedInput(article);
  const vector = await embedForWrite(input);
  if (!vector) {
    log.info("knowledge_reindex_no_embedding", {
      article_id: articleId,
      slug: article.slug,
    });
    return;
  }

  // Delete + insert in two calls. A true UPSERT-with-vector is
  // marginally faster but a delete-first pattern makes it trivial
  // to transition to multi-chunk later — just insert N rows
  // instead of one.
  const { error: delErr } = await supabase
    .from("knowledge_article_embeddings")
    .delete()
    .eq("article_id", articleId);
  if (delErr) {
    log.info("knowledge_reindex_clear_failed", {
      article_id: articleId,
      error: delErr.message,
    });
    // Continue — the insert will likely still succeed unless we hit
    // the unique constraint on (article_id, chunk_index). Worst
    // case: two chunk-0 rows for one article, and the retriever's
    // dedupe-by-article pass drops the loser.
  }

  const { error: insErr } = await supabase
    .from("knowledge_article_embeddings")
    .insert({
      tenant_id: article.tenant_id,
      article_id: articleId,
      chunk_index: 0,
      content: input.slice(0, 4_000),
      embedding: vector,
      model_id: EMBEDDING_MODEL_ID,
    });
  if (insErr) {
    log.info("knowledge_reindex_insert_failed", {
      article_id: articleId,
      error: insErr.message,
    });
    return;
  }

  log.info("knowledge_reindex_done", {
    article_id: articleId,
    slug: article.slug,
    tenant_id: article.tenant_id,
    model_id: EMBEDDING_MODEL_ID,
    input_chars: input.length,
  });
}

/**
 * Drop every embedding row for the given article — used when an
 * article is archived so it stops leaking into RAG. Safe to call
 * against articles that never had embeddings (no rows → no-op).
 */
export async function dropKnowledgeArticleEmbeddings(
  articleId: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("knowledge_article_embeddings")
    .delete()
    .eq("article_id", articleId);
  if (error) {
    log.info("knowledge_embeddings_drop_failed", {
      article_id: articleId,
      error: error.message,
    });
  }
}
