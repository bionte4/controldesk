"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { authorize } from "@/lib/security/pdp";
import { recordAudit } from "@/lib/security/audit";
import { createClient } from "@/lib/supabase/server";
import { toCanonicalRole, toLegacyDbRole } from "@/lib/rbac/roles";
import { uploadAttachment, type UploadResult } from "@/lib/attachments";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";
import type { ActionResult } from "@/lib/security/action-wrapper";
import type { ExpenseStatus } from "@/types/database";

/**
 * Upload receipt files onto an existing expense (DRAFT or PENDING_L1 only).
 *
 * We use a FormData-based server action rather than a Zod-validated JSON
 * action because `File` isn't representable in a Zod schema over the
 * network. Auth + PDP + audit are done manually here to match the rest of
 * the codebase — this is the only server action that bypasses
 * `withSecureAction` in the expenses module.
 */
export async function uploadExpenseReceiptsAction(
  formData: FormData,
): Promise<ActionResult<{ uploaded: number; attachmentIds: string[] }>> {
  const expenseId = formData.get("expense_id");
  if (typeof expenseId !== "string" || expenseId.length < 8) {
    return { ok: false, code: "VALIDATION", reason: "expense_id missing" };
  }
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return { ok: false, code: "VALIDATION", reason: "No files provided." };
  }

  const employee = await requireCurrentEmployee();
  const rawRole = employee.role as AnyDbEmployeeRole;
  const canonicalRole = toCanonicalRole(rawRole);
  const legacyRole = toLegacyDbRole(canonicalRole);

  const supabase = await createClient();
  const { data: expense, error } = await supabase
    .from("project_expenses")
    .select("id, status, submitter_employee_id, project_id, tenant_id")
    .eq("id", expenseId)
    .eq("tenant_id", employee.tenant_id)
    .maybeSingle();
  if (error || !expense) {
    return { ok: false, code: "FORBIDDEN", reason: "Expense not found." };
  }

  // Only DRAFT/PENDING_L1 expenses accept new receipts, and only the
  // submitter can add them. Locked-down after L2 to preserve auditability.
  if (expense.submitter_employee_id !== employee.id) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: "Only the submitter may attach receipts.",
    };
  }
  const editableStates: ExpenseStatus[] = ["DRAFT", "PENDING_L1_SUPERVISOR"];
  if (!editableStates.includes(expense.status as ExpenseStatus)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      reason: `Receipts are locked at status ${expense.status}.`,
    };
  }

  // Formal PDP gate — reuse `update` policy for the expense.
  const decision = authorize({
    actor: {
      userId: employee.user_id,
      employeeId: employee.id,
      role: legacyRole,
      tenantId: employee.tenant_id,
    },
    action: "update",
    resource: "expense",
    attributes: {
      tenantId: employee.tenant_id,
      projectId: expense.project_id,
      ownerEmployeeId: expense.submitter_employee_id,
      status: expense.status as ExpenseStatus,
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
        resourceType: "project_expense",
        resourceId: expense.id,
        file,
      });
      results.push(uploaded);
    } catch (err) {
      // Abort the batch on first failure so the caller knows exactly which
      // file was rejected. Uploaded siblings remain — the user can retry
      // the remaining files.
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
    resourceId: expense.id,
    newValues: {
      files_uploaded: results.length,
      attachment_ids: results.map((r) => r.attachment.id),
      expense_id: expense.id,
    },
  }).catch(() => {
    /* audit is best-effort here since files are already persisted */
  });

  revalidatePath(`/finance/expenses/${expense.id}`);
  revalidatePath("/finance/expenses");

  return {
    ok: true,
    data: {
      uploaded: results.length,
      attachmentIds: results.map((r) => r.attachment.id),
    },
  };
}
