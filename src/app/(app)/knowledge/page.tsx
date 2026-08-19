import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  ClipboardList,
  FileText,
  Plus,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { formatRelative } from "@/lib/format/date";
import { requireCurrentEmployee } from "@/lib/auth/session";
import {
  loadKnowledgeArticles,
  type KnowledgeArticleWithAuthor,
} from "@/lib/data/knowledge-articles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  KNOWLEDGE_ARTICLE_CATEGORIES,
  type KnowledgeArticleCategory,
} from "@/lib/validation/knowledge-article";

export const metadata: Metadata = { title: "Knowledge Base" };

/**
 * `/knowledge` — the tenant-authored Knowledge Base landing page.
 *
 * Layout:
 *   • Hero with counts + "Write an article" CTA.
 *   • Two sections:
 *     – "Your drafts" — only visible to the caller, opens the edit
 *       form directly (drafts have no public URL).
 *     – "Published, by category" — mirrors the /help browse view so
 *       readers see repo articles and tenant articles under the
 *       same taxonomy.
 *
 * Data:
 *   The RSC uses two loaders. Both are `React.cache()`-deduped so
 *   the same underlying query fires once per request even though
 *   both sections technically need it.
 */
export default async function KnowledgePage() {
  const [t, employee, published, drafts] = await Promise.all([
    getTranslations("knowledge"),
    requireCurrentEmployee(),
    loadKnowledgeArticles({ status: "PUBLISHED" }),
    loadKnowledgeArticles({ status: "DRAFT" }),
  ]);

  const myDrafts = drafts.filter(
    (a) => a.author_employee_id === employee.id,
  );

  const publishedByCategory = new Map<
    KnowledgeArticleCategory,
    KnowledgeArticleWithAuthor[]
  >();
  for (const cat of KNOWLEDGE_ARTICLE_CATEGORIES) {
    publishedByCategory.set(cat, []);
  }
  for (const a of published) {
    const bucket = publishedByCategory.get(a.category as KnowledgeArticleCategory);
    if (bucket) bucket.push(a);
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
            <BookOpenText className="size-5" aria-hidden />
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
        </div>
        <Button size="sm" render={<Link href="/knowledge/new" />}>
          <Plus className="size-4" aria-hidden />
          {t("newArticle")}
        </Button>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<FileText className="size-4" aria-hidden />}
          label={t("stat.published")}
          value={published.length}
        />
        <StatCard
          icon={<ClipboardList className="size-4" aria-hidden />}
          label={t("stat.yourDrafts")}
          value={myDrafts.length}
        />
        <StatCard
          icon={<BookOpenText className="size-4" aria-hidden />}
          label={t("stat.categories")}
          value={
            Array.from(publishedByCategory.values()).filter(
              (arr) => arr.length > 0,
            ).length
          }
        />
      </section>

      {myDrafts.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-xl font-semibold tracking-tight">
              {t("section.yourDrafts")}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("section.yourDraftsHint")}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {myDrafts.map((a) => (
              <DraftCard
                key={a.id}
                article={a}
                editLabel={t("editDraft")}
                updatedLabel={t("updated")}
              />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl font-semibold tracking-tight">
          {t("section.published")}
        </h2>
        {published.length === 0 ? (
          <EmptyPublished hint={t("empty.published")} />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {KNOWLEDGE_ARTICLE_CATEGORIES.map((catId) => {
              const items = publishedByCategory.get(catId) ?? [];
              if (items.length === 0) return null;
              return (
                <CategoryCard
                  key={catId}
                  category={catId}
                  articles={items}
                  categoryLabel={t(`category.${catId}` as never)}
                  readLabel={t("read")}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <div className="grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="font-display text-2xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function DraftCard({
  article,
  editLabel,
  updatedLabel,
}: {
  article: KnowledgeArticleWithAuthor;
  editLabel: string;
  updatedLabel: string;
}) {
  const updated = formatRelative(article.updated_at);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base leading-snug">
              {article.title}
            </CardTitle>
            <CardDescription className="mt-1 line-clamp-2">
              {article.summary ?? "—"}
            </CardDescription>
          </div>
          <Badge variant="outline">DRAFT</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2 pt-0">
        <p className="text-xs text-muted-foreground">
          {updatedLabel} · {updated}
        </p>
        <Button
          variant="outline"
          size="sm"
          render={<Link href={`/knowledge/${article.slug}/edit`} />}
        >
          {editLabel}
          <ArrowRight className="size-3.5" aria-hidden />
        </Button>
      </CardContent>
    </Card>
  );
}

function CategoryCard({
  category,
  articles,
  categoryLabel,
  readLabel,
}: {
  category: KnowledgeArticleCategory;
  articles: KnowledgeArticleWithAuthor[];
  categoryLabel: string;
  readLabel: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{categoryLabel}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {articles.map((a) => (
          <Link
            key={a.id}
            href={`/knowledge/${a.slug}`}
            className="group flex items-start gap-3 rounded-lg border border-transparent p-3 -mx-3 hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label={`${readLabel}: ${a.title}`}
            data-category={category}
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium leading-snug">{a.title}</p>
              {a.summary && (
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {a.summary}
                </p>
              )}
              {a.author && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {a.author.full_name}
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

function EmptyPublished({ hint }: { hint: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <BookOpenText className="size-5" aria-hidden />
        </div>
        <p className="max-w-md text-sm text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
