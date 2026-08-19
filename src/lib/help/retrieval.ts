import "server-only";

import Fuse from "fuse.js";
import { cache } from "react";

import { log } from "@/lib/observability/log";

import { loadAllHelpArticles, type HelpArticle } from "./articles";
import {
  embedQuery,
  loadEmbeddingIndex,
  rankByVector,
} from "./embeddings";
import {
  retrieveTenantKnowledge,
  type TenantHit,
} from "./knowledge-retrieval";

/**
 * Server-side retrieval for the "Ask ControlDesk" chatbot.
 *
 * ## Two-tier retrieval (Fase 3 RAG upgrade)
 *
 *   1. **Embedding-first** — if `HELP_EMBEDDING_API_KEY` (or the
 *      `GOOGLE_GENERATIVE_AI_API_KEY` fallback) is configured AND
 *      `src/lib/help/embeddings.json` has entries, embed the query
 *      with `gemini-embedding-001`, rank by cosine similarity, and
 *      return the top-N. Catches paraphrased questions the keyword
 *      layer would miss ("bagaimana cara nagih kliennya?" →
 *      "invoice / client billing").
 *   2. **Keyword fallback** — if embedding fails (no key, timeout,
 *      empty index, provider error), fall back to fuse.js. Zero-
 *      infra, still catches domain-specific vocabulary matches, and
 *      keeps `/help/ask` working even when embeddings are down.
 *
 * Fuse remains authoritative for the client-side `/help` browse tab.
 * The two-tier switch only happens on the server-side retrieval used
 * by the chatbot.
 *
 * ## Why keep Fuse at all
 *
 *   • Embeddings can't beat exact-match on jargon like
 *     "APPROVAL_IDLE_24H" or module route paths like "/finance/
 *     cash-advances".
 *   • Also acts as a hot backup — the chatbot degrades to still-
 *     useful when the embedding provider is down.
 */

const EXCERPT_LENGTH = 800;

export type RetrievedArticle = {
  /**
   * Citation-friendly slug. For repo articles this is the plain
   * help slug (e.g. `overview`); for tenant articles it's the
   * `kb-`-prefixed form so the client renderer can route citations
   * to the right route (`/knowledge/{slug}` vs `/help/{slug}`).
   * The chat prompt teaches the LLM to emit this exact string.
   */
  slug: string;
  title: string;
  category: HelpArticle["category"] | "tenant";
  /** Compact excerpt for the LLM system prompt. */
  excerpt: string;
  /** Full source path for the citation link in the assistant reply. */
  source: string;
  /** Which retrieval tier picked this article — used in telemetry. */
  retrievalMode: "embedding" | "keyword" | "manifest";
  /**
   * Whether this hit came from the repo-authored `HELP_MANIFEST`
   * corpus or the tenant-authored `knowledge_articles` table. Kept
   * separate from `retrievalMode` so the citation renderer can
   * decide the destination URL without inspecting the slug string.
   */
  origin: "repo" | "tenant";
};

/**
 * Memoised fuse.js index per request. `loadAllHelpArticles()` is also
 * memoised, so the two together mean we pay the "build the index"
 * cost once per request even if `retrieveContext()` is called from
 * multiple places.
 */
const buildIndex = cache(async () => {
  const articles = await loadAllHelpArticles();
  const enriched = articles.map((a) => ({
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    category: a.category,
    body: stripMarkdown(a.markdown),
    source: a.source,
  }));
  const fuse = new Fuse(enriched, {
    keys: [
      { name: "title", weight: 2 },
      { name: "summary", weight: 1.2 },
      { name: "body", weight: 0.6 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
    minMatchCharLength: 2,
    includeScore: true,
  });
  return { fuse, byId: new Map(enriched.map((e) => [e.slug, e])) };
});

/**
 * Return up to `limit` articles most relevant to the user's question,
 * each with a short excerpt anchored around the top scoring section.
 *
 * When the query is too short to be meaningful (< 3 characters after
 * trimming), we fall back to the first `limit` articles in manifest
 * order — those are the highest-level product docs and are the right
 * default context for "what is ControlDesk?" style openers.
 *
 * `opts.includeTenant` toggles the tenant Knowledge Base merge. When
 * true, we ALSO query `knowledge_articles` for the caller's tenant
 * (RLS-scoped) and interleave the hits with repo hits. Callers set
 * this to `true` inside authenticated routes (`/api/help/ask`,
 * `/api/help/rag`) where the Supabase session is available.
 */
export async function retrieveContext(
  query: string,
  limit = 3,
  opts?: { includeTenant?: boolean },
): Promise<RetrievedArticle[]> {
  const trimmed = query.trim();

  if (trimmed.length < 3) {
    const all = await loadAllHelpArticles();
    return all.slice(0, limit).map((a) => ({
      slug: a.slug,
      title: a.title,
      category: a.category,
      excerpt: excerptAround(stripMarkdown(a.markdown), null),
      source: a.source,
      retrievalMode: "manifest" as const,
      origin: "repo" as const,
    }));
  }

  // ---------------------------------------------------------------
  // Step 1 — semantic (embedding) pass. Try repo AND tenant so both
  // pools can compete on the same cosine-score scale. Either can
  // return an empty list without invalidating the other.
  // ---------------------------------------------------------------
  const embeddingIndex = loadEmbeddingIndex();
  const queryVector =
    embeddingIndex !== null ? await embedQuery(trimmed) : null;

  const [repoEmbedHits, tenantEmbedHits] = await Promise.all([
    queryVector && embeddingIndex
      ? tryRepoEmbeddingRetrieval({
          index: embeddingIndex,
          queryVector,
          trimmed,
          limit: limit * 2,
        })
      : Promise.resolve<RetrievedArticle[] | null>(null),
    opts?.includeTenant
      ? retrieveTenantKnowledge({
          query: trimmed,
          queryVector,
          limit: limit * 2,
        }).then(tenantHitsToRetrievedArticles)
      : Promise.resolve<RetrievedArticle[]>([]),
  ]);

  const embedResults = interleaveByOrigin(
    repoEmbedHits ?? [],
    tenantEmbedHits,
    limit,
  );
  if (embedResults.length === limit) return embedResults;

  // ---------------------------------------------------------------
  // Step 2 — keyword fallback for anything embedding didn't fill.
  // Fuse handles repo prose; the tenant keyword scan handles the KB
  // side. We fill the remaining slot(s) from either source, again
  // interleaved so a single strong tenant match doesn't crowd out
  // every repo doc (or vice versa).
  // ---------------------------------------------------------------
  const remaining = limit - embedResults.length;
  if (remaining <= 0) return embedResults;

  const { fuse } = await buildIndex();
  const fuseHits = fuse.search(trimmed, { limit: remaining * 2 });
  const repoKeyword: RetrievedArticle[] = fuseHits.map(({ item }) => ({
    slug: item.slug,
    title: item.title,
    category: item.category,
    excerpt: excerptAround(item.body, trimmed),
    source: item.source,
    retrievalMode: "keyword" as const,
    origin: "repo" as const,
  }));

  // Only re-run tenant keyword when the embedding pass didn't
  // return anything for tenant — otherwise we'd double-count.
  const tenantKeyword: RetrievedArticle[] =
    opts?.includeTenant && tenantEmbedHits.length === 0
      ? await retrieveTenantKnowledge({
          query: trimmed,
          queryVector: null,
          limit: remaining * 2,
        }).then(tenantHitsToRetrievedArticles)
      : [];

  const alreadySlugs = new Set(embedResults.map((r) => r.slug));
  const keywordFill = interleaveByOrigin(
    repoKeyword.filter((r) => !alreadySlugs.has(r.slug)),
    tenantKeyword.filter((r) => !alreadySlugs.has(r.slug)),
    remaining,
  );

  return [...embedResults, ...keywordFill];
}

/**
 * Interleave repo + tenant results, preferring the higher-scoring
 * source at each slot but never letting one side monopolise the
 * output. Sequence for a `limit=3` mixed pool is: repo, tenant,
 * repo (or vice versa when tenant scores higher first). Prevents
 * "the tenant KB shadowed the built-in docs entirely" complaints
 * without needing an explicit priority knob.
 */
function interleaveByOrigin(
  repo: RetrievedArticle[],
  tenant: RetrievedArticle[],
  limit: number,
): RetrievedArticle[] {
  if (repo.length === 0) return tenant.slice(0, limit);
  if (tenant.length === 0) return repo.slice(0, limit);

  const out: RetrievedArticle[] = [];
  let ri = 0;
  let ti = 0;
  // Start with whichever source had a stronger #1 — repo hits have
  // no numeric score attached here, so we simply preserve the
  // stable "repo first, then tenant" order. This favours the
  // canonical product docs when both sides have equally-good hits.
  while (out.length < limit && (ri < repo.length || ti < tenant.length)) {
    if (ri < repo.length) out.push(repo[ri++]!);
    if (out.length >= limit) break;
    if (ti < tenant.length) out.push(tenant[ti++]!);
  }
  return out;
}

function tenantHitsToRetrievedArticles(
  hits: TenantHit[],
): RetrievedArticle[] {
  return hits.map((h) => ({
    slug: h.citationSlug,
    title: h.title,
    category: "tenant" as const,
    excerpt: excerptAroundTenant(h),
    source: h.sourcePath,
    retrievalMode: h.retrievalMode,
    origin: "tenant" as const,
  }));
}

/**
 * Excerpt builder for tenant hits — the KB body is already stored
 * as a "chunk" so we mostly just clip to the excerpt budget.
 * Prefixing with the summary (when present) gives the LLM a compact
 * frame before the raw prose.
 */
function excerptAroundTenant(hit: TenantHit): string {
  const frame = hit.summary ? `${hit.summary}\n\n` : "";
  const bodyBudget = Math.max(0, EXCERPT_LENGTH - frame.length - 1);
  const bodyClip =
    hit.body.length > bodyBudget
      ? `${hit.body.slice(0, bodyBudget - 1)}…`
      : hit.body;
  return `${frame}${bodyClip}`;
}

/**
 * Rank repo articles against a pre-computed query vector. Extracted
 * from the old `tryEmbeddingRetrieval` so callers can share ONE
 * embedding call between the repo pass and the tenant pass — Gemini
 * embeddings cost real money at scale, and each `retrieveContext`
 * invocation only needs one query vector regardless of how many
 * corpora we search against.
 *
 * A `null` / empty return is the signal to `retrieveContext()` to
 * fall through to keyword search. We never throw — the chatbot must
 * stay responsive even when the semantic layer is degraded.
 */
async function tryRepoEmbeddingRetrieval(input: {
  index: NonNullable<ReturnType<typeof loadEmbeddingIndex>>;
  queryVector: number[];
  trimmed: string;
  limit: number;
}): Promise<RetrievedArticle[] | null> {
  const { index, queryVector, trimmed, limit } = input;
  const { byId } = await buildIndex();
  const ranked = rankByVector(index, queryVector, limit);
  if (ranked.length === 0) return null;

  log.info("help_retrieval_embedding", {
    query_chars: trimmed.length,
    hits: ranked.map((r) => ({
      slug: r.entry.slug,
      score: Number(r.score.toFixed(3)),
    })),
  });

  const results: RetrievedArticle[] = [];
  for (const { entry } of ranked) {
    const article = byId.get(entry.slug);
    if (!article) continue;
    results.push({
      slug: article.slug,
      title: article.title,
      category: article.category,
      excerpt: excerptAround(article.body, trimmed),
      source: article.source,
      retrievalMode: "embedding",
      origin: "repo",
    });
  }
  return results;
}

/**
 * Strip fenced code, headings, and inline markdown so fuse can match
 * on the underlying prose. Also collapses whitespace which keeps the
 * fuzzy match tolerant of docs formatting drift.
 */
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>|~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Grab a window of text around the first occurrence of any word in
 * the query. Falls back to the head of the article. Kept short so
 * three articles worth of excerpts stay well under the LLM context
 * budget (~2400 chars total for 3× 800).
 */
function excerptAround(body: string, query: string | null): string {
  if (body.length <= EXCERPT_LENGTH) return body;
  if (!query) return `${body.slice(0, EXCERPT_LENGTH - 1)}…`;
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  const lowered = body.toLowerCase();
  let pivot = -1;
  for (const w of words) {
    const idx = lowered.indexOf(w);
    if (idx >= 0 && (pivot < 0 || idx < pivot)) pivot = idx;
  }
  if (pivot < 0) return `${body.slice(0, EXCERPT_LENGTH - 1)}…`;
  const start = Math.max(0, pivot - Math.floor(EXCERPT_LENGTH / 3));
  const end = Math.min(body.length, start + EXCERPT_LENGTH);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return `${prefix}${body.slice(start, end).trim()}${suffix}`;
}
