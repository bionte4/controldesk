import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PencilLine, User } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { HelpMarkdown } from "@/components/help/help-markdown";
import { KnowledgeArticleActionsBar } from "@/components/knowledge/knowledge-article-actions-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireCurrentEmployee } from "@/lib/auth/session";
import {
  bumpKnowledgeArticleViewCount,
  loadKnowledgeArticleBySlug,
} from "@/lib/data/knowledge-articles";
import { formatRelative } from "@/lib/format/date";
import { canManageKnowledgeArticles } from "@/lib/rbac/roles";
import type { KnowledgeArticleCategory } from "@/lib/validation/knowledge-article";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = await loadKnowledgeArticleBySlug(slug);
  if (!article) return { title: "Knowledge Base" };
  return {
    title: `${article.title} · Knowledge Base`,
    description: article.summary || undefined,
  };
}

/**
 * `/knowledge/{slug}` — article reader.
 *
 * Two things that differ from `/help/{slug}`:
 *   1. This page CAN be for a draft. Drafts are visible only to the
 *      author + admin (RLS + PDP). The reader UI shows a DRAFT
 *      banner so the reader isn't confused about publication state.
 *   2. When the caller is the author (or admin), an actions bar
 *      appears: Edit / Publish / Archive. Everything is a Server
 *      Action call — the RSC just decides whether the bar renders.
 *
 * `view_count` is bumped as a side effect. Fire-and-forget: a failed
 * bump doesn't fail the render, and we don't await it before
 * responding (the RSC waits anyway, but any error is swallowed).
 */
export default async function KnowledgeArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [t, article, employee] = await Promise.all([
    getTranslations("knowledge"),
    loadKnowledgeArticleBySlug(slug),
    requireCurrentEmployee(),
  ]);

  if (!article) notFound();

  // Best-effort view counter — only for published articles. Draft
  // views by the author would inflate the number and give a false
  // signal on readership.
  if (article.status === "PUBLISHED") {
    try {
      await bumpKnowledgeArticleViewCount(article.id);
    } catch {
      // intentionally swallowed — view count is UX signal, not correctness
    }
  }

  // Single source of truth for the KM admin gate lives in
  // `canManageKnowledgeArticles` — same helper the PDP and (soon) the
  // RLS SELECT / UPDATE policies delegate to. Keeps the reader, the
  // server actions, and the DB aligned on one 4-role list.
  const canManage =
    article.author_employee_id === employee.id ||
    canManageKnowledgeArticles(employee.role);

  const categoryLabel = t(
    `category.${article.category as KnowledgeArticleCategory}` as never,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" render={<Link href="/knowledge" />}>
          <ArrowLeft className="size-4" aria-hidden />
          {t("backToIndex")}
        </Button>
        <Badge variant="outline">{categoryLabel}</Badge>
        {article.status === "DRAFT" && (
          <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-400">
            DRAFT
          </Badge>
        )}
        {article.status === "ARCHIVED" && (
          <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
            ARCHIVED
          </Badge>
        )}
      </div>

      <header className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {article.title}
        </h1>
        {article.summary && (
          <p className="max-w-3xl text-sm text-muted-foreground">
            {article.summary}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {article.author && (
            <span className="inline-flex items-center gap-1.5">
              <User className="size-3.5" aria-hidden />
              {article.author.full_name}
            </span>
          )}
          <span>
            {t("updated")} · {formatRelative(article.updated_at)}
          </span>
          {article.status === "PUBLISHED" && article.published_at && (
            <span>
              {t("publishedAt")} · {formatRelative(article.published_at)}
            </span>
          )}
        </div>
      </header>

      {canManage && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3 text-sm">
          <div className="flex items-center gap-2 text-primary">
            <PencilLine className="size-4" aria-hidden />
            <span>{t("manageBanner")}</span>
          </div>
          <KnowledgeArticleActionsBar
            articleId={article.id}
            slug={article.slug}
            status={article.status}
            currentSummary={article.summary ?? ""}
          />
        </div>
      )}

      <article className="prose prose-slate max-w-3xl dark:prose-invert prose-headings:font-display prose-headings:tracking-tight prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-sm prose-code:font-mono prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted prose-pre:text-foreground prose-img:rounded-lg">
        <HelpMarkdown markdown={article.body_md} />
      </article>
    </div>
  );
}
