"use client";

import { useTranslations } from "next-intl";

import { ApprovalActionDialog } from "@/components/approvals/approval-action-dialog";
import {
  approveExpenseSchema,
  rejectExpenseSchema,
} from "@/lib/validation/expense";

import { approveExpenseAction, rejectExpenseAction } from "./actions";

/**
 * Approver-side action bar: paired Approve + Reject buttons with a
 * comment / reason dialog. Every ceremony (form + toast + refresh +
 * loading state) is delegated to `<ApprovalActionDialog>`. Used on the
 * expense detail page and inside the approvals inbox row overlay.
 */
export function ExpenseActionButtons({ id }: { id: string }) {
  const t = useTranslations("expenses.actions");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ApprovalActionDialog
        intent="approve"
        schema={approveExpenseSchema}
        defaultValues={{ id, comment: "" }}
        fields={[
          {
            name: "comment",
            label: t("comment"),
            placeholder: t("commentPlaceholder"),
          },
        ]}
        action={approveExpenseAction}
        triggerLabel={t("approve")}
        title={t("approveTitle")}
        description={t("approveDescription")}
        confirmLabel={t("confirmApprove")}
        cancelLabel={t("cancel")}
        successToast={t("approvedToast")}
        testId="expense-approve"
      />

      <ApprovalActionDialog
        intent="reject"
        schema={rejectExpenseSchema}
        defaultValues={{ id, reason: "" }}
        fields={[
          {
            name: "reason",
            label: t("reason"),
            placeholder: t("reasonPlaceholder"),
          },
        ]}
        action={rejectExpenseAction}
        triggerLabel={t("reject")}
        title={t("rejectTitle")}
        description={t("rejectDescription")}
        confirmLabel={t("confirmReject")}
        cancelLabel={t("cancel")}
        successToast={t("rejectedToast")}
        testId="expense-reject"
      />
    </div>
  );
}
