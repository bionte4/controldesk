import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { HelpSearch } from "@/components/help/help-search";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  HELP_CATEGORY_META,
  HELP_CATEGORY_ORDER,
  loadAllHelpArticles,
  type HelpArticle,
  type HelpCategoryId,
} from "@/lib/help/articles";

export const metadata: Metadata = { title: "Help" };

/**
 * `/help` index — landing page for the in-app knowledge base.
 *
 * Layout:
 *   1. Hero + search bar (top) — client component wraps fuse.js over
 *      the full article index. Filters by title + summary + slug.
 *   2. Category groups (bottom) — one Card per category, each showing
 *      the articles that belong to it. Server-rendered from
 *      `HELP_MANIFEST` order (see `lib/help/articles.ts`).
 *
 * All data is derived from the manifest at request time, memoised via
 * `React.cache()` — one filesystem read per request regardless of how
 * many components consume it. No DB, no RLS to worry about; content
 * comes from the repo, not per-tenant storage (rules §17).
 */
export default async function HelpIndexPage() {
  const [t, locale, articles] = await Promise.all([
    getTranslations("help"),
    getLocale(),
    loadAllHelpArticles(),
  ]);

  const grouped = groupByCategory(articles);
  // Trim payload before sending to the client search index — the raw
  // markdown body is unnecessary and would balloon the JS bundle.
  const searchIndex = articles.map((a) => ({
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    category: a.category,
    // A short, non-formatted preview of the body for search matching —
    // strip fences/headings so hits are readable.
    preview: previewFor(a),
  }));

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <BookOpen className="size-5" aria-hidden />
        </div>
        <div className="flex-1">
          <p className="label-meta">{t("eyebrow")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
      </header>

      <HelpSearch
        articles={searchIndex}
        locale={locale === "en" ? "en" : "id"}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {HELP_CATEGORY_ORDER.map((catId) => {
          const items = grouped.get(catId) ?? [];
          if (items.length === 0) return null;
          return (
            <CategoryCard
              key={catId}
              category={catId}
              articles={items}
              locale={locale === "en" ? "en" : "id"}
              readLabel={t("readArticle")}
            />
          );
        })}
      </div>
    </div>
  );
}

function CategoryCard({
  category,
  articles,
  locale,
  readLabel,
}: {
  category: HelpCategoryId;
  articles: HelpArticle[];
  locale: "id" | "en";
  readLabel: string;
}) {
  const title =
    locale === "en"
      ? HELP_CATEGORY_META[category].titleEn
      : HELP_CATEGORY_META[category].titleId;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {articles.map((a) => (
          <Link
            key={a.slug}
            href={`/help/${a.slug}`}
            className="group flex items-start gap-3 rounded-lg border border-transparent p-3 -mx-3 hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`${readLabel}: ${a.title}`}
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium leading-snug">{a.title}</p>
              {a.summary && (
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {a.summary}
                </p>
              )}
            </div>
            <ArrowRight
              className="size-4 shrink-0 translate-x-0 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-foreground"
              aria-hidden
            />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

function groupByCategory(
  articles: HelpArticle[],
): Map<HelpCategoryId, HelpArticle[]> {
  const out = new Map<HelpCategoryId, HelpArticle[]>();
  for (const a of articles) {
    const bucket = out.get(a.category) ?? [];
    bucket.push(a);
    out.set(a.category, bucket);
  }
  return out;
}

/**
 * Strip markdown syntax + limit length so the client-side search has
 * a compact string to index. Real markdown rendering happens on the
 * article page — this is just for haystack matching.
 */
function previewFor(a: HelpArticle): string {
  const stripped = a.markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>|~]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.slice(0, 800);
}
