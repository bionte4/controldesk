"use client";

// DEPRECATED per rules §13 — PM handover module is scheduled for drop in
// migration 0.4 (replacement: change-log + notify on
// project_employee_assignments edit). Wired to <ApprovalActionDialog> so
// the component stays consistent with the rest of the approval fleet
// until the module is fully removed.

import { Play } from "lucide-react";
import { useTranslations } from "next-intl";

import { ApprovalActionDialog } from "@/components/approvals/approval-action-dialog";
import {
  approvePmHandoverSchema,
  executePmHandoverSchema,
  rejectPmHandoverSchema,
} from "@/lib/validation/handover";

import {
  approvePmHandoverAction,
  executePmHandoverAction,
  rejectPmHandoverAction,
} from "./actions";

export function HandoverActionButtons({
  id,
  mode,
}: {
  id: string;
  mode: "approve" | "execute";
}) {
  const t = useTranslations("handovers.actions");

  if (mode === "execute") {
    // Execute is a "confirmation-only" flow — no user input to capture,
    // just a modal to prevent accidental execution. Empty `fields`
    // array is fine; the dialog still renders the confirm/cancel
    // footer via the shared shell.
    return (
      <ApprovalActionDialog
        intent="custom"
        icon={<Play className="size-4" />}
        schema={executePmHandoverSchema}
        defaultValues={{ id }}
        fields={[]}
        action={executePmHandoverAction}
        triggerLabel={t("execute")}
        title={t("executeTitle")}
        description={t("executeDescription")}
        confirmLabel={t("confirmExecute")}
        cancelLabel={t("cancel")}
        successToast={t("executedToast")}
        testId="handover-execute"
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ApprovalActionDialog
        intent="approve"
        schema={approvePmHandoverSchema}
        defaultValues={{ id, comment: "" }}
        fields={[
          {
            name: "comment",
            label: t("comment"),
            placeholder: t("commentPlaceholder"),
          },
        ]}
        action={approvePmHandoverAction}
        triggerLabel={t("approve")}
        title={t("approveTitle")}
        description={t("approveDescription")}
        confirmLabel={t("confirmApprove")}
        cancelLabel={t("cancel")}
        successToast={t("approvedToast")}
        testId="handover-approve"
      />

      <ApprovalActionDialog
        intent="reject"
        schema={rejectPmHandoverSchema}
        defaultValues={{ id, reason: "" }}
        fields={[
          {
            name: "reason",
            label: t("reason"),
            placeholder: t("reasonPlaceholder"),
          },
        ]}
        action={rejectPmHandoverAction}
        triggerLabel={t("reject")}
        title={t("rejectTitle")}
        description={t("rejectDescription")}
        confirmLabel={t("confirmReject")}
        cancelLabel={t("cancel")}
        successToast={t("rejectedToast")}
        testId="handover-reject"
      />
    </div>
  );
}
