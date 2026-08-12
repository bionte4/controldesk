"use server";

/**
 * ControlDesk — Petty Cash REPLENISHMENT attachments.
 *
 * Attachments per replenishment cover two lifecycle points:
 *   1. `request`  → custodian attaches memo pendukung, cash book snapshot,
 *                   photo of the tally sheet — evidence that the fund
 *                   needs topping up.
 *   2. `disburse` → Lead Finance attaches transfer proof (bank slip,
 *                   voucher stub) after the top-up hits the fund.
 *
 * Attachments are stored via the generic `attachments` registry with
 * `resource_type = "petty_cash_replenishment"`. Storage layout follows
 * rules §19: `{tenant_id}/petty_cash_replenishment/{replenishment_id}/{uuid}.ext`.
 *
 * Business rules:
 *   - Attachments are OPTIONAL for the request (vouchers themselves
 *     carry the underlying compliance evidence via their receipts) —
 *     but they materially help Finance review context.
 *   - Custodian may attach / detach only while status is `PENDING_FINANCE`
 *     (before Finance sees it). Attachments are FROZEN once Finance
 *     acts (approve / reject).
 *   - Finance may attach a transfer proof while status is `APPROVED`
 *     or `DISBURSED`, and detach only their own uploads while
 *     `APPROVED` (before the state locks post-disbursement).
 */

import { revalidatePath } from "next/cache";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { authorize } from "@/lib/security/pdp";
import { recordAudit } from "@/lib/security/audit";
import { createClient } from "@/lib/supabase/server";
import { toCanonicalRole, toLegacyDbRole } from "@/lib/rbac/roles";
import {
  BUCKET_ID,
  isAllowedMime,
  uploadAttachment,
} from "@/lib/attachments";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";
import type { ActionResult } from "@/lib/security/action-wrapper";
import type { PettyCashReplenishmentStatus } from "@/types/database";

// States where the custodian may still upload / detach memo docs.
const CUSTODIAN_EDITABLE: readonly PettyCashReplenishmentStatus[] = [
  "PENDING_FINANCE",
];
// States where Finance may upload / detach the transfer proof.
const FINANCE_EDITABLE: readonly PettyCashReplenishmentStatus[] = [
  "APPROVED",
  "DISBURSED",
];

// ---------------------------------------------------------------------------
// UPLOAD attachments (multipart FormData). The action supports both roles —
// custodian (memo) and Lead Finance (transfer proof). Which role is
// permitted depends on the current status of the replenishment.
// ---------------------------------------------------------------------------

export async function uploadReplenishmentAttachmentsAction(
  formData: FormData,
): Promise<ActionResult<{ uploaded: number; attachment_ids: string[] }>> {
  const replenishmentId = formData.get("replenishment_id");
  if (typeof replenishmentId !== "string" || replenishmentId.length < 8) {
    return {
      ok: false,
      code: "VALIDATION",
      reason: "replenishment_id missing",
    };
  }
  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    return { ok: false, code: "VALIDATION", reason: "No files provided." };
  }
  for (const f of files) {
    if (!isAllowedMime(f.type)) {
      return {
        ok: false,
        code: "VALIDATION",
        reason: `Unsupported file type: ${f.type} (${f.name})`,
      };
    }
  }

  const employee = await requireCurrentEmployee();
  const rawRole = employee.role as AnyDbEmployeeRole;
  const canonicalRole = toCanonicalRole(rawRole);
  const legacyRole = toLegacyDbRole(canonicalRole);

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("petty_cash_replenishments")
    .select("id, fund_id, status, requested_by")
    .eq("id", replenishmentId)
    .eq("tenant_id", employee.tenant_id)
    .maybeSingle();
  if (error || !row) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Replenishment not found.",
    };
  }

  const status = row.status as PettyCashReplenishmentStatus;
  const isCustodian = employee.id === row.requested_by;
  const isFinance =
    legacyRole === "LEAD_FINANCE" || legacyRole === "TENANT_ADMIN";

  // Enforce role-scoped state windows.
  if (isCustodian) {
    if (!CUSTODIAN_EDITABLE.includes(status)) {
      return {
        ok: false,
        code: "FORBIDDEN",
        reason: `Custodian attachments are locked at status ${status}.`,
      };
    }
  } else if (isFinance) {
    if (!FINANCE_EDITABLE.includes(status)) {
      return {
        ok: false,
        code: "FORBIDDEN",
        reason: `Finance attachments are only allowed after approval (status ${status}).`,
      };
    }
  } else {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Only the custodian or Lead Finance may attach documents.",
    };
  }

  const decision = authorize({
    actor: {
      userId: employee.user_id,
      employeeId: employee.id,
      role: legacyRole,
      tenantId: employee.tenant_id,
    },
    action: "update",
    resource: "petty_cash_replenishment",
    attributes: { tenantId: employee.tenant_id },
  });
  if (decision.effect === "DENY") {
    return { ok: false, code: "FORBIDDEN", reason: decision.reason };
  }

  const uploadedIds: string[] = [];
  for (const file of files) {
    try {
      const res = await uploadAttachment({
        tenantId: employee.tenant_id,
        uploaderEmployeeId: employee.id,
        resourceType: "petty_cash_replenishment",
        resourceId: row.id,
        file,
      });
      uploadedIds.push(res.attachment.id);
    } catch (err) {
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
    resourceId: row.id,
    newValues: {
      replenishment_id: row.id,
      fund_id: row.fund_id,
      files_uploaded: uploadedIds.length,
      attachment_ids: uploadedIds,
      uploader_kind: isCustodian ? "CUSTODIAN" : "FINANCE",
    },
  }).catch(() => {});

  revalidatePath(`/finance/petty-cash/${row.fund_id}`);
  revalidatePath("/finance/petty-cash");
  revalidatePath("/approvals");

  return {
    ok: true,
    data: { uploaded: uploadedIds.length, attachment_ids: uploadedIds },
  };
}

// ---------------------------------------------------------------------------
// DETACH — owner (custodian in PENDING_FINANCE, finance in APPROVED)
// removes their own previous upload.
// ---------------------------------------------------------------------------

export async function detachReplenishmentAttachmentAction(input: {
  replenishment_id: string;
  attachment_id: string;
}): Promise<ActionResult<{ id: string }>> {
  if (
    !input?.replenishment_id ||
    typeof input.replenishment_id !== "string" ||
    !input?.attachment_id ||
    typeof input.attachment_id !== "string"
  ) {
    return { ok: false, code: "VALIDATION", reason: "invalid input" };
  }

  const employee = await requireCurrentEmployee();
  const rawRole = employee.role as AnyDbEmployeeRole;
  const canonicalRole = toCanonicalRole(rawRole);
  const legacyRole = toLegacyDbRole(canonicalRole);

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("petty_cash_replenishments")
    .select("id, fund_id, status, requested_by")
    .eq("id", input.replenishment_id)
    .eq("tenant_id", employee.tenant_id)
    .maybeSingle();
  if (!row) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Replenishment not found.",
    };
  }

  const status = row.status as PettyCashReplenishmentStatus;
  const isCustodian = employee.id === row.requested_by;
  const isFinance =
    legacyRole === "LEAD_FINANCE" || legacyRole === "TENANT_ADMIN";

  // Role-based edit windows mirror the upload path.
  if (isCustodian && !CUSTODIAN_EDITABLE.includes(status)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: `Custodian attachments are locked at status ${status}.`,
    };
  }
  if (
    !isCustodian &&
    isFinance &&
    !(status === "APPROVED")
  ) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: `Finance can only detach transfer proof while APPROVED (status ${status}).`,
    };
  }
  if (!isCustodian && !isFinance) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Only the custodian or Lead Finance may manage documents.",
    };
  }

  const { data: att } = await supabase
    .from("attachments")
    .select(
      "id, storage_path, resource_type, resource_id, uploaded_by, tenant_id",
    )
    .eq("id", input.attachment_id)
    .eq("tenant_id", employee.tenant_id)
    .maybeSingle();
  if (!att) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Attachment not found.",
    };
  }
  if (
    att.resource_type !== "petty_cash_replenishment" ||
    att.resource_id !== input.replenishment_id
  ) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Attachment does not belong to this replenishment.",
    };
  }
  // Users may only detach their own uploads (audit hygiene). Tenant
  // admin bypass is implicit via the FINANCE_LIKE ALLOW above.
  if (
    att.uploaded_by !== employee.id &&
    legacyRole !== "TENANT_ADMIN"
  ) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "You can only detach files you uploaded.",
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
    .from(BUCKET_ID)
    .remove([att.storage_path])
    .catch(() => {
      /* orphan bounded — signed URL TTL is short */
    });

  await recordAudit({
    actionType: "DELETE",
    resourceName: "attachments",
    resourceId: att.id,
    oldValues: {
      replenishment_id: input.replenishment_id,
      storage_path: att.storage_path,
    },
  }).catch(() => {});

  revalidatePath(`/finance/petty-cash/${row.fund_id}`);
  revalidatePath("/finance/petty-cash");

  return { ok: true, data: { id: att.id } };
}
