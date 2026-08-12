"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Play, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

import {
  applyBudgetRequestAction,
  approveBudgetRequestAction,
  cancelBudgetRequestAction,
  rejectBudgetRequestAction,
} from "./actions";

export type BudgetRequestActionMode =
  | "approve+reject"
  | "cancel"
  | "apply"
  | "none";

/**
 * Compact row-level action cluster for Budget Requests. Placement:
 *   - list on budget detail page
 *   - approvals inbox
 *
 * `mode="approve+reject"` = pending, actor can advance the chain.
 * `mode="cancel"`         = requester withdraws.
 * `mode="apply"`          = APPROVED → APPLIED (Finance / PM+).
 */
export function BudgetRequestActionButtons({
  id,
  mode,
}: {
  id: string;
  mode: BudgetRequestActionMode;
}) {
  if (mode === "none") return null;

  return (
    <div className="flex items-center gap-1.5">
      {mode === "approve+reject" ? (
        <>
          <ApproveButton id={id} />
          <RejectDialog id={id} />
        </>
      ) : null}
      {mode === "cancel" ? <CancelDialog id={id} /> : null}
      {mode === "apply" ? <ApplyButton id={id} /> : null}
    </div>
  );
}

function ApproveButton({ id }: { id: string }) {
  const t = useTranslations("budgetRequests.actions");
  const [isPending, startTransition] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const r = await approveBudgetRequestAction({ id });
          if (!r.ok) toast.error(r.reason);
          else toast.success(t("approvedToast"));
        })
      }
    >
      {isPending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Check className="size-3.5" />
      )}
      {t("approve")}
    </Button>
  );
}

function ApplyButton({ id }: { id: string }) {
  const t = useTranslations("budgetRequests.actions");
  const [isPending, startTransition] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="default"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const r = await applyBudgetRequestAction({ id });
          if (!r.ok) toast.error(r.reason);
          else toast.success(t("appliedToast"));
        })
      }
    >
      {isPending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Play className="size-3.5" />
      )}
      {t("apply")}
    </Button>
  );
}

function RejectDialog({ id }: { id: string }) {
  const t = useTranslations("budgetRequests.actions");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [isPending, startTransition] = React.useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="ghost">
            <X className="size-3.5" />
            {t("reject")}
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("rejectTitle")}</DialogTitle>
          <DialogDescription>{t("rejectDescription")}</DialogDescription>
        </DialogHeader>
        <Textarea
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("rejectPlaceholder")}
        />
        <DialogFooter>
          <DialogClose
            render={
              <Button variant="ghost" disabled={isPending}>
                {tCommon("cancel")}
              </Button>
            }
          />
          <Button
            variant="destructive"
            disabled={isPending || reason.trim().length === 0}
            onClick={() =>
              startTransition(async () => {
                const r = await rejectBudgetRequestAction({
                  id,
                  reason: reason.trim(),
                });
                if (!r.ok) {
                  toast.error(r.reason);
                  return;
                }
                toast.success(t("rejectedToast"));
                setOpen(false);
                setReason("");
              })
            }
          >
            {isPending ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : null}
            {t("rejectConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ id }: { id: string }) {
  const t = useTranslations("budgetRequests.actions");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [comment, setComment] = React.useState("");
  const [isPending, startTransition] = React.useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="ghost">
            <X className="size-3.5" />
            {t("cancel")}
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("cancelTitle")}</DialogTitle>
          <DialogDescription>{t("cancelDescription")}</DialogDescription>
        </DialogHeader>
        <Textarea
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t("cancelPlaceholder")}
        />
        <DialogFooter>
          <DialogClose
            render={
              <Button variant="ghost" disabled={isPending}>
                {tCommon("cancel")}
              </Button>
            }
          />
          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const r = await cancelBudgetRequestAction({
                  id,
                  comment: comment.trim() || undefined,
                });
                if (!r.ok) {
                  toast.error(r.reason);
                  return;
                }
                toast.success(t("cancelledToast"));
                setOpen(false);
                setComment("");
              })
            }
          >
            {isPending ? (
              <Loader2 className="mr-1 size-3.5 animate-spin" />
            ) : null}
            {t("cancelConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
