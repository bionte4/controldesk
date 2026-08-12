"use client";

import { useTranslations } from "next-intl";

import { ApprovalActionDialog } from "@/components/approvals/approval-action-dialog";
import {
  approveTimesheetSchema,
  rejectTimesheetSchema,
} from "@/lib/validation/hr-schedule";

import { approveTimesheetAction, rejectTimesheetAction } from "./actions";

/**
 * Approver-side action bar for a timesheet row. Ceremony (form + toast +
 * refresh + loading state) is fully delegated to `<ApprovalActionDialog>`.
 */
export function TimesheetActionButtons({ id }: { id: string }) {
  const t = useTranslations("timesheets.actions");
  const tCommon = useTranslations("common");

  return (
    <div className="flex items-center gap-2">
      <ApprovalActionDialog
        intent="approve"
        schema={approveTimesheetSchema}
        defaultValues={{ id, comment: "" }}
        fields={[
          {
            name: "comment",
            label: t("comment"),
            placeholder: t("commentPlaceholder"),
          },
        ]}
        action={approveTimesheetAction}
        triggerLabel={t("approve")}
        title={t("approveTitle")}
        description={t("approveDescription")}
        confirmLabel={t("confirmApprove")}
        cancelLabel={tCommon("cancel")}
        successToast={t("approvedToast")}
        testId="timesheet-approve"
      />

      <ApprovalActionDialog
        intent="reject"
        schema={rejectTimesheetSchema}
        defaultValues={{ id, reason: "" }}
        fields={[
          {
            name: "reason",
            label: t("reason"),
            placeholder: t("reasonPlaceholder"),
          },
        ]}
        action={rejectTimesheetAction}
        triggerLabel={t("reject")}
        title={t("rejectTitle")}
        description={t("rejectDescription")}
        confirmLabel={t("confirmReject")}
        cancelLabel={tCommon("cancel")}
        successToast={t("rejectedToast")}
        testId="timesheet-reject"
      />
    </div>
  );
}
