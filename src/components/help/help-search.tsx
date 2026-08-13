"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import Fuse from "fuse.js";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
// IMPORTANT: this is a client component. Never import from
// `@/lib/help/articles` here — that module is `"server-only"` and
// pulls `node:fs`. Pull taxonomy types from the sibling instead.
import {
  HELP_CATEGORY_META,
  type HelpCategoryId,
} from "@/lib/help/categories";

type SearchArticle = {
  slug: string;
  title: string;
  summary: string;
  category: HelpCategoryId;
  preview: string;
};

/**
 * Client-side fuzzy search over the help article index.
 *
 * Why fuse.js instead of Pagefind / Meilisearch?
 *   • ~14 KB gz. Our index is ~15 articles, ~200 KB uncompressed — well
 *     inside "one big JSON is fine" territory.
 *   • Zero infra — no build step, no worker, no separate service.
 *   • Fuzzy matching handles Indonesian typos ("aproval" → "approval")
 *     and English/Bahasa mixed queries without a language pack.
 *
 * When to upgrade: article count > 100, OR total index > 500 KB, OR
 * users start reporting relevance issues. Then swap this component
 * for a Pagefind-backed one — the surface API (query in, results out)
 * stays the same.
 *
 * Ranking weights favour title matches (2x) over summary (1x) over
 * body preview (0.5x), matching what users intuitively expect from
 * a help search.
 */
export function HelpSearch({
  articles,
  locale,
}: {
  articles: SearchArticle[];
  locale: "id" | "en";
}) {
  const t = useTranslations("help");
  const [query, setQuery] = useState("");
  // Defer expensive filtering off the input keystroke path — feels
  // snappier on keyboards that type at 60+ WPM.
  const deferredQuery = useDeferredValue(query);

  const fuse = useMemo(
    () =>
      new Fuse(articles, {
        keys: [
          { name: "title", weight: 2 },
          { name: "summary", weight: 1 },
          { name: "preview", weight: 0.5 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
        minMatchCharLength: 2,
        includeMatches: true,
      }),
    [articles],
  );

  const results = useMemo(() => {
    const q = deferredQuery.trim();
    if (q.length < 2) return [];
    // Cap at 10 — anything below is usually noise for a knowledge base
    // this small. Users can refine.
    return fuse.search(q, { limit: 10 });
  }, [deferredQuery, fuse]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          role="searchbox"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="h-11 pl-10 pr-10 text-sm"
        />
        {query && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 h-9 w-9 -translate-y-1/2"
            onClick={() => setQuery("")}
            aria-label={t("clearSearch")}
          >
            <X className="size-4" aria-hidden />
          </Button>
        )}
      </div>

      {deferredQuery.trim().length >= 2 && (
        <div
          role="region"
          aria-live="polite"
          aria-label={t("searchResultsLabel")}
          className="rounded-lg border bg-card"
        >
          {results.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {t("noResults", { query: deferredQuery })}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {results.map(({ item }) => (
                <li key={item.slug}>
                  <Link
                    href={`/help/${item.slug}`}
                    className="flex flex-col gap-1 p-4 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{item.title}</p>
                      <Badge variant="outline" className="text-xs">
                        {locale === "en"
                          ? HELP_CATEGORY_META[item.category].titleEn
                          : HELP_CATEGORY_META[item.category].titleId}
                      </Badge>
                    </div>
                    {item.summary && (
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {item.summary}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
