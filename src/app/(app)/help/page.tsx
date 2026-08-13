import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { HelpSearch } from "@/components/help/help-search";
import { HelpTabs } from "@/components/help/help-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  HELP_CATEGORY_META,
  HELP_CATEGORY_ORDER,
  loadAllHelpArticles,
  type HelpArticle,
  type HelpCategoryId,
} from "@/lib/help/articles";
import { isLocale } from "@/lib/i18n/config";

export const metadata: Metadata = { title: "Help" };

/**
 * `/help` — in-app knowledge base + chatbot landing.
 *
 * Two tabs (rules §17 + user's Fase 2 pick):
 *   1. **Browse** — the RSC-rendered content produced here (search
 *      bar + category cards). All data is derived from
 *      `HELP_MANIFEST` at request time, memoised via `React.cache()`
 *      so re-reads within a request are free.
 *   2. **Ask ControlDesk** — RAG chatbot, mounted lazily by the
 *      `<HelpTabs>` client component. Keyword retrieval + tenant's
 *      own AI config; ephemeral history; details in
 *      `src/app/api/help/ask/route.ts`.
 *
 * Deep links: `/help?tab=ask` opens directly on the chat tab, useful
 * for CTAs in transactional emails and cross-page prompts ("Try the
 * new AI assistant"). Query param is validated below.
 */
export default async function HelpIndexPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const localeRaw = await getLocale();
  const locale = isLocale(localeRaw) ? localeRaw : undefined;
  const [t, articles, resolvedParams] = await Promise.all([
    getTranslations("help"),
    // Feed the index the same locale as the article page so titles /
    // summaries come from the translated file when it exists. Fuse
    // search still uses this locale-aware bundle — no dedicated ID
    // index — because keyword-relevance on the reader's own language
    // beats forcing them onto a canonical index.
    loadAllHelpArticles(locale),
    (searchParams ?? Promise.resolve({})) as Promise<
      Record<string, string | string[] | undefined>
    >,
  ]);

  const rawTab = resolvedParams["tab"];
  const tabParam = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const defaultTab: "browse" | "ask" = tabParam === "ask" ? "ask" : "browse";

  const grouped = groupByCategory(articles);
  const searchIndex = articles.map((a) => ({
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    category: a.category,
    preview: previewFor(a),
  }));

  const browseSlot = (
    <div className="flex flex-col gap-6">
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

      <HelpTabs
        browseSlot={browseSlot}
        articleSlugs={articles.map((a) => a.slug)}
        defaultTab={defaultTab}
      />
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
