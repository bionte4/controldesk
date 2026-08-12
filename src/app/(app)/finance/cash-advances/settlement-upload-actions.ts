"use server";

/**
 * ControlDesk — Cash Advance SETTLEMENT attachments.
 *
 * These actions handle the receipts (nota / struk) that the requester
 * attaches to a settlement submission. They are separate from the
 * CA-level attachments (`resource_type = "cash_advance"`) which cover
 * supporting docs (foto site, Gmap screenshot, memo).
 *
 * Business rules (rules §11 + §19):
 *   - Only the CA requester may attach / detach receipts.
 *   - Hard require: `total_spent > 0` MUST have >= 1 receipt attached
 *     (compliance — audit UU KUP retention 10y, rules §22).
 *   - Attachments may be added while `settlement.status = 'SUBMITTED'`
 *     and NOT yet `ACCEPTED`. Once Finance accepts, the file set is
 *     frozen (audit reflects what Finance actually saw).
 *   - On resubmit after RETURNED: attachments from the last returned
 *     submission are COPIED FORWARD to the new row (both storage file
 *     and registry row are duplicated so the returned submission
 *     retains its original evidence intact).
 *
 * Storage layout (rules §19):
 *   `{tenant_id}/cash_advance_settlement/{settlement_id}/{uuid}.{ext}`
 *
 * State machine impact:
 *   Row is still inserted directly as `SUBMITTED` — the upload happens
 *   in the same server round-trip (FormData multipart). If any file
 *   fails to upload, the settlement row is rolled back so we never
 *   leave a SUBMITTED row without evidence.
 */

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { authorize } from "@/lib/security/pdp";
import { recordAudit } from "@/lib/security/audit";
import { createClient } from "@/lib/supabase/server";
import { toCanonicalRole, toLegacyDbRole } from "@/lib/rbac/roles";
import {
  BUCKET_ID,
  isAllowedMime,
  uploadAttachment,
  type AllowedMime,
} from "@/lib/attachments";
import { moneyToDbString } from "@/lib/format/money";
import { notifyRoles } from "@/lib/notifications/service";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";
import type { ActionResult } from "@/lib/security/action-wrapper";
import type {
  CashAdvanceSettlementStatus,
  CashAdvanceStatus,
} from "@/types/database";

// ---------------------------------------------------------------------------
// Shared guards
// ---------------------------------------------------------------------------

/** States in which the requester may still add / detach receipts. */
const EDITABLE_SETTLEMENT_STATES: readonly CashAdvanceSettlementStatus[] = [
  "SUBMITTED",
];

/**
 * Load the parent CA + verify it's in DISBURSED state and belongs to
 * this actor. Returns null on any mismatch so the caller can fold into
 * an ActionResult (rules §17 — no throws to the client).
 */
async function loadDisbursedCa(
  supabase: Awaited<ReturnType<typeof createClient>>,
  cashAdvanceId: string,
  tenantId: string,
): Promise<
  | { id: string; requester_employee_id: string; status: CashAdvanceStatus }
  | null
> {
  const { data, error } = await supabase
    .from("cash_advances")
    .select("id, requester_employee_id, status")
    .eq("id", cashAdvanceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    requester_employee_id: data.requester_employee_id,
    status: data.status as CashAdvanceStatus,
  };
}

// ---------------------------------------------------------------------------
// SUBMIT SETTLEMENT WITH RECEIPTS (single-round-trip FormData action)
// ---------------------------------------------------------------------------

export type SubmitSettlementWithReceiptsResult = {
  settlement_id: string;
  status: CashAdvanceSettlementStatus;
  attachments_uploaded: number;
  attachments_copied_forward: number;
};

/**
 * Submit a settlement with its receipts in one atomic-ish server call.
 *
 * FormData contract:
 *   - `cash_advance_id`: string (uuid)
 *   - `total_spent_idr`: string (raw integer, IDR — parsed to bigint)
 *   - `notes`: string (optional)
 *   - `files`: File[] (0..N)
 *
 * Hard rules enforced server-side:
 *   - `total_spent > 0` requires attachments OR a copy-forward from a
 *     prior RETURNED submission (>= 1 total). Otherwise return
 *     VALIDATION error.
 *   - `total_spent == 0` allows zero attachments (fully refunded).
 */
export async function submitSettlementWithReceiptsAction(
  formData: FormData,
): Promise<ActionResult<SubmitSettlementWithReceiptsResult>> {
  // ---- 1. Input parsing (defensive — never throw to client) ------------
  const cashAdvanceId = formData.get("cash_advance_id");
  const totalSpentRaw = formData.get("total_spent_idr");
  const notesRaw = formData.get("notes");
  if (typeof cashAdvanceId !== "string" || cashAdvanceId.length < 8) {
    return { ok: false, code: "VALIDATION", reason: "cash_advance_id missing" };
  }
  const totalSpent = Number(
    typeof totalSpentRaw === "string"
      ? totalSpentRaw.replaceAll(".", "").replaceAll(",", "")
      : totalSpentRaw,
  );
  if (!Number.isFinite(totalSpent) || totalSpent < 0) {
    return {
      ok: false,
      code: "VALIDATION",
      reason: "total_spent_idr must be a non-negative integer",
    };
  }
  const notes =
    typeof notesRaw === "string" && notesRaw.trim().length > 0
      ? notesRaw.trim()
      : null;

  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);

  // Pre-validate each file's mime type up-front so we don't insert a
  // settlement row and then have to roll it back.
  for (const f of files) {
    if (!isAllowedMime(f.type)) {
      return {
        ok: false,
        code: "VALIDATION",
        reason: `Unsupported file type: ${f.type} (${f.name})`,
      };
    }
  }

  // ---- 2. Auth + PDP -----------------------------------------------------
  const employee = await requireCurrentEmployee();
  const rawRole = employee.role as AnyDbEmployeeRole;
  const canonicalRole = toCanonicalRole(rawRole);
  const legacyRole = toLegacyDbRole(canonicalRole);

  const supabase = await createClient();
  const ca = await loadDisbursedCa(supabase, cashAdvanceId, employee.tenant_id);
  if (!ca) {
    return { ok: false, code: "FORBIDDEN", reason: "Cash advance not found." };
  }
  if (ca.status !== "DISBURSED") {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Only DISBURSED cash advances can be settled.",
    };
  }
  if (ca.requester_employee_id !== employee.id) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Only the requester may submit settlement.",
    };
  }

  const decision = authorize({
    actor: {
      userId: employee.user_id,
      employeeId: employee.id,
      role: legacyRole,
      tenantId: employee.tenant_id,
    },
    action: "submit",
    resource: "cash_advance_settlement",
    attributes: {
      tenantId: employee.tenant_id,
      ownerEmployeeId: ca.requester_employee_id,
    },
  });
  if (decision.effect === "DENY") {
    return { ok: false, code: "FORBIDDEN", reason: decision.reason };
  }

  // ---- 3. Detect prior RETURNED submission (copy-forward source) --------
  const { data: priorReturned } = await supabase
    .from("cash_advance_settlements")
    .select("id, returned_at")
    .eq("cash_advance_id", ca.id)
    .eq("tenant_id", employee.tenant_id)
    .eq("status", "RETURNED")
    .order("returned_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let priorAttachments: Array<{
    id: string;
    storage_path: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
  }> = [];
  if (priorReturned) {
    const { data } = await supabase
      .from("attachments")
      .select("id, storage_path, filename, mime_type, size_bytes")
      .eq("resource_type", "cash_advance_settlement")
      .eq("resource_id", priorReturned.id)
      .eq("tenant_id", employee.tenant_id);
    priorAttachments = (data ?? []) as typeof priorAttachments;
  }

  // ---- 4. Hard-require validation ---------------------------------------
  // total_spent > 0 requires >= 1 attachment across (new files + copy-forward).
  const totalFilesAvailable = files.length + priorAttachments.length;
  if (totalSpent > 0 && totalFilesAvailable === 0) {
    return {
      ok: false,
      code: "VALIDATION",
      reason:
        "At least one receipt attachment is required when total_spent > 0.",
    };
  }

  // ---- 5. Insert settlement row (as SUBMITTED) --------------------------
  const nowIso = new Date().toISOString();
  const totalSpentDb = moneyToDbString(BigInt(totalSpent));

  const { data: inserted, error: insertErr } = await supabase
    .from("cash_advance_settlements")
    .insert({
      tenant_id: employee.tenant_id,
      cash_advance_id: ca.id,
      submitted_by: employee.id,
      status: "SUBMITTED",
      total_spent: totalSpentDb as unknown as number,
      notes,
      submitted_at: nowIso,
    })
    .select("id, status")
    .single();
  if (insertErr || !inserted) {
    return {
      ok: false,
      code: "INTERNAL",
      reason: insertErr?.message ?? "Failed to insert settlement.",
    };
  }
  const settlementId = inserted.id;

  // ---- 6. Upload new files ----------------------------------------------
  const uploadedPaths: string[] = [];
  const uploadedIds: string[] = [];
  try {
    for (const file of files) {
      const res = await uploadAttachment({
        tenantId: employee.tenant_id,
        uploaderEmployeeId: employee.id,
        resourceType: "cash_advance_settlement",
        resourceId: settlementId,
        file,
      });
      uploadedPaths.push(res.storagePath);
      uploadedIds.push(res.attachment.id);
    }
  } catch (err) {
    await rollbackSettlement(supabase, {
      settlementId,
      tenantId: employee.tenant_id,
      storagePaths: uploadedPaths,
    });
    return {
      ok: false,
      code: "INTERNAL",
      reason: err instanceof Error ? err.message : "receipt upload failed",
    };
  }

  // ---- 7. Copy-forward from prior RETURNED (if any) ---------------------
  const copiedIds: string[] = [];
  if (priorAttachments.length > 0) {
    for (const prior of priorAttachments) {
      // Storage: server-side copy to new deterministic path under the
      // new settlement id. This preserves the returned submission's
      // originals for audit.
      const ext =
        prior.filename.lastIndexOf(".") > -1
          ? prior.filename.slice(prior.filename.lastIndexOf(".") + 1)
          : "bin";
      const newPath = `${employee.tenant_id}/cash_advance_settlement/${settlementId}/${randomUUID()}.${ext}`;

      const { error: copyErr } = await supabase.storage
        .from(BUCKET_ID)
        .copy(prior.storage_path, newPath);
      if (copyErr) {
        // Rollback: delete new files + settlement row so caller can retry.
        await rollbackSettlement(supabase, {
          settlementId,
          tenantId: employee.tenant_id,
          storagePaths: [...uploadedPaths, ...copiedIds.map(() => "")].filter(
            Boolean,
          ),
        });
        return {
          ok: false,
          code: "INTERNAL",
          reason: `Failed to copy prior receipt: ${copyErr.message}`,
        };
      }

      const { data: attRow, error: insErr } = await supabase
        .from("attachments")
        .insert({
          tenant_id: employee.tenant_id,
          resource_type: "cash_advance_settlement",
          resource_id: settlementId,
          storage_path: newPath,
          filename: prior.filename,
          mime_type: prior.mime_type as AllowedMime,
          size_bytes: prior.size_bytes,
          uploaded_by: employee.id,
        })
        .select("id")
        .single();
      if (insErr || !attRow) {
        // Roll back the just-copied storage object then bail.
        await supabase.storage
          .from(BUCKET_ID)
          .remove([newPath])
          .catch(() => {});
        await rollbackSettlement(supabase, {
          settlementId,
          tenantId: employee.tenant_id,
          storagePaths: uploadedPaths,
        });
        return {
          ok: false,
          code: "INTERNAL",
          reason: insErr?.message ?? "Failed to register copied receipt.",
        };
      }
      copiedIds.push(attRow.id);
    }
  }

  // ---- 8. Notifications + revalidation ----------------------------------
  await notifyRoles({
    tenantId: employee.tenant_id,
    roles: ["LEAD_FINANCE", "TENANT_ADMIN"],
    kind: "APPROVAL_REQUESTED",
    title: "Cash advance settlement submitted",
    actionUrl: `/finance/cash-advances/${ca.id}`,
  });

  await recordAudit({
    actionType: "SUBMIT",
    resourceName: "cash_advance_settlements",
    resourceId: settlementId,
    newValues: {
      cash_advance_id: ca.id,
      total_spent: totalSpentDb,
      attachments_uploaded: uploadedIds.length,
      attachments_copied_forward: copiedIds.length,
      prior_returned_id: priorReturned?.id ?? null,
    },
  }).catch(() => {
    /* best-effort */
  });

  revalidatePath(`/finance/cash-advances/${ca.id}`);
  revalidatePath("/finance/cash-advances");

  return {
    ok: true,
    data: {
      settlement_id: settlementId,
      status: inserted.status as CashAdvanceSettlementStatus,
      attachments_uploaded: uploadedIds.length,
      attachments_copied_forward: copiedIds.length,
    },
  };
}

async function rollbackSettlement(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: {
    settlementId: string;
    tenantId: string;
    storagePaths: string[];
  },
): Promise<void> {
  // Best-effort cleanup — orphan storage objects are bounded by the
  // signed-URL TTL. We prioritise removing the DB row so RLS never
  // exposes a SUBMITTED row without evidence.
  if (input.storagePaths.length > 0) {
    await supabase.storage
      .from(BUCKET_ID)
      .remove(input.storagePaths)
      .catch(() => {});
  }
  await supabase
    .from("attachments")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("resource_type", "cash_advance_settlement")
    .eq("resource_id", input.settlementId);
  await supabase
    .from("cash_advance_settlements")
    .delete()
    .eq("id", input.settlementId)
    .eq("tenant_id", input.tenantId);
}

// ---------------------------------------------------------------------------
// ADD RECEIPTS to an EXISTING (SUBMITTED) settlement — used by the detail
// page when the requester realises they missed a nota after the fact.
// ---------------------------------------------------------------------------

export async function uploadSettlementReceiptsAction(
  formData: FormData,
): Promise<ActionResult<{ uploaded: number; attachment_ids: string[] }>> {
  const settlementId = formData.get("settlement_id");
  if (typeof settlementId !== "string" || settlementId.length < 8) {
    return { ok: false, code: "VALIDATION", reason: "settlement_id missing" };
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
  const { data: settlement, error } = await supabase
    .from("cash_advance_settlements")
    .select(
      "id, cash_advance_id, status, tenant_id, submitted_by, cash_advances!inner(id, requester_employee_id)",
    )
    .eq("id", settlementId)
    .eq("tenant_id", employee.tenant_id)
    .maybeSingle();
  if (error || !settlement) {
    return { ok: false, code: "FORBIDDEN", reason: "Settlement not found." };
  }
  const parentCa = Array.isArray(settlement.cash_advances)
    ? settlement.cash_advances[0]
    : settlement.cash_advances;
  if (
    !parentCa ||
    parentCa.requester_employee_id !== employee.id ||
    settlement.submitted_by !== employee.id
  ) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Only the submitter may attach receipts to a settlement.",
    };
  }
  if (
    !EDITABLE_SETTLEMENT_STATES.includes(
      settlement.status as CashAdvanceSettlementStatus,
    )
  ) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: `Attachments are locked at settlement status ${settlement.status}.`,
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
    resource: "cash_advance_settlement",
    attributes: {
      tenantId: employee.tenant_id,
      ownerEmployeeId: parentCa.requester_employee_id,
    },
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
        resourceType: "cash_advance_settlement",
        resourceId: settlement.id,
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
    resourceId: settlement.id,
    newValues: {
      settlement_id: settlement.id,
      cash_advance_id: parentCa.id,
      files_uploaded: uploadedIds.length,
      attachment_ids: uploadedIds,
    },
  }).catch(() => {});

  revalidatePath(`/finance/cash-advances/${parentCa.id}`);

  return {
    ok: true,
    data: { uploaded: uploadedIds.length, attachment_ids: uploadedIds },
  };
}

// ---------------------------------------------------------------------------
// DETACH — remove a single receipt while the settlement is still SUBMITTED.
// ---------------------------------------------------------------------------

export async function detachSettlementReceiptAction(input: {
  settlement_id: string;
  attachment_id: string;
}): Promise<ActionResult<{ id: string }>> {
  if (
    !input?.settlement_id ||
    typeof input.settlement_id !== "string" ||
    !input?.attachment_id ||
    typeof input.attachment_id !== "string"
  ) {
    return { ok: false, code: "VALIDATION", reason: "invalid input" };
  }

  const employee = await requireCurrentEmployee();
  const supabase = await createClient();

  const { data: settlement } = await supabase
    .from("cash_advance_settlements")
    .select(
      "id, cash_advance_id, status, submitted_by, cash_advances!inner(requester_employee_id)",
    )
    .eq("id", input.settlement_id)
    .eq("tenant_id", employee.tenant_id)
    .maybeSingle();
  if (!settlement) {
    return { ok: false, code: "FORBIDDEN", reason: "Settlement not found." };
  }
  const parentCa = Array.isArray(settlement.cash_advances)
    ? settlement.cash_advances[0]
    : settlement.cash_advances;
  if (!parentCa || parentCa.requester_employee_id !== employee.id) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Only the submitter may detach settlement receipts.",
    };
  }
  if (
    !EDITABLE_SETTLEMENT_STATES.includes(
      settlement.status as CashAdvanceSettlementStatus,
    )
  ) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: `Attachments are locked at settlement status ${settlement.status}.`,
    };
  }

  const { data: att } = await supabase
    .from("attachments")
    .select("id, storage_path, resource_type, resource_id")
    .eq("id", input.attachment_id)
    .eq("tenant_id", employee.tenant_id)
    .maybeSingle();
  if (!att) {
    return { ok: false, code: "FORBIDDEN", reason: "Attachment not found." };
  }
  if (
    att.resource_type !== "cash_advance_settlement" ||
    att.resource_id !== input.settlement_id
  ) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Attachment does not belong to this settlement.",
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
      settlement_id: input.settlement_id,
      storage_path: att.storage_path,
    },
  }).catch(() => {});

  revalidatePath(`/finance/cash-advances/${settlement.cash_advance_id}`);

  return { ok: true, data: { id: att.id } };
}
