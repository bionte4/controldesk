"use client";

// DEPRECATED per rules §12 — hr_requests LEAVE/SICK/OVERTIME flow is
// superseded by the Timesheet module. Kept alive until the formal
// migration lands; still ships approve/reject buttons for any legacy
// rows in-flight. Wired to <ApprovalActionDialog> so the component
// stays consistent with the rest of the approval fleet.

import { useTranslations } from "next-intl";

import { ApprovalActionDialog } from "@/components/approvals/approval-action-dialog";
import {
  approveHrRequestSchema,
  rejectHrRequestSchema,
} from "@/lib/validation/hris";

import { approveHrRequestAction, rejectHrRequestAction } from "./actions";

export function HrActionButtons({ id }: { id: string }) {
  const t = useTranslations("hrRequests.actions");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ApprovalActionDialog
        intent="approve"
        schema={approveHrRequestSchema}
        defaultValues={{ id, comment: "" }}
        fields={[
          {
            name: "comment",
            label: t("comment"),
            placeholder: t("commentPlaceholder"),
          },
        ]}
        action={approveHrRequestAction}
        triggerLabel={t("approve")}
        title={t("approveTitle")}
        description={t("approveDescription")}
        confirmLabel={t("confirmApprove")}
        cancelLabel={t("cancel")}
        successToast={t("approvedToast")}
        testId="hr-request-approve"
      />

      <ApprovalActionDialog
        intent="reject"
        schema={rejectHrRequestSchema}
        defaultValues={{ id, reason: "" }}
        fields={[
          {
            name: "reason",
            label: t("reason"),
            placeholder: t("reasonPlaceholder"),
          },
        ]}
        action={rejectHrRequestAction}
        triggerLabel={t("reject")}
        title={t("rejectTitle")}
        description={t("rejectDescription")}
        confirmLabel={t("confirmReject")}
        cancelLabel={t("cancel")}
        successToast={t("rejectedToast")}
        testId="hr-request-reject"
      />
    </div>
  );
}
