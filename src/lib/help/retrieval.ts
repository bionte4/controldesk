import "server-only";

import Fuse from "fuse.js";
import { cache } from "react";

import { loadAllHelpArticles, type HelpArticle } from "./articles";

/**
 * Server-side retrieval for the "Ask ControlDesk" chatbot.
 *
 * Design (keyword-only, per user's Fase-2 pick):
 *   • Same fuse.js library the client-side search uses, but running
 *     on the server so we can bound the context we ship to the LLM.
 *   • Ranks by weighted match on title / summary / body body preview.
 *   • Returns the top-N articles (default 3) with a short excerpt
 *     from each — enough grounding for a Level-1 "answer from docs"
 *     chatbot without blowing the context window.
 *
 * ## Why not embeddings?
 *
 * Level 1 chatbot is deliberately conservative: it answers "how does
 * ControlDesk work" questions from static product docs, not tenant
 * data. Keyword matching is enough for those questions because our
 * docs already share vocabulary with users (they were written FOR
 * users). Embeddings would help with paraphrased queries but require
 * pre-compute + a vector store; we can add them behind the same
 * `retrieveContext()` interface later without touching the API route.
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
 * trimming), we fall back to the first three articles in manifest
 * order — those are the highest-level product docs and are the right
 * default context for "what is ControlDesk?" style openers.
 */
export async function retrieveContext(
  query: string,
  limit = 3,
): Promise<RetrievedArticle[]> {
  const { fuse, byId } = await buildIndex();
  const trimmed = query.trim();

  if (trimmed.length < 3) {
    const all = await loadAllHelpArticles();
    return all.slice(0, limit).map((a) => ({
      slug: a.slug,
      title: a.title,
      category: a.category,
      excerpt: excerptAround(stripMarkdown(a.markdown), null),
      source: a.source,
    }));
  }

  const hits = fuse.search(trimmed, { limit });
  return hits.map(({ item }) => ({
    slug: item.slug,
    title: item.title,
    category: item.category,
    excerpt: excerptAround(item.body, trimmed),
    source: item.source,
  }));
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
