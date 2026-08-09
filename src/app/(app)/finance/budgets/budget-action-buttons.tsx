"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { ApprovalActionDialog } from "@/components/approvals/approval-action-dialog";
import { Button } from "@/components/ui/button";
import {
  approveBudgetSchema,
  cancelBudgetSchema,
  rejectBudgetSchema,
} from "@/lib/validation/budget";

import {
  approveBudgetAction,
  cancelBudgetAction,
  rejectBudgetAction,
  submitBudgetAction,
} from "./actions";

export type BudgetActionMode =
  | "submit"
  | "approve+reject"
  | "cancel"
  | "none";

/**
 * State-driven action bar. The parent decides which mode applies for the
 * current viewer × budget-status pair; this component just renders the
 * right buttons/dialogs and wires up the corresponding server action.
 *
 * `<ApprovalActionDialog>` handles the dialog ceremony (form + toast +
 * refresh + loading state) for approve/reject/cancel. Submit is a
 * standalone button because it has no user input — Zod schema only
 * needs `{ id }`.
 */
export function BudgetActionButtons({
  id,
  mode,
}: {
  id: string;
  mode: BudgetActionMode;
}) {
  const t = useTranslations("budgets.actions");
  const router = useRouter();
  const [isSubmitting, startSubmit] = React.useTransition();

  function handleSubmit() {
    startSubmit(async () => {
      const result = await submitBudgetAction({ id });
      if (result.ok) {
        toast.success(t("submittedToast"));
        router.refresh();
      } else {
        toast.error(result.reason);
      }
    });
  }

  if (mode === "none") return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {mode === "submit" ? (
        <Button
          type="button"
          size="sm"
          onClick={handleSubmit}
          disabled={isSubmitting}
          data-testid="budget-submit-trigger"
        >
          {isSubmitting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          {t("submit")}
        </Button>
      ) : null}

      {mode === "approve+reject" ? (
        <>
          <ApprovalActionDialog
            intent="approve"
            schema={approveBudgetSchema}
            defaultValues={{ id, comment: "" }}
            fields={[
              {
                name: "comment",
                label: t("comment"),
                placeholder: t("commentPlaceholder"),
              },
            ]}
            action={approveBudgetAction}
            triggerLabel={t("approve")}
            title={t("approveTitle")}
            description={t("approveDescription")}
            confirmLabel={t("confirmApprove")}
            cancelLabel={t("cancel")}
            successToast={t("approvedToast")}
            testId="budget-approve"
          />

          <ApprovalActionDialog
            intent="reject"
            schema={rejectBudgetSchema}
            defaultValues={{ id, reason: "" }}
            fields={[
              {
                name: "reason",
                label: t("reason"),
                placeholder: t("reasonPlaceholder"),
              },
            ]}
            action={rejectBudgetAction}
            triggerLabel={t("reject")}
            title={t("rejectTitle")}
            description={t("rejectDescription")}
            confirmLabel={t("confirmReject")}
            cancelLabel={t("cancel")}
            successToast={t("rejectedToast")}
            testId="budget-reject"
          />
        </>
      ) : null}

      {mode === "cancel" ? (
        <ApprovalActionDialog
          intent="cancel"
          schema={cancelBudgetSchema}
          defaultValues={{ id, reason: "" }}
          fields={[
            {
              name: "reason",
              label: t("reason"),
              placeholder: t("cancelReasonPlaceholder"),
            },
          ]}
          action={cancelBudgetAction}
          triggerLabel={t("cancelBudget")}
          title={t("cancelTitle")}
          description={t("cancelDescription")}
          confirmLabel={t("confirmCancel")}
          cancelLabel={t("cancel")}
          successToast={t("cancelledToast")}
          confirmVariant="destructive"
          testId="budget-cancel"
        />
      ) : null}
    </div>
  );
}
