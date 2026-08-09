"use client";

import { useTranslations } from "next-intl";

import { ApprovalActionDialog } from "@/components/approvals/approval-action-dialog";
import {
  approveCashAdvanceSchema,
  disburseCashAdvanceSchema,
  rejectCashAdvanceSchema,
} from "@/lib/validation/cash-advance";
import {
  approveCanonicalCashAdvanceSchema,
  disburseCanonicalCashAdvanceSchema,
  rejectCanonicalCashAdvanceSchema,
} from "@/lib/validation/cash-advance-canonical";

import {
  approveCashAdvanceAction,
  disburseCashAdvanceAction,
  rejectCashAdvanceAction,
} from "./actions";
import {
  approveCanonicalCashAdvanceAction,
  disburseCanonicalCashAdvanceAction,
  rejectCanonicalCashAdvanceAction,
} from "./actions-canonical";

/**
 * Two visual modes and two action flavours:
 *   - `mode="approve"` shows Approve/Reject dialogs (approver chain).
 *   - `mode="disburse"` shows Disburse dialog (Lead Finance releases funds).
 * The `flow` prop controls which backend action runs:
 *   - `flow="legacy"` (default) — Fase 1.4 chain with `PENDING_L*` statuses.
 *   - `flow="canonical"` — GAS-aligned chain with `PENDING_*` statuses.
 * The caller decides which flow to use based on the current row's status.
 *
 * The dialog ceremony (form + toast + refresh + loading state) is fully
 * delegated to `<ApprovalActionDialog>`.
 */
export function CashAdvanceActionButtons({
  id,
  mode,
  flow = "legacy",
}: {
  id: string;
  mode: "approve" | "disburse";
  flow?: "legacy" | "canonical";
}) {
  const t = useTranslations("cashAdvances.actions");
  const isCanonical = flow === "canonical";

  if (mode === "disburse") {
    return (
      <ApprovalActionDialog
        intent="disburse"
        schema={
          isCanonical
            ? disburseCanonicalCashAdvanceSchema
            : disburseCashAdvanceSchema
        }
        defaultValues={{ id, disbursement_ref: "" }}
        fields={[
          {
            name: "disbursement_ref",
            label: t("disbursementRef"),
            placeholder: "BCA/2026-08/00123",
            kind: "input",
          },
        ]}
        action={
          isCanonical
            ? disburseCanonicalCashAdvanceAction
            : disburseCashAdvanceAction
        }
        triggerLabel={t("disburse")}
        title={t("disburseTitle")}
        description={t("disburseDescription")}
        confirmLabel={t("confirmDisburse")}
        cancelLabel={t("cancel")}
        successToast={t("disbursedToast")}
        testId="ca-disburse"
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ApprovalActionDialog
        intent="approve"
        schema={
          isCanonical
            ? approveCanonicalCashAdvanceSchema
            : approveCashAdvanceSchema
        }
        defaultValues={{ id, comment: "" }}
        fields={[
          {
            name: "comment",
            label: t("comment"),
            placeholder: t("commentPlaceholder"),
          },
        ]}
        action={
          isCanonical
            ? approveCanonicalCashAdvanceAction
            : approveCashAdvanceAction
        }
        triggerLabel={t("approve")}
        title={t("approveTitle")}
        description={t("approveDescription")}
        confirmLabel={t("confirmApprove")}
        cancelLabel={t("cancel")}
        successToast={t("approvedToast")}
        testId="ca-approve"
      />

      <ApprovalActionDialog
        intent="reject"
        schema={
          isCanonical ? rejectCanonicalCashAdvanceSchema : rejectCashAdvanceSchema
        }
        defaultValues={{ id, reason: "" }}
        fields={[
          {
            name: "reason",
            label: t("reason"),
            placeholder: t("reasonPlaceholder"),
          },
        ]}
        action={
          isCanonical ? rejectCanonicalCashAdvanceAction : rejectCashAdvanceAction
        }
        triggerLabel={t("reject")}
        title={t("rejectTitle")}
        description={t("rejectDescription")}
        confirmLabel={t("confirmReject")}
        cancelLabel={t("cancel")}
        successToast={t("rejectedToast")}
        testId="ca-reject"
      />
    </div>
  );
}
