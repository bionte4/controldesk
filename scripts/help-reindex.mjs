#!/usr/bin/env node
/**
 * Regenerate `src/lib/help/embeddings.json` for the "Ask ControlDesk"
 * chatbot (Fase 3 RAG upgrade).
 *
 * Run this whenever `src/lib/help/articles.ts` (the manifest) OR any
 * of the referenced markdown files changes. The output is a static
 * asset that ships with the app — retrieval runs against it without
 * calling the embedding API at request time.
 *
 * ## Usage
 *
 *   HELP_EMBEDDING_API_KEY=... pnpm help:reindex        # regenerate all
 *   HELP_EMBEDDING_API_KEY=... pnpm help:reindex --dry  # print plan only
 *
 * Falls back to `GOOGLE_GENERATIVE_AI_API_KEY` if the dedicated var
 * is not set (matches the same fallback that runtime code uses in
 * `src/lib/help/embeddings.ts`).
 *
 * ## Idempotence
 *
 * Each entry is content-hashed. Unchanged articles are copied
 * verbatim from the previous index file so we don't burn quota on
 * re-embedding stable content. Only new / edited / removed rows
 * touch the API.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { embed } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import matter from "gray-matter";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const INDEX_PATH = path.join(REPO_ROOT, "src/lib/help/embeddings.json");
const MANIFEST_PATH = path.join(REPO_ROOT, "src/lib/help/articles.ts");

const MODEL_ID = "gemini-embedding-001";
// `gemini-embedding-001` returns 3072-dim vectors by default. It's
// trained with Matryoshka Representation, so truncating to a prefix
// preserves most of the retrieval quality at a fraction of the size.
// 768 keeps the on-disk index ~400 KB vs ~1.5 MB for the full vector.
const DIM = 768;
// Cap the input at ~2 KB per article — enough for the title +
// summary + a strong signal from the body head, well under the
// model's 2048-token max. Longer excerpts don't help retrieval
// and would waste quota on boilerplate.
const MAX_INPUT_CHARS = 2000;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry") || args.includes("--dry-run");

const apiKey =
  process.env.HELP_EMBEDDING_API_KEY?.trim() ||
  process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
if (!apiKey && !DRY_RUN) {
  console.error(
    "help-reindex: set HELP_EMBEDDING_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY " +
      "before running (Google AI Studio → API keys).",
  );
  process.exit(2);
}

/**
 * Parse the manifest source instead of importing the TS module — the
 * script runs under plain node without a bundler. Regex-based
 * extraction is enough because the manifest is a flat literal.
 */
async function loadManifest() {
  const src = await readFile(MANIFEST_PATH, "utf8");
  // Grab the HELP_MANIFEST array literal.
  const start = src.indexOf("HELP_MANIFEST: readonly HelpArticleManifestEntry[]");
  if (start < 0) throw new Error("Manifest constant not found in articles.ts");
  const arrOpen = src.indexOf("[", start);
  const arrClose = src.indexOf("];", arrOpen);
  const arr = src.slice(arrOpen + 1, arrClose);

  const entries = [];
  const entryRe =
    /\{\s*slug:\s*"([^"]+)"\s*,\s*category:\s*"([^"]+)"\s*,\s*source:\s*"([^"]+)"([\s\S]*?)\}\s*,?/g;
  let m;
  while ((m = entryRe.exec(arr)) !== null) {
    const [, slug, category, source, tail] = m;
    const titleOverrideMatch = /titleOverride:\s*"([^"]+)"/.exec(tail);
    const summaryOverrideMatch = /summaryOverride:\s*"([^"]+)"/.exec(tail);
    entries.push({
      slug,
      category,
      source,
      titleOverride: titleOverrideMatch?.[1],
      summaryOverride: summaryOverrideMatch?.[1],
    });
  }
  if (entries.length === 0) {
    throw new Error("Parsed manifest is empty — regex probably broke.");
  }
  return entries;
}

function stripMarkdown(md) {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>|~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirstHeading(md) {
  const lines = md.split("\n");
  let seen = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    seen += 1;
    if (line.startsWith("#")) {
      return line.replace(/^#+\s*/, "").trim() || null;
    }
    if (seen > 20) break;
  }
  return null;
}

function extractFirstParagraph(md) {
  const lines = md.split("\n");
  const buf = [];
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const trimmed = line.trim();
    if (!trimmed) {
      if (buf.length) break;
      continue;
    }
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith(">")) continue;
    buf.push(trimmed);
    if (buf.join(" ").length > 200) break;
  }
  if (!buf.length) return null;
  const joined = buf.join(" ").replace(/\*+/g, "").replace(/`/g, "");
  return joined.length > 200 ? `${joined.slice(0, 197).trimEnd()}…` : joined;
}

async function hydrate(entry) {
  const abs = path.join(REPO_ROOT, entry.source);
  const raw = await readFile(abs, "utf8");
  const parsed = matter(raw);
  const frontmatterTitle =
    typeof parsed.data.title === "string" ? parsed.data.title : null;
  const frontmatterSummary =
    typeof parsed.data.summary === "string" ? parsed.data.summary : null;
  const title =
    entry.titleOverride ??
    frontmatterTitle ??
    extractFirstHeading(parsed.content) ??
    entry.slug;
  const summary =
    entry.summaryOverride ??
    frontmatterSummary ??
    extractFirstParagraph(parsed.content) ??
    "";
  const body = stripMarkdown(parsed.content);

  // Concatenation strategy: title + summary carry the most signal
  // per token; body tail is padding for niche terminology. Truncated
  // at MAX_INPUT_CHARS to keep quota usage predictable.
  const composed = [title, summary, body].filter(Boolean).join("\n\n");
  const input = composed.slice(0, MAX_INPUT_CHARS);
  return { entry, title, summary, input };
}

function hashInput(input) {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function normalize(v) {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v.slice();
  return v.map((x) => x / norm);
}

async function main() {
  const manifest = await loadManifest();
  console.log(`help-reindex: parsed ${manifest.length} manifest entries.`);

  // Load previous index for idempotent skipping.
  let previous = { modelId: MODEL_ID, dim: DIM, entries: [] };
  try {
    previous = JSON.parse(await readFile(INDEX_PATH, "utf8"));
  } catch {
    // Missing / malformed — treat as empty.
  }
  const previousByHash = new Map();
  if (previous.modelId === MODEL_ID && previous.dim === DIM) {
    for (const e of previous.entries) {
      previousByHash.set(`${e.slug}:${e.contentHash}`, e);
    }
  }

  const hydrated = [];
  for (const entry of manifest) {
    try {
      hydrated.push(await hydrate(entry));
    } catch (err) {
      console.error(
        `help-reindex: hydrate failed for ${entry.slug} (${entry.source}): ${err?.message ?? err}`,
      );
      process.exit(3);
    }
  }

  const plan = hydrated.map((h) => ({
    slug: h.entry.slug,
    source: h.entry.source,
    contentHash: hashInput(h.input),
    input: h.input,
  }));

  const toEmbed = plan.filter(
    (p) => !previousByHash.has(`${p.slug}:${p.contentHash}`),
  );
  const reused = plan.length - toEmbed.length;

  console.log(
    `help-reindex: ${plan.length} articles · ${reused} reused · ${toEmbed.length} to embed`,
  );

  if (DRY_RUN) {
    for (const p of plan) {
      const status = previousByHash.has(`${p.slug}:${p.contentHash}`)
        ? "REUSE"
        : "EMBED";
      console.log(`  [${status}] ${p.slug}  (${p.contentHash})`);
    }
    return;
  }

  if (toEmbed.length === 0) {
    console.log("help-reindex: nothing to do — index is already current.");
    return;
  }

  const provider = createGoogleGenerativeAI({ apiKey });
  const modelFactory =
    typeof provider.embedding === "function"
      ? provider.embedding
      : provider.textEmbeddingModel;
  const model = modelFactory.call(provider, MODEL_ID);

  const embedded = [];
  for (const p of toEmbed) {
    process.stdout.write(`  embedding ${p.slug}... `);
    try {
      const result = await embed({ model, value: p.input });
      if (!Array.isArray(result.embedding)) {
        throw new Error("Non-array embedding returned");
      }
      // Truncate + re-normalise per Matryoshka guidance from the
      // gemini-embedding-001 card. The prefix carries most of the
      // retrieval signal; truncating without renormalising would
      // slightly bias cosine similarity toward high-magnitude prefixes.
      if (result.embedding.length < DIM) {
        throw new Error(
          `Vector shorter than expected: got ${result.embedding.length}, need ≥ ${DIM}.`,
        );
      }
      const vector = normalize(result.embedding.slice(0, DIM));
      embedded.push({
        slug: p.slug,
        source: p.source,
        input: p.input,
        vector,
        contentHash: p.contentHash,
      });
      console.log("ok");
    } catch (err) {
      console.log("FAIL");
      console.error(`    reason: ${err?.message ?? err}`);
      process.exit(4);
    }
  }

  // Merge reused + newly-embedded entries in manifest order.
  const merged = plan.map((p) => {
    const reused = previousByHash.get(`${p.slug}:${p.contentHash}`);
    if (reused) return reused;
    return embedded.find((e) => e.slug === p.slug);
  });

  const output = {
    modelId: MODEL_ID,
    dim: DIM,
    generatedAt: new Date().toISOString(),
    entries: merged,
  };
  await writeFile(INDEX_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`help-reindex: wrote ${INDEX_PATH} (${merged.length} entries).`);
}

main().catch((err) => {
  console.error("help-reindex: fatal:", err);
  process.exit(1);
});
