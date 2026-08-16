"use client";

import Link from "next/link";
import { ArrowUpRight, BookOpen, Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * Shape shared by `/api/help/rag` and the `retrieveContext()`
 * server-side helper. Kept structural (not `import`ed) so a client
 * bundle doesn't drag in server-only retrieval code.
 */
export type RagArticle = {
  slug: string;
  title: string;
  category: string;
  excerpt: string;
  source: string;
  retrievalMode: "embedding" | "keyword" | "manifest";
};

/**
 * `<RagFallbackCard />` — degraded but useful mode for the help
 * chatbot.
 *
 * Rendered underneath a `ChatError` alert when the primary LLM path
 * fails (Groq TPD cap, provider outage, config missing, …). The card
 * shows the same top-3 retrieval hits the chat endpoint would have
 * fed the LLM as context — minus the synthesis step. Users still get
 * a useful "here are relevant docs" moment instead of a dead spinner.
 *
 * Design cues that mark this as a fallback (not a real AI reply):
 *   • Dashed border + muted gradient background (echoes empty states
 *     elsewhere in the app so users read it as "system-generated,
 *     not chat").
 *   • "SYSTEM" pill in the header with a Sparkles glyph in a
 *     desaturated ring — related to the AI palette but visually cool
 *     so it doesn't compete with real assistant bubbles above it.
 *   • Each result is a card, not a bulleted list — the click target
 *     is the whole card, not just the title, and the excerpt gives
 *     users enough context to decide before navigating away.
 *
 * i18n: pulls from `help.ask.fallback.*` — same namespace shared by
 * the drawer (`AskAiSheet`) and the full panel (`HelpAskPanel`), so
 * copy stays consistent between the two surfaces.
 */
export function RagFallbackCard({
  articles,
  loading = false,
  className,
}: {
  articles: RagArticle[];
  loading?: boolean;
  className?: string;
}) {
  const t = useTranslations("help.ask.fallback");

  if (loading) {
    return (
      <div
        className={cn(
          "mt-3 rounded-lg border border-dashed bg-muted/30 p-4",
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          <span>{t("loading")}</span>
        </div>
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div
        className={cn(
          "mt-3 rounded-lg border border-dashed bg-muted/30 p-4 text-center text-xs text-muted-foreground",
          className,
        )}
        role="status"
      >
        {t("emptyBody")}
      </div>
    );
  }

  return (
    <section
      className={cn(
        "mt-3 rounded-lg border border-dashed bg-gradient-to-br from-indigo-500/5 via-violet-500/5 to-sky-500/5 p-3",
        className,
      )}
      aria-labelledby="rag-fallback-title"
    >
      <header className="mb-2.5 flex items-start gap-2">
        <div
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground ring-1 ring-inset ring-border"
        >
          <Sparkles className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-flex items-center rounded-sm bg-muted px-1.5 py-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
              aria-hidden
            >
              {t("badge")}
            </span>
            <h4
              id="rag-fallback-title"
              className="truncate text-xs font-semibold"
            >
              {t("title")}
            </h4>
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {t("hint")}
          </p>
        </div>
      </header>

      <ol className="flex flex-col gap-2">
        {articles.map((article) => (
          <li key={article.slug}>
            <Link
              href={`/help/${article.slug}`}
              className={cn(
                "group flex items-start gap-2.5 rounded-md border bg-card px-2.5 py-2 text-left transition-colors",
                "hover:border-primary/50 hover:bg-primary/5",
                "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
              )}
            >
              <BookOpen
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h5 className="line-clamp-1 text-xs font-semibold">
                    {article.title}
                  </h5>
                  <ArrowUpRight
                    className="size-3 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                    aria-hidden
                  />
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                  {article.excerpt}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Fetch retrieval results from the `/api/help/rag` endpoint. Kept
 * outside the component so the two chat surfaces can share the
 * fetch + error contract without duplicating parsing logic.
 *
 * Never throws for a 2xx-but-empty response — resolves to `[]` so
 * the caller can render the "no results" state without a try/catch
 * on the happy path. Only network failures / 4xx / 5xx throw.
 */
export async function fetchRagFallback(
  query: string,
  opts?: { signal?: AbortSignal; limit?: number },
): Promise<RagArticle[]> {
  const res = await fetch("/api/help/rag", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      ...(opts?.limit ? { limit: opts.limit } : {}),
    }),
    signal: opts?.signal,
  });
  if (!res.ok) {
    throw new Error(`fetchRagFallback failed with ${res.status}`);
  }
  const data = (await res.json()) as { articles?: RagArticle[] };
  return data.articles ?? [];
}
