import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { KnowledgeArticleForm } from "@/components/knowledge/knowledge-article-form";
import { Button } from "@/components/ui/button";
import { loadProjectsForPicker } from "@/lib/data/projects";

export const metadata: Metadata = { title: "New knowledge article" };

/**
 * `/knowledge/new` — author a brand-new article. Always creates a
 * DRAFT; publishing is a follow-up action after the author has had
 * a chance to review the rendered markdown. See
 * `KnowledgeArticleForm` for the shared UI.
 */
export default async function NewKnowledgeArticlePage() {
  const [t, projects] = await Promise.all([
    getTranslations("knowledge.new"),
    loadProjectsForPicker(),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" render={<Link href="/knowledge" />}>
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
      <KnowledgeArticleForm mode={{ kind: "create" }} projects={projects} />
    </div>
  );
}
