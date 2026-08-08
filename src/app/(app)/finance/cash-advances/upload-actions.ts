"use server";

/**
 * ControlDesk — Attachment upload for Cash Advances (Field-Ops focus).
 *
 * Mirrors `uploadExpenseReceiptsAction` — a FormData-based server action
 * because `File` isn't Zod-serializable across the wire. Auth + PDP +
 * audit are performed manually here.
 *
 * Business rule (rules §11 + mockup review notes):
 *   Attachments (Gmap screenshot, memo pendukung, foto site) are
 *   mandatory context for Lead Finance to review a field-ops CA. The
 *   submitter uploads while the row is still editable (DRAFT or its
 *   first-line pending state); L1+ approvers are read-only.
 */

import { revalidatePath } from "next/cache";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { authorize } from "@/lib/security/pdp";
import { recordAudit } from "@/lib/security/audit";
import { createClient } from "@/lib/supabase/server";
import { toCanonicalRole, toLegacyDbRole } from "@/lib/rbac/roles";
import { uploadAttachment, type UploadResult } from "@/lib/attachments";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";
import type { ActionResult } from "@/lib/security/action-wrapper";
import type { CashAdvanceStatus } from "@/types/database";

/**
 * States where the requester may still add supporting attachments.
 * Once the CA leaves the first-line supervisor step the file set is
 * frozen — approvers must react to the row as-submitted so an audit
 * timeline reflects what each approver actually saw.
 */
const EDITABLE_CA_STATES: readonly CashAdvanceStatus[] = [
  "DRAFT",
  "PENDING_SUPERVISOR",
  "PENDING_L1_SUPERVISOR",
];

export async function uploadCashAdvanceAttachmentsAction(
  formData: FormData,
): Promise<ActionResult<{ uploaded: number; attachmentIds: string[] }>> {
  const cashAdvanceId = formData.get("cash_advance_id");
  if (typeof cashAdvanceId !== "string" || cashAdvanceId.length < 8) {
    return {
      ok: false,
      code: "VALIDATION",
      reason: "cash_advance_id missing",
    };
  }
  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return { ok: false, code: "VALIDATION", reason: "No files provided." };
  }

  const employee = await requireCurrentEmployee();
  const rawRole = employee.role as AnyDbEmployeeRole;
  const canonicalRole = toCanonicalRole(rawRole);
  const legacyRole = toLegacyDbRole(canonicalRole);

  const supabase = await createClient();
  const { data: ca, error } = await supabase
    .from("cash_advances")
    .select("id, status, requester_employee_id, project_id, tenant_id, ca_type")
    .eq("id", cashAdvanceId)
    .eq("tenant_id", employee.tenant_id)
    .maybeSingle();
  if (error || !ca) {
    return { ok: false, code: "FORBIDDEN", reason: "Cash advance not found." };
  }

  if (ca.requester_employee_id !== employee.id) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Only the submitter may attach supporting files.",
    };
  }

  if (!EDITABLE_CA_STATES.includes(ca.status as CashAdvanceStatus)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: `Attachments are locked at status ${ca.status}.`,
    };
  }

  // Formal PDP gate — reuse the `update` policy for the cash advance.
  const decision = authorize({
    actor: {
      userId: employee.user_id,
      employeeId: employee.id,
      role: legacyRole,
      tenantId: employee.tenant_id,
    },
    action: "update",
    resource: "cash_advance",
    attributes: {
      tenantId: employee.tenant_id,
      projectId: ca.project_id,
      ownerEmployeeId: ca.requester_employee_id,
      status: ca.status as CashAdvanceStatus,
    },
  });
  if (decision.effect === "DENY") {
    return { ok: false, code: "FORBIDDEN", reason: decision.reason };
  }

  const results: UploadResult[] = [];
  for (const file of files) {
    try {
      const uploaded = await uploadAttachment({
        tenantId: employee.tenant_id,
        uploaderEmployeeId: employee.id,
        resourceType: "cash_advance",
        resourceId: ca.id,
        file,
      });
      results.push(uploaded);
    } catch (err) {
      // Abort on first failure so the caller learns the offending file;
      // siblings already uploaded stay persisted — the user can retry
      // just the failed ones without duplicating what's already done.
      return {
        ok: false,
        code: "INTERNAL",
        reason: err instanceof Error ? err.message : "upload failed",
      };
    }
  }

  await recordAudit({
    actionType: "CREATE",
    resourceName: "attachments",
    resourceId: ca.id,
    newValues: {
      files_uploaded: results.length,
      attachment_ids: results.map((r) => r.attachment.id),
      cash_advance_id: ca.id,
      ca_type: ca.ca_type,
    },
  }).catch(() => {
    /* audit is best-effort — files already persisted */
  });

  revalidatePath(`/finance/cash-advances/${ca.id}`);
  revalidatePath("/finance/cash-advances");

  return {
    ok: true,
    data: {
      uploaded: results.length,
      attachmentIds: results.map((r) => r.attachment.id),
    },
  };
}

// ---------------------------------------------------------------------------
// Detach — remove a previously uploaded attachment (owner only, only while
// the CA row is still editable). Mirrors `detachReceiptAction` for expenses.
// ---------------------------------------------------------------------------

export async function detachCashAdvanceAttachmentAction(input: {
  cash_advance_id: string;
  attachment_id: string;
}): Promise<ActionResult<{ id: string }>> {
  if (
    !input?.cash_advance_id ||
    typeof input.cash_advance_id !== "string" ||
    !input?.attachment_id ||
    typeof input.attachment_id !== "string"
  ) {
    return { ok: false, code: "VALIDATION", reason: "invalid input" };
  }

  const employee = await requireCurrentEmployee();
  const supabase = await createClient();

  const { data: ca } = await supabase
    .from("cash_advances")
    .select("id, status, requester_employee_id, tenant_id")
    .eq("id", input.cash_advance_id)
    .eq("tenant_id", employee.tenant_id)
    .maybeSingle();
  if (!ca) {
    return { ok: false, code: "FORBIDDEN", reason: "Cash advance not found." };
  }
  if (ca.requester_employee_id !== employee.id) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Only the submitter may detach supporting files.",
    };
  }
  if (!EDITABLE_CA_STATES.includes(ca.status as CashAdvanceStatus)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: `Attachments are locked at status ${ca.status}.`,
    };
  }

  // Load the attachment row + verify it belongs to this CA before deleting
  // — defense against a stale/replayed attachment_id from a different row.
  const { data: att } = await supabase
    .from("attachments")
    .select("id, storage_path, resource_type, resource_id, tenant_id")
    .eq("id", input.attachment_id)
    .eq("tenant_id", employee.tenant_id)
    .maybeSingle();
  if (!att) {
    return { ok: false, code: "FORBIDDEN", reason: "Attachment not found." };
  }
  if (
    att.resource_type !== "cash_advance" ||
    att.resource_id !== input.cash_advance_id
  ) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Attachment does not belong to this cash advance.",
    };
  }

  const { error: delErr } = await supabase
    .from("attachments")
    .delete()
    .eq("id", att.id);
  if (delErr) {
    return { ok: false, code: "INTERNAL", reason: delErr.message };
  }
  await supabase.storage
    .from("tenant-attachments")
    .remove([att.storage_path])
    .catch(() => {
      /* orphan is bounded — signed URL TTL is short */
    });

  await recordAudit({
    actionType: "DELETE",
    resourceName: "attachments",
    resourceId: att.id,
    oldValues: {
      cash_advance_id: input.cash_advance_id,
      storage_path: att.storage_path,
    },
  }).catch(() => {});

  revalidatePath(`/finance/cash-advances/${input.cash_advance_id}`);
  revalidatePath("/finance/cash-advances");

  return { ok: true, data: { id: att.id } };
}
