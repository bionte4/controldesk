import "server-only";

import {
  loadVisibilityContext,
  resolveVisibilityFilter,
} from "@/lib/data/knowledge-articles";
import { log } from "@/lib/observability/log";
import { createClient } from "@/lib/supabase/server";

import {
  cosineSimilarity,
  EMBEDDING_DIM,
  EMBEDDING_MODEL_ID,
} from "./embeddings";

/**
 * Tenant-Knowledge-Base retrieval — the writable counterpart to the
 * repo-authored `HELP_MANIFEST` search in `retrieval.ts`.
 *
 * ## Where this fits
 *
 * The chatbot's `retrieveContext()` (in `retrieval.ts`) calls
 * `retrieveTenantKnowledge()` alongside its repo lookup and merges
 * the results. Both paths return the same `RetrievedArticle`-shaped
 * rows so the merge stays trivial.
 *
 * ## Retrieval strategy
 *
 *   1. **Embedding-first** — if the caller has a query vector AND
 *      the tenant has embeddings in `knowledge_article_embeddings`,
 *      cosine-rank against those and return the top-N chunks. The
 *      writer job (`knowledge-embeddings.ts`) only stores rows
 *      tagged with the current `EMBEDDING_MODEL_ID`, so we skip
 *      rows whose model differs (the reindex script's job).
 *
 *   2. **Keyword fallback** — no embeddings or embedding failed
 *      upstream: use a plain LIKE-based full-text-ish scan. Not as
 *      good as a Postgres tsvector, but MVP-adequate for a
 *      new-tenant KB with < 100 articles. Upgrade path: add
 *      `to_tsvector('simple', title || body_md)` + a GIN index in
 *      a follow-up migration when volumes justify.
 *
 * ## RLS + visibility ACL
 *
 * Every read here runs under the caller's Supabase session (the one
 * built by `createClient()` from cookies). Two guard layers apply:
 *
 *   1. RLS policies from migration 0095 filter tenant + draft/
 *      archived scope. Only PUBLISHED articles are tenant-wide;
 *      drafts stay hidden unless the caller is the author or an
 *      admin. Draft leakage to the chatbot would surface WIP
 *      content — deliberate to keep publish-as-gate meaningful.
 *
 *   2. Visibility ACL from Fase 2c: ROLE_GATED / PROJECT_SCOPED
 *      articles are further narrowed via `resolveVisibilityFilter`.
 *      Both retrieval paths (embedding + keyword) first resolve the
 *      caller's visible article-id set, then constrain the actual
 *      retrieval query to that set. Non-visible articles never
 *      surface as chatbot citations even if they matched the
 *      semantic query.
 *
 * Embedding rows inherit visibility indirectly — the reindex writer
 * runs under service role and re-populates on publish, so a
 * newly-restricted article's embeddings survive until archive drops
 * them. The `.in("article_id", visibleIds)` constraint below closes
 * the gap without waiting for a reindex.
 *
 * ## Citation slug convention
 *
 * Tenant slugs are returned with a `kb-` prefix in `citationSlug`
 * (e.g. `kb-onboarding-checklist`). The chat prompt teaches the LLM
 * to emit this exact form so the client renderer can route
 * citations to `/knowledge/{slug}` instead of `/help/{slug}`.
 * `slug` and `sourcePath` keep the un-prefixed value for use inside
 * this module.
 */

export type TenantKnowledgeArticle = {
  /** Un-prefixed article slug (URL path segment on `/knowledge`). */
  slug: string;
  /** Prefixed slug used when citing in the LLM answer. */
  citationSlug: string;
  title: string;
  summary: string | null;
  /** Stripped, single-line markdown body — safe to concat with other excerpts. */
  body: string;
  /** Deep-link path — `/knowledge/{slug}`. */
  sourcePath: string;
};

export type TenantHit = TenantKnowledgeArticle & {
  /**
   * Retrieval score (0-1). Cosine similarity when embeddings match,
   * a coarse token-overlap score in keyword-fallback mode.
   */
  score: number;
  /** Which retrieval path picked this hit — kept for telemetry parity with repo hits. */
  retrievalMode: "embedding" | "keyword";
};

const KB_CITATION_PREFIX = "kb-";

/**
 * Resolve the set of PUBLISHED article ids visible to the current
 * caller under the Fase 2c visibility ACL. Returns `null` for admins
 * (unrestricted — skip the `.in()` constraint) and a possibly-empty
 * array otherwise.
 *
 * Cheap: single ID-only query with the same `.or()` clause the data
 * layer builds on every list. For a tenant with 500 published
 * articles the payload is ~20 KB and the query hits the
 * `(tenant_id, published_at)` index directly.
 */
async function resolveVisibleArticleIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string[] | null> {
  const ctx = await loadVisibilityContext();
  if (ctx.isAdmin) return null;
  const filter = resolveVisibilityFilter(ctx);
  let q = supabase
    .from("knowledge_articles")
    .select("id")
    .eq("status", "PUBLISHED");
  if (filter) q = q.or(filter);
  const { data, error } = await q;
  if (error || !data) {
    // Failing closed: an error resolving visibility should NEVER
    // widen the set. Returning an empty allowlist means the caller
    // sees no chatbot citations from tenant KB — worse UX than a
    // partial answer, better than a leak.
    log.info("knowledge_retrieval_visibility_resolution_failed", {
      error: error?.message ?? "empty",
    });
    return [];
  }
  return data.map((r) => r.id);
}

/**
 * Build a citation slug from a raw KB slug. The `kb-` namespace is
 * reserved for tenant articles and short-enough that it doesn't hit
 * the 60-char citation regex ceiling in the ask-ai renderer.
 */
export function toKnowledgeCitationSlug(slug: string): string {
  return `${KB_CITATION_PREFIX}${slug}`;
}

/**
 * Parse a citation slug back to its (namespace, slug) pair. Returns
 * `null` for repo citations (no `kb-` prefix) so callers can pattern-
 * match the shape:
 *
 *   const parsed = parseKnowledgeCitation(citation);
 *   if (parsed) href = `/knowledge/${parsed.slug}`;
 *   else if (allowlist.has(citation)) href = `/help/${citation}`;
 */
export function parseKnowledgeCitation(
  citation: string,
): { slug: string } | null {
  if (!citation.startsWith(KB_CITATION_PREFIX)) return null;
  const slug = citation.slice(KB_CITATION_PREFIX.length);
  if (slug.length === 0) return null;
  return { slug };
}

/**
 * Query tenant-authored KB for the top-N articles relevant to the
 * user's question.
 *
 * `queryVector` MUST be produced by the same model the embeddings
 * were written with (`EMBEDDING_MODEL_ID`) and MUST be the same
 * length (`EMBEDDING_DIM`). Callers get the vector from
 * `embedQuery()` in `embeddings.ts`; that helper already truncates
 * + normalises, so passing it through as-is is correct.
 *
 * When `queryVector` is `null` (no key configured, provider down),
 * we fall through to keyword scan on the article rows themselves.
 * The tenant experience degrades gracefully from "semantic" to
 * "substring match" instead of "no results".
 */
export async function retrieveTenantKnowledge({
  query,
  queryVector,
  limit,
}: {
  query: string;
  queryVector: number[] | null;
  limit: number;
}): Promise<TenantHit[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) return [];

  const supabase = await createClient();

  // Resolve the visible-article ID set once. Both retrieval paths
  // consume it: embedding restricts the chunk scan, keyword
  // restricts the substring scan. Admins bypass — the helper
  // returns `null` and `resolveVisibleArticleIds` short-circuits.
  const visibleIds = await resolveVisibleArticleIds(supabase);
  // Empty non-null set means the caller can see no PUBLISHED
  // articles at all — retrieving anything is pointless. Non-null
  // covers the "regular employee with a tenant that only has
  // ROLE_GATED HR articles the employee isn't scoped to" edge.
  if (visibleIds !== null && visibleIds.length === 0) return [];

  // Fast path: no embeddings capability. Skip straight to keyword.
  if (
    !queryVector ||
    queryVector.length !== EMBEDDING_DIM
  ) {
    return retrieveByKeyword(supabase, trimmedQuery, limit, visibleIds);
  }

  // Embedding path. We over-fetch (`limit * 4`) so a subsequent
  // dedupe-by-article step can pick the best chunk per article
  // without missing the winner because two of its chunks pushed a
  // valid runner-up out of the initial slice.
  const perArticleOverfetch = Math.max(limit * 4, 12);
  let embedQ = supabase
    .from("knowledge_article_embeddings")
    .select(
      `
      article_id,
      chunk_index,
      content,
      embedding,
      model_id,
      article:knowledge_articles!knowledge_article_embeddings_article_id_fkey (
        slug,
        title,
        summary,
        status
      )
    `,
    )
    .eq("model_id", EMBEDDING_MODEL_ID)
    .limit(perArticleOverfetch * 6);
  if (visibleIds !== null) {
    embedQ = embedQ.in("article_id", visibleIds);
  }
  const { data: embeddingRows, error } = await embedQ;

  if (error) {
    log.info("knowledge_retrieval_embedding_query_failed", {
      error: error.message,
    });
    return retrieveByKeyword(supabase, trimmedQuery, limit, visibleIds);
  }
  if (!embeddingRows || embeddingRows.length === 0) {
    // Tenant hasn't been indexed yet — fall through to keyword so
    // brand-new drafts published in the last 30 seconds are still
    // reachable while the reindex catches up.
    return retrieveByKeyword(supabase, trimmedQuery, limit, visibleIds);
  }

  type Scored = {
    articleSlug: string;
    articleTitle: string;
    articleSummary: string | null;
    score: number;
    content: string;
  };
  const scored: Scored[] = [];
  for (const row of embeddingRows) {
    // The `article` join comes back as an array-shape when Postgrest
    // can't prove single-cardinality. `!inner`-flavoured joins would
    // fix that but our FK constraint is enough — we just take the
    // first row defensively.
    const art = Array.isArray(row.article) ? row.article[0] : row.article;
    if (!art || art.status !== "PUBLISHED") continue;
    const vec = row.embedding as unknown;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) continue;
    // Cast: DB rows arrive as `number[]` from jsonb.
    const score = cosineSimilarity(queryVector, vec as number[]);
    scored.push({
      articleSlug: art.slug,
      articleTitle: art.title,
      articleSummary: art.summary,
      score,
      content: row.content,
    });
  }

  // Collapse per-article — the highest-scoring chunk wins; other
  // chunks of the same article are dropped so the LLM's context
  // window doesn't fill up with three chunks of one article and
  // starve everything else.
  const bestPerArticle = new Map<string, Scored>();
  for (const s of scored) {
    const cur = bestPerArticle.get(s.articleSlug);
    if (!cur || s.score > cur.score) {
      bestPerArticle.set(s.articleSlug, s);
    }
  }

  const sorted = Array.from(bestPerArticle.values()).sort((a, b) => {
    if (b.score === a.score) return a.articleSlug.localeCompare(b.articleSlug);
    return b.score - a.score;
  });

  const top = sorted.slice(0, limit);
  log.info("knowledge_retrieval_embedding", {
    query_chars: trimmedQuery.length,
    hits: top.map((h) => ({
      slug: h.articleSlug,
      score: Number(h.score.toFixed(3)),
    })),
  });

  return top.map((h) => ({
    slug: h.articleSlug,
    citationSlug: toKnowledgeCitationSlug(h.articleSlug),
    title: h.articleTitle,
    summary: h.articleSummary,
    body: h.content,
    sourcePath: `/knowledge/${h.articleSlug}`,
    score: h.score,
    retrievalMode: "embedding",
  }));
}

/**
 * Keyword fallback — plain LIKE match on title / summary / body_md
 * across published articles the caller can see. Not fancy, but it
 * beats "nothing" when the semantic index isn't up.
 *
 * Scoring is a rough weight: 3 for a title hit, 2 for summary, 1 for
 * body. Ties broken deterministically by slug so results are stable
 * across identical queries.
 */
async function retrieveByKeyword(
  supabase: Awaited<ReturnType<typeof createClient>>,
  query: string,
  limit: number,
  visibleIds: readonly string[] | null,
): Promise<TenantHit[]> {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 6);
  if (words.length === 0) return [];

  // Build an ilike OR — PostgREST needs each clause as a separate
  // `.or()` string. For 6 words × 3 fields = 18 clauses, still fast
  // for < 100 rows.
  const clauses = words.flatMap((w) => {
    const escaped = w.replace(/[\\%_]/g, (c) => `\\${c}`);
    return [
      `title.ilike.%${escaped}%`,
      `summary.ilike.%${escaped}%`,
      `body_md.ilike.%${escaped}%`,
    ];
  });

  let q = supabase
    .from("knowledge_articles")
    .select("slug, title, summary, body_md, status")
    .eq("status", "PUBLISHED")
    .or(clauses.join(","))
    .limit(limit * 3);
  if (visibleIds !== null) {
    q = q.in("id", visibleIds);
  }
  const { data, error } = await q;

  if (error || !data) {
    log.info("knowledge_retrieval_keyword_query_failed", {
      error: error?.message ?? "empty",
    });
    return [];
  }

  const scored = data.map((row) => {
    const title = row.title.toLowerCase();
    const summary = (row.summary ?? "").toLowerCase();
    const body = row.body_md.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (title.includes(w)) score += 3;
      if (summary.includes(w)) score += 2;
      if (body.includes(w)) score += 1;
    }
    return { row, score };
  });

  scored.sort((a, b) => {
    if (b.score === a.score) return a.row.slug.localeCompare(b.row.slug);
    return b.score - a.score;
  });

  return scored
    .filter((s) => s.score > 0)
    .slice(0, limit)
    .map(({ row, score }) => ({
      slug: row.slug,
      citationSlug: toKnowledgeCitationSlug(row.slug),
      title: row.title,
      summary: row.summary,
      body: stripKbMarkdown(row.body_md),
      sourcePath: `/knowledge/${row.slug}`,
      score,
      retrievalMode: "keyword" as const,
    }));
}

/**
 * Same stripping recipe as `retrieval.ts::stripMarkdown` — duplicated
 * intentionally: this file has to run without importing the module-
 * level `HELP_MANIFEST` load (which pulls filesystem + cache), so it
 * ships its own tiny copy rather than reaching across.
 */
function stripKbMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>|~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
