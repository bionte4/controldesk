"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, Send, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { UpkStatus } from "@/lib/validation/upk";
import { UPK_DIRECTOR_THRESHOLD_IDR } from "@/lib/validation/upk";

import {
  decideUpkByDirectorAction,
  decideUpkByFinanceAction,
  markUpkPaidAction,
  submitUpkNoteAction,
} from "../actions";

/**
 * Combined actions panel — one card per applicable actor. Renders
 * nothing when the current user is not eligible to act on the note
 * at its current status.
 */
export function UpkActionsPanel({
  upkId,
  status,
  isDrafter,
  isFinance,
  isDirector,
  computedUpk,
  hasJustification,
}: {
  upkId: string;
  status: UpkStatus;
  isDrafter: boolean;
  isFinance: boolean;
  isDirector: boolean;
  computedUpk: number;
  hasJustification: boolean;
}) {
  const t = useTranslations("upk.form");
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [notes, setNotes] = React.useState("");
  const [paidRef, setPaidRef] = React.useState("");

  function onSubmit() {
    startTransition(async () => {
      const res = await submitUpkNoteAction({ id: upkId });
      if (res.ok) {
        toast.success("Submitted to Finance.");
        router.refresh();
      } else {
        toast.error(res.reason ?? "Submit failed.");
      }
    });
  }

  function onFinanceDecide(decision: "APPROVE" | "REJECT") {
    if (decision === "REJECT" && !notes) {
      toast.error("Notes required when rejecting.");
      return;
    }
    startTransition(async () => {
      const res = await decideUpkByFinanceAction({
        id: upkId,
        decision,
        notes: notes || undefined,
      });
      if (res.ok) {
        toast.success(
          decision === "APPROVE"
            ? computedUpk >= UPK_DIRECTOR_THRESHOLD_IDR
              ? "Routed to Director."
              : "Approved."
            : "Rejected.",
        );
        setNotes("");
        router.refresh();
      } else {
        toast.error(res.reason ?? "Action failed.");
      }
    });
  }

  function onDirectorDecide(decision: "APPROVE" | "REJECT") {
    if (decision === "REJECT" && !notes) {
      toast.error("Notes required when rejecting.");
      return;
    }
    startTransition(async () => {
      const res = await decideUpkByDirectorAction({
        id: upkId,
        decision,
        notes: notes || undefined,
      });
      if (res.ok) {
        toast.success(
          decision === "APPROVE" ? "Approved by Director." : "Rejected.",
        );
        setNotes("");
        router.refresh();
      } else {
        toast.error(res.reason ?? "Action failed.");
      }
    });
  }

  function onMarkPaid() {
    startTransition(async () => {
      const res = await markUpkPaidAction({
        id: upkId,
        paid_reference: paidRef || undefined,
      });
      if (res.ok) {
        toast.success("Marked as paid.");
        setPaidRef("");
        router.refresh();
      } else {
        toast.error(res.reason ?? "Mark-paid failed.");
      }
    });
  }

  // Render sections conditionally based on status + role.
  const showDrafterSubmit = isDrafter && status === "DRAFT";
  const showFinance = isFinance && status === "PENDING_FINANCE";
  const showDirector = isDirector && status === "PENDING_DIRECTOR";
  const showMarkPaid = isFinance && status === "APPROVED";

  if (
    !showDrafterSubmit &&
    !showFinance &&
    !showDirector &&
    !showMarkPaid
  ) {
    return null;
  }

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle>Actions</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {showDrafterSubmit ? (
          <div className="grid gap-2">
            {!hasJustification ? (
              <p className="text-xs text-amber-600">
                Please add justification before submitting.
              </p>
            ) : null}
            <div className="flex justify-end">
              <Button onClick={onSubmit} disabled={pending || !hasJustification}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {t("submit")}
              </Button>
            </div>
          </div>
        ) : null}

        {showFinance ? (
          <div className="grid gap-2">
            {computedUpk >= UPK_DIRECTOR_THRESHOLD_IDR ? (
              <p className="text-xs text-amber-600">
                {t("directorNeeded")}
              </p>
            ) : null}
            <Textarea
              rows={3}
              placeholder={t("notesPlaceholder")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => onFinanceDecide("REJECT")}
                disabled={pending}
              >
                <XCircle className="size-4" />
                {t("financeReject")}
              </Button>
              <Button
                onClick={() => onFinanceDecide("APPROVE")}
                disabled={pending}
              >
                <CheckCircle2 className="size-4" />
                {t("financeApprove")}
              </Button>
            </div>
          </div>
        ) : null}

        {showDirector ? (
          <div className="grid gap-2">
            <Textarea
              rows={3}
              placeholder={t("notesPlaceholder")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => onDirectorDecide("REJECT")}
                disabled={pending}
              >
                <XCircle className="size-4" />
                {t("directorReject")}
              </Button>
              <Button
                onClick={() => onDirectorDecide("APPROVE")}
                disabled={pending}
              >
                <CheckCircle2 className="size-4" />
                {t("directorApprove")}
              </Button>
            </div>
          </div>
        ) : null}

        {showMarkPaid ? (
          <div className="grid gap-2">
            <label className="text-sm font-medium">{t("paidReference")}</label>
            <Input
              value={paidRef}
              onChange={(e) => setPaidRef(e.target.value)}
              placeholder="BCA transfer #12345"
            />
            <div className="flex justify-end">
              <Button onClick={onMarkPaid} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("markPaid")}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
