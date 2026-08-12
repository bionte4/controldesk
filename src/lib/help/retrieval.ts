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
  slug: string;
  title: string;
  category: HelpArticle["category"];
  /** Compact excerpt for the LLM system prompt. */
  excerpt: string;
  /** Full source path for the citation link in the assistant reply. */
  source: string;
  /** Which retrieval tier picked this article — used in telemetry. */
  retrievalMode: "embedding" | "keyword" | "manifest";
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
 */
export async function retrieveContext(
  query: string,
  limit = 3,
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
    }));
  }

  const embedHits = await tryEmbeddingRetrieval(trimmed, limit);
  if (embedHits) return embedHits;

  const { fuse } = await buildIndex();
  const hits = fuse.search(trimmed, { limit });
  return hits.map(({ item }) => ({
    slug: item.slug,
    title: item.title,
    category: item.category,
    excerpt: excerptAround(item.body, trimmed),
    source: item.source,
    retrievalMode: "keyword" as const,
  }));
}

/**
 * Try embedding-based retrieval. Returns `null` when:
 *   • the on-disk index is empty (dev before first `pnpm help:reindex`)
 *   • no embedding API key is configured
 *   • the embedding call fails (network, timeout, provider error)
 *
 * A `null` return is the signal to the caller to fall through to
 * keyword search. We never throw — the chatbot must stay responsive
 * even when the semantic layer is degraded.
 */
async function tryEmbeddingRetrieval(
  query: string,
  limit: number,
): Promise<RetrievedArticle[] | null> {
  const index = loadEmbeddingIndex();
  if (!index) return null;

  const queryVector = await embedQuery(query);
  if (!queryVector) return null;

  const { byId } = await buildIndex();
  const ranked = rankByVector(index, queryVector, limit);
  if (ranked.length === 0) return null;

  log.info("help_retrieval_embedding", {
    query_chars: query.length,
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
      excerpt: excerptAround(article.body, query),
      source: article.source,
      retrievalMode: "embedding",
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
