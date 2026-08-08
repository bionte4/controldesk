"use server";

/**
 * ControlDesk — Client-signature upload for monthly reports (Slice B).
 *
 * PM uploads the client's signed acknowledgement (photo / scanned PDF)
 * while recording the client's decision. Only valid while the report
 * is in `SENT_TO_CLIENT` — before dispatch there's no signature to
 * collect, and after the client decision the row is frozen.
 *
 * Mirrors `uploadCashAdvanceAttachmentsAction`. Auth + PDP + audit are
 * performed manually because `File` isn't Zod-serializable across the
 * server-action wire.
 */

import { revalidatePath } from "next/cache";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { recordAudit } from "@/lib/security/audit";
import { createClient } from "@/lib/supabase/server";
import { toCanonicalRole } from "@/lib/rbac/roles";
import { uploadAttachment } from "@/lib/attachments";
import type { ActionResult } from "@/lib/security/action-wrapper";

export async function uploadMonthlyReportSignatureAction(
  formData: FormData,
): Promise<
  ActionResult<{
    attachmentId: string;
    storagePath: string;
    fileName: string;
  }>
> {
  const reportId = formData.get("report_id");
  if (typeof reportId !== "string" || reportId.length < 8) {
    return {
      ok: false,
      code: "VALIDATION",
      reason: "report_id missing",
    };
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return {
      ok: false,
      code: "VALIDATION",
      reason: "No signature file provided.",
    };
  }

  const employee = await requireCurrentEmployee();
  const canonical = toCanonicalRole(employee.role);

  const supabase = await createClient();
  const { data: report, error } = await supabase
    .from("monthly_reports")
    .select(
      "id, status, project_id, tenant_id, pm_reviewer_id, submitter_employee_id",
    )
    .eq("id", reportId)
    .eq("tenant_id", employee.tenant_id)
    .maybeSingle();
  if (error || !report) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Monthly report not found.",
    };
  }

  // Only the assigned PM (or a management role) can attach a signature.
  // SPV shouldn't record client decisions.
  const isAssignedPm =
    report.pm_reviewer_id === employee.id ||
    canonical === "PM" ||
    canonical === "OM" ||
    canonical === "DIRECTOR" ||
    canonical === "ADMIN";
  if (!isAssignedPm) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Only the assigned PM (or higher) can attach a client signature.",
    };
  }

  if (report.status !== "SENT_TO_CLIENT") {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: `Signature can only be attached while the report is SENT_TO_CLIENT (current: ${report.status}).`,
    };
  }

  try {
    const uploaded = await uploadAttachment({
      tenantId: employee.tenant_id,
      uploaderEmployeeId: employee.id,
      resourceType: "monthly_report",
      resourceId: report.id,
      file,
    });

    await recordAudit({
      actionType: "CREATE",
      resourceName: "attachments",
      resourceId: report.id,
      newValues: {
        purpose: "client_signature",
        attachment_id: uploaded.attachment.id,
        monthly_report_id: report.id,
      },
    }).catch(() => {
      /* audit best-effort */
    });

    revalidatePath(
      `/projects/${report.project_id}/monthly-reports/${report.id}`,
    );
    return {
      ok: true,
      data: {
        attachmentId: uploaded.attachment.id,
        storagePath: uploaded.storagePath,
        fileName: file.name,
      },
    };
  } catch (err) {
    return {
      ok: false,
      code: "INTERNAL",
      reason: err instanceof Error ? err.message : "upload failed",
    };
  }
}
