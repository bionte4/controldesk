import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import { HelpMarkdown } from "@/components/help/help-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  HELP_CATEGORY_META,
  HELP_MANIFEST,
  loadHelpArticle,
} from "@/lib/help/articles";
import { isLocale } from "@/lib/i18n/config";

/**
 * Prerender every article slug so `/help/{slug}` is a static page
 * at build time. Fifteen tiny HTML files — negligible build cost,
 * instant TTFB, and it means the article body never touches the
 * request path.
 */
export function generateStaticParams() {
  return HELP_MANIFEST.map(({ slug }) => ({ slug }));
}

/**
 * Deep links from `<HelpHint>` need real HTML titles for browser
 * history + accessible page announcement. We derive from the manifest
 * (cheap — no filesystem read here) rather than opening the article.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const localeCode = isLocale(locale) ? locale : undefined;
  const article = await loadHelpArticle(slug, localeCode);
  if (!article) return { title: "Help" };
  return {
    title: `${article.title} · Help`,
    description: article.summary || undefined,
  };
}

/**
 * Article view. Layout choice:
 *   • Back link + breadcrumb-ish "Kategori" chip at the top so users
 *     always know where they are (help is deep-linked from many places).
 *   • If the requested locale doesn't have a translation, we surface
 *     an inline banner explaining the fallback so the reader isn't
 *     silently served Indonesian content when they picked English.
 *   • Prose column capped at ~72ch — long lines destroy readability.
 *   • Right rail is intentionally omitted for MVP; TOC + "on this page"
 *     is a follow-up if articles start exceeding one screen.
 */
export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const localeRaw = await getLocale();
  const locale = isLocale(localeRaw) ? localeRaw : undefined;
  const [article, t] = await Promise.all([
    loadHelpArticle(slug, locale),
    getTranslations("help"),
  ]);

  if (!article) notFound();

  const categoryLabel =
    locale === "en"
      ? HELP_CATEGORY_META[article.category].titleEn
      : HELP_CATEGORY_META[article.category].titleId;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" render={<Link href="/help" />}>
          <ArrowLeft className="size-4" aria-hidden />
          {t("backToIndex")}
        </Button>
        <Badge variant="outline">{categoryLabel}</Badge>
      </div>

      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {article.title}
        </h1>
        {article.summary && (
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            {article.summary}
          </p>
        )}
      </header>

      {!article.translated && (
        <div
          role="status"
          className="flex max-w-3xl items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="leading-relaxed">{t("translationFallback")}</p>
        </div>
      )}

      <article className="prose prose-slate max-w-3xl dark:prose-invert prose-headings:font-display prose-headings:tracking-tight prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-sm prose-code:font-mono prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted prose-pre:text-foreground prose-img:rounded-lg">
        <HelpMarkdown markdown={article.markdown} />
      </article>
    </div>
  );
}
