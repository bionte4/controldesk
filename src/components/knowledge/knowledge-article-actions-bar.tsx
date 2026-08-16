"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, CheckCircle2, PencilLine, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

import {
  archiveKnowledgeArticleAction,
  publishKnowledgeArticleAction,
  restoreKnowledgeArticleAction,
} from "@/app/(app)/knowledge/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { KnowledgeArticleStatus } from "@/lib/validation/knowledge-article";

/**
 * Author / admin actions bar rendered inline in the article header
 * (`/knowledge/{slug}` — see `page.tsx`). The buttons that appear
 * depend on the article's current status:
 *
 *   DRAFT     → Edit • Publish • Archive
 *   PUBLISHED → Edit • Archive
 *   ARCHIVED  → Restore  (edit + publish become available again
 *                          after restore returns the article to DRAFT)
 *
 * Publish opens a dialog because the schema requires a ≥ 10 char
 * summary before we flip the row. That's on the theory that a
 * published article without a summary hurts the browse UX and the
 * chatbot citation blurb (see `publishKnowledgeArticleSchema`).
 */
export function KnowledgeArticleActionsBar({
  articleId,
  slug,
  status,
  currentSummary,
}: {
  articleId: string;
  slug: string;
  status: KnowledgeArticleStatus;
  currentSummary: string;
}) {
  const t = useTranslations("knowledge.actions");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "ARCHIVED" && (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          render={<Link href={`/knowledge/${slug}/edit`} />}
        >
          <PencilLine className="size-3.5" aria-hidden />
          {t("edit")}
        </Button>
      )}

      {status !== "PUBLISHED" && status !== "ARCHIVED" && (
        <PublishDialog
          articleId={articleId}
          currentSummary={currentSummary}
          label={t("publish")}
          isPending={isPending}
          onPublished={() => router.refresh()}
        />
      )}

      {status !== "ARCHIVED" && (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              const res = await archiveKnowledgeArticleAction({
                id: articleId,
                edit_note: "Archived from article view",
              });
              if (res.ok) {
                toast.success(t("archivedToast"));
                router.refresh();
              } else {
                toast.error(res.reason);
              }
            });
          }}
        >
          <Archive className="size-3.5" aria-hidden />
          {t("archive")}
        </Button>
      )}

      {status === "ARCHIVED" && (
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => {
            startTransition(async () => {
              const res = await restoreKnowledgeArticleAction({
                id: articleId,
                edit_note: "Restored to draft from article view",
              });
              if (res.ok) {
                toast.success(t("restoredToast"));
                router.refresh();
              } else {
                toast.error(res.reason);
              }
            });
          }}
        >
          <RefreshCw className="size-3.5" aria-hidden />
          {t("restore")}
        </Button>
      )}
    </div>
  );
}

function PublishDialog({
  articleId,
  currentSummary,
  label,
  isPending,
  onPublished,
}: {
  articleId: string;
  currentSummary: string;
  label: string;
  isPending: boolean;
  onPublished: () => void;
}) {
  const t = useTranslations("knowledge.publish");
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState(currentSummary);
  const [isSubmitting, startTransition] = useTransition();

  const disabled = isPending || isSubmitting || summary.trim().length < 10;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" disabled={isPending}>
            <CheckCircle2 className="size-3.5" aria-hidden />
            {label}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="knowledge-publish-summary">{t("summaryLabel")}</Label>
          <Textarea
            id="knowledge-publish-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={4}
            maxLength={400}
            placeholder={t("summaryPlaceholder")}
            required
          />
          <p className="text-xs text-muted-foreground">
            {summary.trim().length}/400 · {t("summaryHint")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
          <Button
            disabled={disabled}
            onClick={() => {
              startTransition(async () => {
                const res = await publishKnowledgeArticleAction({
                  id: articleId,
                  summary: summary.trim(),
                });
                if (res.ok) {
                  toast.success(t("publishedToast"));
                  setOpen(false);
                  onPublished();
                } else {
                  toast.error(res.reason);
                }
              });
            }}
          >
            <CheckCircle2 className="size-3.5" aria-hidden />
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
