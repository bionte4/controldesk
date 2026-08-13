import "server-only";

import { cache } from "react";

import { log } from "@/lib/observability/log";

import indexJson from "./embeddings.json" with { type: "json" };

/**
 * Embedding-based semantic retrieval for the help center + chatbot.
 *
 * ## Design (Fase 3 RAG upgrade)
 *
 *   • **Index is precomputed** and committed at
 *     `src/lib/help/embeddings.json`. Regenerate with
 *     `pnpm help:reindex` whenever the help manifest or article
 *     bodies change. Deterministic, no build-time API dep, no
 *     first-request cold path.
 *   • **Query embedding** is computed at request time using the
 *     same model that produced the index (see `EMBEDDING_MODEL_ID`
 *     below). The API key comes from a dedicated env var
 *     `HELP_EMBEDDING_API_KEY`, falling back to
 *     `GOOGLE_GENERATIVE_AI_API_KEY`. Rationale: embeddings are a
 *     system-level concern (search infra), not per-tenant — every
 *     tenant benefits from the same index regardless of which chat
 *     provider they picked in `/settings/integrations/ai`.
 *   • **Graceful fallback**: if the key is missing OR the embed
 *     call fails, callers get `null` and the retrieval layer falls
 *     back to keyword search (`retrieval.ts`). No hard failure,
 *     just a quality downgrade.
 *   • **No cross-tenant data**: articles are static repo content.
 *     Nothing to leak here.
 */

/** Must match the model used to generate `embeddings.json`. */
export const EMBEDDING_MODEL_ID = "gemini-embedding-001";

/**
 * `gemini-embedding-001` is Matryoshka-trained: the first N dims of
 * the full 3072-dim vector preserve most of the retrieval quality.
 * We truncate to 768 to keep the on-disk index (~400 KB) small.
 * The runtime `embedQuery` MUST apply the same truncation +
 * renormalisation so query and index share a comparable geometry.
 */
export const EMBEDDING_DIM = 768;

export type IndexEntry = {
  /** Article slug from the help manifest. Deep-linkable at `/help/{slug}`. */
  slug: string;
  /** Which manifest source produced this vector — kept for cache-invalidation debugging. */
  source: string;
  /**
   * Concatenated text that was embedded: `title\n\nsummary\n\n{first N chars of body}`.
   * Sent as-is to `embed()` for the query at retrieval time (well, a similar
   * concatenation of the user's message).
   */
  input: string;
  /** Unit-normalised vector. */
  vector: number[];
  /** Content hash — helps `pnpm help:reindex` skip unchanged rows. */
  contentHash: string;
};

type IndexFile = {
  modelId: string;
  dim: number;
  generatedAt: string;
  entries: IndexEntry[];
};

/**
 * Cache the parsed index per request. `import ... with { type: "json" }`
 * is already static, but we still normalise the shape here.
 */
export const loadEmbeddingIndex = cache((): IndexFile | null => {
  const file = indexJson as unknown as Partial<IndexFile>;
  if (!file || !Array.isArray(file.entries) || file.entries.length === 0) {
    return null;
  }
  if (file.modelId !== EMBEDDING_MODEL_ID) {
    log.warn("help_index_model_mismatch", {
      expected: EMBEDDING_MODEL_ID,
      actual: file.modelId ?? "unknown",
    });
    return null;
  }
  return file as IndexFile;
});

/**
 * Cosine similarity between two vectors. Assumes both are the SAME
 * length; we don't guard against shape mismatch here — if it ever
 * happens the index is corrupt and callers must reindex.
 *
 * Since we store unit-normalised vectors in the index, this is
 * equivalent to a plain dot product; we still compute the norm of
 * `b` in case the caller forgot to normalise the query vector.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normB += bv * bv;
  }
  if (normB === 0) return 0;
  return dot / Math.sqrt(normB);
}

/**
 * L2-normalise a vector in place-of-return. Written non-destructively
 * so callers can pass a raw API response without worrying about
 * ownership.
 */
export function normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return v.slice();
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i += 1) out[i] = v[i]! / norm;
  return out;
}

/**
 * Embed a single query string. Returns `null` on any failure —
 * caller falls back to keyword search. Bounded to a 6 s timeout so
 * a slow embedding provider doesn't stall the chatbot indefinitely.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  const apiKey =
    process.env.HELP_EMBEDDING_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    // Direct static imports — same reasoning as resolver.ts / verify.ts:
    // Next.js's file tracer must include the SDK in the standalone bundle.
    const [{ createGoogleGenerativeAI }, { embed }] = await Promise.all([
      import("@ai-sdk/google"),
      import("ai"),
    ]);
    const provider = createGoogleGenerativeAI({ apiKey });
    // `provider.textEmbeddingModel` was renamed to `embedding` between
    // majors; support both by narrowing at runtime. `EmbeddingModelV4`
    // has no methods we depend on directly — the AI SDK's `embed()`
    // consumes it opaquely.
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
      value: trimmed,
      abortSignal: controller.signal,
    });
    if (!Array.isArray(result.embedding)) return null;
    if (result.embedding.length < EMBEDDING_DIM) {
      log.warn("help_embed_query_short_vector", {
        got: result.embedding.length,
        expected: EMBEDDING_DIM,
      });
      return null;
    }
    // Truncate + normalise so query geometry matches the on-disk index.
    return normalize(result.embedding.slice(0, EMBEDDING_DIM));
  } catch (err) {
    log.info("help_embed_query_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Rank index entries against a query vector, returning the top-N by
 * cosine similarity. Ties broken deterministically by slug.
 */
export function rankByVector(
  index: IndexFile,
  queryVector: number[],
  limit: number,
): Array<{ entry: IndexEntry; score: number }> {
  const scored = index.entries.map((entry) => ({
    entry,
    score: cosineSimilarity(queryVector, entry.vector),
  }));
  scored.sort((a, b) => {
    if (b.score === a.score) return a.entry.slug.localeCompare(b.entry.slug);
    return b.score - a.score;
  });
  return scored.slice(0, limit);
}
