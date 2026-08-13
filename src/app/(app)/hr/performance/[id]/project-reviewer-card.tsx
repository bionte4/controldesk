"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Briefcase, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatDateOnly } from "@/lib/format/date";
import type { EvaluationStatus } from "@/lib/validation/evaluation";

import { submitProjectReviewerNotesAction } from "../actions";

/**
 * Card surfaced on the evaluation detail page when the row carries a
 * `project_id` (migration 0089). Two responsibilities:
 *   1. Show WHICH project the eval is anchored to + the reviewer's
 *      identity + submitted notes (read-only view for anyone).
 *   2. When the current viewer IS the assigned project reviewer AND
 *      the evaluation is in a pre-OM status, expose a textarea +
 *      "Submit notes" button — POSTs `submitProjectReviewerNotesAction`.
 *
 * The card is purely additive; if no project context is attached it
 * does not render at all (parent guard).
 */
export function ProjectReviewerCard({
  evaluationId,
  status,
  viewerEmployeeId,
  project,
  reviewer,
  reviewerNotes,
  reviewedAt,
}: {
  evaluationId: string;
  status: EvaluationStatus;
  viewerEmployeeId: string;
  project: {
    id: string;
    name: string;
    project_number: string | null;
  };
  reviewer: { id: string; full_name: string } | null;
  reviewerNotes: string | null;
  reviewedAt: string | null;
}) {
  const t = useTranslations("performance.detail.projectReviewer");
  const router = useRouter();
  const [notes, setNotes] = React.useState(reviewerNotes ?? "");
  const [pending, startTransition] = React.useTransition();

  const isReviewer = reviewer?.id === viewerEmployeeId;
  const openStatuses: EvaluationStatus[] = [
    "DRAFT",
    "SUBMITTED_BY_SPV",
    "REVIEWED_BY_PM",
    "RETURNED_TO_SPV",
  ];
  const canEdit = isReviewer && openStatuses.includes(status);

  function onSubmit() {
    if (!notes.trim()) {
      toast.error(t("errorEmpty"));
      return;
    }
    startTransition(async () => {
      const res = await submitProjectReviewerNotesAction({
        id: evaluationId,
        project_reviewer_notes: notes.trim(),
      });
      if (res.ok) {
        toast.success(t("saved"));
        router.refresh();
      } else {
        toast.error(res.reason ?? t("errorEmpty"));
      }
    });
  }

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Briefcase className="size-4 text-muted-foreground" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">
              {t("projectLabel")}
            </div>
            <div className="mt-1 flex items-center gap-2">
              {project.project_number ? (
                <Badge variant="outline" className="font-mono">
                  {project.project_number}
                </Badge>
              ) : null}
              <span className="font-medium">{project.name}</span>
            </div>
          </div>
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">
              {t("reviewerLabel")}
            </div>
            <div className="mt-1 text-sm">
              {reviewer ? (
                <span className="font-medium">{reviewer.full_name}</span>
              ) : (
                <span className="text-muted-foreground italic">
                  {t("reviewerMissing")}
                </span>
              )}
            </div>
            {reviewedAt ? (
              <div className="mt-1 text-[11px] text-muted-foreground">
                {t("reviewedAtHint", { date: formatDateOnly(reviewedAt) })}
              </div>
            ) : null}
          </div>
        </div>

        {canEdit ? (
          <div className="flex flex-col gap-2">
            <label
              htmlFor="project-reviewer-notes"
              className="text-sm font-medium"
            >
              {t("notesLabel")}
            </label>
            <Textarea
              id="project-reviewer-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t("notesPlaceholder")}
              rows={5}
              disabled={pending}
              aria-describedby="project-reviewer-notes-hint"
            />
            <p
              id="project-reviewer-notes-hint"
              className="text-[11px] text-muted-foreground"
            >
              {t("notesHint")}
            </p>
            <div className="flex justify-end">
              <Button onClick={onSubmit} disabled={pending} size="sm">
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {reviewerNotes ? t("updateNotes") : t("submitNotes")}
              </Button>
            </div>
          </div>
        ) : reviewerNotes ? (
          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            <div className="text-xs text-muted-foreground mb-1">
              {t("notesLabel")}
            </div>
            <p className="whitespace-pre-wrap">{reviewerNotes}</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            {isReviewer
              ? t("lockedForReviewer")
              : t("pending")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
