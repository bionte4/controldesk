"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Eye, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import {
  createKnowledgeArticleAction,
  updateKnowledgeArticleAction,
} from "@/app/(app)/knowledge/actions";
import { HelpMarkdown } from "@/components/help/help-markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  KNOWLEDGE_ARTICLE_CATEGORIES,
  type KnowledgeArticleCategory,
} from "@/lib/validation/knowledge-article";

type Mode =
  | { kind: "create" }
  | {
      kind: "edit";
      articleId: string;
      originalSlug: string;
    };

/**
 * Author form shared by /knowledge/new and /knowledge/{slug}/edit.
 *
 * Design choices:
 *   • Single flat form — title, slug, category, summary, body — no
 *     wizard. The KB is optimised for velocity; a multi-step form
 *     would kill the "quickly capture an SOP" use case.
 *   • Live preview toggle to the right of the editor (below on
 *     narrow viewports). Uses the same `HelpMarkdown` component as
 *     the reader so authors can trust WYSIWYG parity.
 *   • Slug auto-generates from the title (kebab-case) on first
 *     input but stops overriding as soon as the author touches the
 *     slug field. Matches the pattern in `HelpSearch` for
 *     server-cost-conscious defaults.
 */
export function KnowledgeArticleForm({
  mode,
  initial,
}: {
  mode: Mode;
  initial?: {
    slug: string;
    title: string;
    summary: string | null;
    body_md: string;
    category: KnowledgeArticleCategory;
  };
}) {
  const t = useTranslations("knowledge.form");
  const router = useRouter();

  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(mode.kind === "edit");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [body, setBody] = useState(initial?.body_md ?? "");
  const [category, setCategory] = useState<KnowledgeArticleCategory>(
    initial?.category ?? "user-guides",
  );
  const [preview, setPreview] = useState(false);
  const [isPending, startTransition] = useTransition();

  const derivedSlug = useMemo(() => slugify(title), [title]);
  const effectiveSlug = slugTouched ? slug : derivedSlug;

  const canSubmit =
    title.trim().length >= 3 &&
    body.trim().length >= 1 &&
    effectiveSlug.length >= 3;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;

        startTransition(async () => {
          if (mode.kind === "create") {
            const res = await createKnowledgeArticleAction({
              slug: effectiveSlug,
              title: title.trim(),
              summary: summary.trim() || undefined,
              body_md: body,
              category,
              visibility: "TENANT_WIDE",
            });
            if (res.ok) {
              toast.success(t("createdToast"));
              router.push(`/knowledge/${res.data.slug}`);
              router.refresh();
            } else {
              toast.error(res.reason);
            }
          } else {
            const res = await updateKnowledgeArticleAction({
              id: mode.articleId,
              slug: effectiveSlug === mode.originalSlug ? undefined : effectiveSlug,
              title: title.trim(),
              summary: summary.trim(),
              body_md: body,
              category,
            });
            if (res.ok) {
              toast.success(t("savedToast"));
              router.push(`/knowledge/${res.data.slug}`);
              router.refresh();
            } else {
              toast.error(res.reason);
            }
          }
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="knowledge-title">{t("titleLabel")}</Label>
          <Input
            id="knowledge-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            placeholder={t("titlePlaceholder")}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="knowledge-slug">{t("slugLabel")}</Label>
          <Input
            id="knowledge-slug"
            value={effectiveSlug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
            maxLength={80}
            required
            placeholder="e.g. onboarding-checklist"
            pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
          />
          <p className="text-xs text-muted-foreground">
            {t("slugHint")}
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-2">
          <Label htmlFor="knowledge-summary">{t("summaryLabel")}</Label>
          <Textarea
            id="knowledge-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            maxLength={400}
            placeholder={t("summaryPlaceholder")}
          />
          <p className="text-xs text-muted-foreground">
            {summary.length}/400 · {t("summaryHint")}
          </p>
        </div>
        <div className="flex flex-col gap-2 md:min-w-56">
          <Label>{t("categoryLabel")}</Label>
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as KnowledgeArticleCategory)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KNOWLEDGE_ARTICLE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {t(`category.${c}` as never)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="knowledge-body">{t("bodyLabel")}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? (
            <>
              <Sparkles className="size-3.5" aria-hidden />
              {t("edit")}
            </>
          ) : (
            <>
              <Eye className="size-3.5" aria-hidden />
              {t("preview")}
            </>
          )}
        </Button>
      </div>
      {preview ? (
        <div className="min-h-[24rem] rounded-md border bg-muted/20 p-4">
          <article className="prose prose-slate max-w-3xl dark:prose-invert prose-headings:font-display prose-headings:tracking-tight">
            <HelpMarkdown markdown={body || t("emptyPreview")} />
          </article>
        </div>
      ) : (
        <Textarea
          id="knowledge-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={24}
          className="font-mono text-sm"
          placeholder={t("bodyPlaceholder")}
          required
        />
      )}

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isPending}
        >
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={!canSubmit || isPending}>
          <Save className="size-3.5" aria-hidden />
          {mode.kind === "create" ? t("saveDraft") : t("save")}
        </Button>
      </div>
    </form>
  );
}

/**
 * Convert an arbitrary user string into the constrained slug form
 * (lower-case letters, digits, single hyphens; matches the regex on
 * `slugSchema`). Trims to 80 chars to align with the DB check.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
