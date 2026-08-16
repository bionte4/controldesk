import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { KnowledgeArticleForm } from "@/components/knowledge/knowledge-article-form";
import { Button } from "@/components/ui/button";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { loadKnowledgeArticleBySlug } from "@/lib/data/knowledge-articles";
import type { KnowledgeArticleCategory } from "@/lib/validation/knowledge-article";

export const metadata: Metadata = { title: "Edit knowledge article" };

/**
 * `/knowledge/{slug}/edit` — reuse the shared author form, seeded
 * with the current article body. RSC-side we do two checks:
 *
 *   1. Article exists + is visible to the caller (RLS enforces).
 *   2. Caller is the author OR an admin — matches
 *      `decideKnowledgeArticle` in the PDP so a stray user typing
 *      the URL still can't reach the form.
 *
 * ARCHIVED articles cannot be edited directly; the reader UI shows
 * a "Restore to draft" button, and only after that does this page
 * accept edits.
 */
export default async function EditKnowledgeArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [t, article, employee] = await Promise.all([
    getTranslations("knowledge.edit"),
    loadKnowledgeArticleBySlug(slug),
    requireCurrentEmployee(),
  ]);

  if (!article) notFound();

  const isAuthor = article.author_employee_id === employee.id;
  const isAdmin =
    employee.role === "TENANT_ADMIN" ||
    employee.role === "ADMIN" ||
    employee.role === "HEAD_MANAGER" ||
    employee.role === "HR_ADMIN";
  if (!isAuthor && !isAdmin) notFound();

  if (article.status === "ARCHIVED") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            render={<Link href={`/knowledge/${slug}`} />}
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t("back")}
          </Button>
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">{t("archivedTitle")}</p>
          <p className="mt-1 text-muted-foreground">{t("archivedHint")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={`/knowledge/${slug}`} />}
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("back")}
        </Button>
      </div>
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {t("subtitle")}
        </p>
      </header>
      <KnowledgeArticleForm
        mode={{
          kind: "edit",
          articleId: article.id,
          originalSlug: article.slug,
        }}
        initial={{
          slug: article.slug,
          title: article.title,
          summary: article.summary,
          body_md: article.body_md,
          category: article.category as KnowledgeArticleCategory,
        }}
      />
    </div>
  );
}
