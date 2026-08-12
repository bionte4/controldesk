"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { moneyToDbString, parseMoneyFromDb } from "@/lib/format/money";
import { createClient } from "@/lib/supabase/server";
import { assertPostableCoa } from "@/lib/data/coa";
import { assertProjectOperational } from "@/lib/data/projects";
import { notifyRoles, notifyUser } from "@/lib/notifications/service";
import { translatorFor } from "@/lib/notifications/localize";
import type { EmployeeRole } from "@/lib/rbac/roles";
import type { TablesUpdate } from "@/types/database";
import {
  approveExpenseSchema,
  assignExpenseBudgetLineSchema,
  assignExpenseCoaSchema,
  cancelExpenseSchema,
  deleteDraftExpenseSchema,
  detachReceiptSchema,
  evaluateLateSubmission,
  EXPENSE_INCURRED_MAX_BUSINESS_DAYS,
  rejectExpenseSchema,
  saveDraftExpenseSchema,
  submitDraftExpenseSchema,
  submitExpenseSchema,
  updateDraftExpenseSchema,
} from "@/lib/validation/expense";
import { businessDaysUntil } from "@/lib/format/business-days";
import {
  canApproveNext,
  expectedApproverRole,
  nextExpenseStatus,
} from "@/lib/expenses/state";
import type {
  ApprovalAction as ApprovalActionEnum,
  ExpenseStatus,
} from "@/types/database";
import { deleteAttachment } from "@/lib/attachments";

/**
 * ControlDesk expense server actions (rules §9 · Value-based approval).
 *
 * DRAFT-first lifecycle:
 *   saveDraftExpenseAction        insert row at status DRAFT
 *   updateDraftExpenseAction      edit DRAFT (or PENDING_L1 if submitter)
 *   submitDraftExpenseAction      DRAFT → PENDING_L1_SUPERVISOR + notify Supervisor
 *   deleteDraftExpenseAction      hard-delete a DRAFT (submitter-only)
 *   approveExpenseAction          escalate one step + notify next approver
 *   rejectExpenseAction           terminal REJECTED + notify submitter
 *   cancelExpenseAction           submitter withdraws non-terminal item
 *   detachReceiptAction           remove one uploaded receipt from a draft
 *   submitExpenseAction (legacy)  single-shot insert-and-submit (deprecated)
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map internal expense_status → PDP pendingApprovalLevel so we can reuse
 * the `expense` policy in `pdp.ts` without duplicating logic.
 */
function statusToPdpLevel(status: ExpenseStatus) {
  switch (status) {
    case "PENDING_L1_SUPERVISOR":
      return "L1_SUPERVISOR" as const;
    case "PENDING_L2_PROJECT_MANAGER":
      return "L2_PROJECT_MANAGER" as const;
    case "PENDING_L2_5_FINANCE":
      return "L2_5_FINANCE" as const;
    case "PENDING_L3_OPERATIONS_MANAGER":
      return "L3_OPERATIONS_MANAGER" as const;
    case "PENDING_L4_HEAD_MANAGER":
      return "L4_HEAD_MANAGER" as const;
    case "PENDING_L5_GENERAL_MANAGER":
      return "L5_GENERAL_MANAGER" as const;
    default:
      return undefined;
  }
}

function revalidateExpense(id: string, projectId: string) {
  revalidatePath("/finance/expenses");
  revalidatePath(`/finance/expenses/${id}`);
  revalidatePath("/approvals");
  revalidatePath(`/projects/${projectId}`);
}

// ---------------------------------------------------------------------------
// SAVE DRAFT — new row at status DRAFT. No notifications, no approval routing.
// ---------------------------------------------------------------------------
export const saveDraftExpenseAction = withSecureAction({
  schema: saveDraftExpenseSchema,
  resource: "expense",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "project_expenses",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data } = await supabase.rpc("is_assigned_to_project", {
      p_project_id: input.project_id,
    });
    return {
      tenantId: ctx.actor.tenantId,
      projectId: input.project_id,
      isActiveAssignment: Boolean(data),
      amountIDR: input.amount_idr,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    // Fase 1 gate — refuse ops on DRAFT / PLANNING / ARCHIVED
    // projects. Runs before ANY write so we don't half-create a row
    // and roll it back later.
    await assertProjectOperational(input.project_id);
    const amountDb = moneyToDbString(BigInt(input.amount_idr));
    // Validate CoA before touching the row. Returns null when absent.
    const validCoaId = await assertPostableCoa(input.coa_id);

    const { data: inserted, error: insertErr } = await supabase
      .from("project_expenses")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id,
        submitter_employee_id: ctx.actor.employeeId,
        amount: amountDb as unknown as number,
        category: input.category ?? "MISC",
        budget_detail_id: input.budget_detail_id ?? null,
        coa_id: validCoaId,
        payment_method: input.payment_method ?? null,
        description: input.description,
        notes: input.notes ?? null,
        incurred_on: input.incurred_on,
        late_submission_reason: input.late_submission_reason ?? null,
        status: "DRAFT",
      })
      .select("id, status")
      .single();
    if (insertErr || !inserted) {
      throw new Error(insertErr?.message ?? "Failed to save draft.");
    }

    revalidateExpense(inserted.id, input.project_id);
    return {
      result: { id: inserted.id, status: inserted.status as ExpenseStatus },
      auditResourceId: inserted.id,
      auditNewValues: {
        amount: amountDb,
        status: "DRAFT",
        project_id: input.project_id,
        budget_detail_id: input.budget_detail_id ?? null,
        coa_id: validCoaId,
        payment_method: input.payment_method ?? null,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// UPDATE DRAFT — submitter edits their own row while still DRAFT (or
// PENDING_L1_SUPERVISOR — PDP `update` verb permits both states).
// ---------------------------------------------------------------------------
export const updateDraftExpenseAction = withSecureAction({
  schema: updateDraftExpenseSchema,
  resource: "expense",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_expenses",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("project_expenses")
      .select("status, submitter_employee_id, project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.submitter_employee_id ?? undefined,
      amountIDR: input.amount_idr,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: existing, error: readErr } = await supabase
      .from("project_expenses")
      .select("id, status, project_id, submitter_employee_id, amount")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !existing) throw new Error("Expense not found.");
    if (existing.submitter_employee_id !== ctx.actor.employeeId) {
      throw new Error("Only the submitter may edit this draft.");
    }
    if (existing.status !== "DRAFT" && existing.status !== "PENDING_L1_SUPERVISOR") {
      throw new Error("Only DRAFT or PENDING_L1 expenses can be edited.");
    }

    const amountDb = moneyToDbString(BigInt(input.amount_idr));
    const validCoaId = await assertPostableCoa(input.coa_id);
    const patch: TablesUpdate<"project_expenses"> = {
      project_id: input.project_id,
      amount: amountDb as unknown as number,
      category: input.category ?? "MISC",
      budget_detail_id: input.budget_detail_id ?? null,
      coa_id: validCoaId,
      payment_method: input.payment_method ?? null,
      description: input.description,
      notes: input.notes ?? null,
      incurred_on: input.incurred_on,
      late_submission_reason: input.late_submission_reason ?? null,
    };

    const { error: updateErr } = await supabase
      .from("project_expenses")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    revalidateExpense(input.id, input.project_id);
    return {
      result: { id: input.id, status: existing.status as ExpenseStatus },
      auditResourceId: input.id,
      auditOldValues: {
        amount: existing.amount,
        project_id: existing.project_id,
      },
      auditNewValues: patch as unknown as Record<string, unknown>,
    };
  },
});

// ---------------------------------------------------------------------------
// SUBMIT DRAFT — DRAFT → PENDING_L1_SUPERVISOR. Notifies supervisors.
// ---------------------------------------------------------------------------
export const submitDraftExpenseAction = withSecureAction({
  schema: submitDraftExpenseSchema,
  resource: "expense",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "project_expenses",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("project_expenses")
      .select("project_id, status, amount, submitter_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    const amountIDR = row ? Number(parseMoneyFromDb(row.amount)) : undefined;
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.submitter_employee_id ?? undefined,
      amountIDR,
      isActiveAssignment: true, // submit on your own draft — assignment
      // was already validated at DRAFT creation. PDP allow-list is `submit`
      // requiring `isActiveAssignment` + `projectId`; both are present.
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: draft, error: readErr } = await supabase
      .from("project_expenses")
      .select(
        "id, status, project_id, submitter_employee_id, amount, description, budget_detail_id, payment_method, incurred_on, late_submission_reason",
      )
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !draft) throw new Error("Draft not found.");
    if (draft.submitter_employee_id !== ctx.actor.employeeId) {
      throw new Error("Only the submitter may submit this draft.");
    }
    if (draft.status !== "DRAFT") {
      throw new Error("Only DRAFT expenses can be submitted.");
    }
    if (!draft.payment_method) {
      throw new Error("Select a payment method before submitting for approval.");
    }

    // Settlement SLA §11 (2026-08) — expense dengan `incurred_on` lebih tua
    // dari 7 hari kerja butuh justifikasi tertulis di
    // `late_submission_reason`. Kalau lewat batas tanpa alasan → block.
    // Kalau ada alasan → allow tapi flag ke approver via notification
    // EXPENSE_INCURRED_STALE.
    const nowForSla = new Date();
    const incurredBusinessDaysOld = Math.abs(
      businessDaysUntil(draft.incurred_on, nowForSla),
    );
    const slaEval = evaluateLateSubmission({
      incurredOn: draft.incurred_on,
      now: nowForSla,
      reason: draft.late_submission_reason ?? null,
      businessDaysOld: incurredBusinessDaysOld,
    });
    if (slaEval.kind === "requires_reason") {
      throw new Error(
        `Nota tercatat pada ${draft.incurred_on} (${incurredBusinessDaysOld} hari kerja lalu, melewati batas ${EXPENSE_INCURRED_MAX_BUSINESS_DAYS} wd). Isi kolom justifikasi keterlambatan sebelum submit.`,
      );
    }
    // NOTE: `budget_detail_id` (MA line) is intentionally NOT required at
    // submit time. Field-level submitters (Employee/Supervisor) don't have
    // visibility into the budget breakdown; PM/Finance re-code the row
    // during their review step via `assignExpenseBudgetLineAction`. The
    // approval chain enforces "MA must be set before PM approves L2" in
    // `approveExpenseAction`.

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("project_expenses")
      .update({
        status: "PENDING_L1_SUPERVISOR",
        submitted_at: nowIso,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { error: logErr } = await supabase
      .from("expense_approval_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        expense_id: input.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.actor.role,
        action: "SUBMIT",
        from_status: "DRAFT",
        to_status: "PENDING_L1_SUPERVISOR",
        comment: null,
      });
    if (logErr) throw new Error(logErr.message);

    const amountIDR = Number(parseMoneyFromDb(draft.amount));

    // Notify Supervisor + Tenant Admin (approver-side). Approvers may span
    // multiple locales — we resolve locale per-recipient via notifyRoles
    // helper (which currently uses tenant default). Title/body use
    // Indonesian tenant default; per-recipient localization would require
    // fanning out one message per employee, which is fine since notifyRoles
    // already does that under the hood.
    const { t: tApprover } = await translatorFor({
      employeeId: ctx.actor.employeeId,
      tenantId: ctx.actor.tenantId,
      namespace: "notifications.expenses",
    });
    await notifyRoles({
      tenantId: ctx.actor.tenantId,
      roles: ["SUPERVISOR", "TENANT_ADMIN"],
      kind: "APPROVAL_REQUESTED",
      title: tApprover("approverInbox.title", {
        amount: amountIDR.toLocaleString("id-ID"),
      }),
      body: draft.description.slice(0, 200),
      actionUrl: `/finance/expenses/${input.id}`,
      payload: { expense_id: input.id },
    });

    // Kalau nota tercatat > 7 wd + submitter menyertakan justifikasi, flag
    // ke approver via EXPENSE_INCURRED_STALE. Notifikasi terpisah supaya
    // approver bisa cepat scan mana yang butuh perhatian ekstra.
    if (slaEval.kind === "flagged") {
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: ["SUPERVISOR", "PROJECT_MANAGER", "LEAD_FINANCE", "TENANT_ADMIN"],
        kind: "EXPENSE_INCURRED_STALE",
        title: tApprover("approverInbox.staleReceipt", {
          amount: amountIDR.toLocaleString("id-ID"),
          days: incurredBusinessDaysOld,
        }),
        body: slaEval.reason.slice(0, 200),
        actionUrl: `/finance/expenses/${input.id}`,
        payload: {
          expense_id: input.id,
          business_days_old: incurredBusinessDaysOld,
          incurred_on: draft.incurred_on,
        },
      });
    }

    revalidateExpense(input.id, draft.project_id);
    return {
      result: {
        id: input.id,
        status: "PENDING_L1_SUPERVISOR" as ExpenseStatus,
      },
      auditResourceId: input.id,
      auditOldValues: { status: "DRAFT" },
      auditNewValues: {
        status: "PENDING_L1_SUPERVISOR",
        submitted_at: nowIso,
        stale_business_days: incurredBusinessDaysOld,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// DELETE DRAFT — submitter hard-deletes a DRAFT. Also removes attached
// receipts from storage. Non-draft rows must go through CANCEL instead.
// ---------------------------------------------------------------------------
export const deleteDraftExpenseAction = withSecureAction({
  schema: deleteDraftExpenseSchema,
  resource: "expense",
  action: "cancel",
  auditAction: "DELETE",
  auditResourceName: "project_expenses",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("project_expenses")
      .select("status, submitter_employee_id, project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.submitter_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: existing, error: readErr } = await supabase
      .from("project_expenses")
      .select("id, status, project_id, submitter_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !existing) throw new Error("Expense not found.");
    if (existing.submitter_employee_id !== ctx.actor.employeeId) {
      throw new Error("Only the submitter may delete this draft.");
    }
    if (existing.status !== "DRAFT") {
      throw new Error("Only DRAFT expenses can be deleted (use CANCEL otherwise).");
    }

    // Best-effort cleanup of attached receipts.
    const { data: attachments } = await supabase
      .from("attachments")
      .select("id")
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("resource_type", "project_expense")
      .eq("resource_id", input.id);
    for (const a of attachments ?? []) {
      try {
        await deleteAttachment(a.id);
      } catch {
        // Continue — storage cleanup shouldn't block the row delete.
      }
    }

    const { error: delErr } = await supabase
      .from("project_expenses")
      .delete()
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (delErr) throw new Error(delErr.message);

    revalidateExpense(input.id, existing.project_id);
    return {
      result: { id: input.id, deleted: true },
      auditResourceId: input.id,
      auditOldValues: { status: "DRAFT" },
      auditNewValues: null,
    };
  },
});

// ---------------------------------------------------------------------------
// APPROVE — advance the state machine one step + notify next approver.
// ---------------------------------------------------------------------------
export const approveExpenseAction = withSecureAction({
  schema: approveExpenseSchema,
  resource: "expense",
  action: "approve",
  auditAction: "APPROVE",
  auditResourceName: "project_expenses",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("project_expenses")
      .select("project_id, status, amount, submitter_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();

    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.submitter_employee_id ?? undefined,
      amountIDR: row ? Number(parseMoneyFromDb(row.amount)) : undefined,
      pendingApprovalLevel: row
        ? statusToPdpLevel(row.status as ExpenseStatus)
        : undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("project_expenses")
      .select("*")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Expense not found.");

    const currentStatus = current.status as ExpenseStatus;
    if (!canApproveNext(ctx.actor.role, currentStatus)) {
      throw new Error(
        `Your role (${ctx.actor.role}) cannot approve status ${currentStatus}.`,
      );
    }

    // MA (budget line) gate — must be set before PM (L2) and Finance
    // (L2_5) can advance the request. Employee-level submitters skip this
    // field in the form; PM/Finance are expected to `assignExpenseBudgetLineAction`
    // during their review.
    const maRequiredAt: readonly ExpenseStatus[] = [
      "PENDING_L2_PROJECT_MANAGER",
      "PENDING_L2_5_FINANCE",
    ];
    if (maRequiredAt.includes(currentStatus) && !current.budget_detail_id) {
      throw new Error(
        "Assign a budget line (MA) before approving this expense.",
      );
    }

    const amountIDR = Number(parseMoneyFromDb(current.amount));
    const action: ApprovalActionEnum =
      currentStatus === "PENDING_L2_5_FINANCE" ? "FINANCE_APPROVE" : "APPROVE";
    const toStatus = nextExpenseStatus({
      amountIDR,
      current: currentStatus,
      action,
    });

    const updatePatch: TablesUpdate<"project_expenses"> = { status: toStatus };
    const nowIso = new Date().toISOString();
    if (action === "FINANCE_APPROVE") {
      updatePatch.finance_approved_at = nowIso;
      updatePatch.finance_approver_id = ctx.actor.employeeId;
    }
    if (toStatus === "APPROVED") {
      updatePatch.final_approved_at = nowIso;
      updatePatch.final_approver_id = ctx.actor.employeeId;
    }

    const { error: updateErr } = await supabase
      .from("project_expenses")
      .update(updatePatch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { error: logErr } = await supabase
      .from("expense_approval_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        expense_id: input.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.actor.role,
        action,
        from_status: currentStatus,
        to_status: toStatus,
        comment: input.comment ?? null,
      });
    if (logErr) throw new Error(logErr.message);

    // Fetch submitter once — used for both progress + terminal notifications.
    const { data: submitter } = await supabase
      .from("employees")
      .select("id, user_id")
      .eq("id", current.submitter_employee_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();

    // Translator scoped to submitter's locale (Opsi A · progress updates).
    const { t: tSubmitter } = await translatorFor({
      employeeId: current.submitter_employee_id,
      tenantId: ctx.actor.tenantId,
      namespace: "notifications.expenses",
    });
    // Translator for the approver-inbox blast. Approvers can be many
    // employees with different locales; we currently pick the acting
    // user's locale as the best guess. notifyRoles fans out one message
    // per recipient which reads the same title string.
    const { t: tApproverBlast } = await translatorFor({
      employeeId: ctx.actor.employeeId,
      tenantId: ctx.actor.tenantId,
      namespace: "notifications.expenses",
    });
    const roleLabel = (role: EmployeeRole | null): string => {
      if (!role) return "";
      return tSubmitter(`roles.${role}`);
    };

    // Cash-flow updates when we hit terminal APPROVED.
    if (toStatus === "APPROVED") {
      const { data: budget } = await supabase
        .from("project_budgets")
        .select("spent_amount")
        .eq("project_id", current.project_id)
        .eq("tenant_id", ctx.actor.tenantId)
        .maybeSingle();
      if (budget) {
        const newSpent =
          parseMoneyFromDb(budget.spent_amount) +
          parseMoneyFromDb(current.amount);
        await supabase
          .from("project_budgets")
          .update({
            spent_amount: moneyToDbString(newSpent) as unknown as number,
          })
          .eq("project_id", current.project_id)
          .eq("tenant_id", ctx.actor.tenantId);
      }

      // Terminal APPROVED — final receipt to submitter.
      if (submitter) {
        await notifyUser({
          recipient: { userId: submitter.user_id, employeeId: submitter.id },
          kind: "APPROVAL_APPROVED",
          title: tSubmitter("submitterApproved.title"),
          body: tSubmitter("submitterApproved.body", {
            amount: amountIDR.toLocaleString("id-ID"),
          }),
          actionUrl: `/finance/expenses/${input.id}`,
        });
      }
    } else {
      // Intermediate step — 2 notifications:
      //   1. To the next-role approver: "Expense awaiting your approval"
      //   2. To the submitter: "Expense advanced · {step role} approved,
      //      now waiting {next role}"  ← Opsi A progress update.
      const nextRole = expectedApproverRole(toStatus);
      if (nextRole) {
        await notifyRoles({
          tenantId: ctx.actor.tenantId,
          roles: [nextRole, "TENANT_ADMIN"],
          kind: "APPROVAL_REQUESTED",
          title: tApproverBlast("approverInbox.titleGeneric", {
            amount: amountIDR.toLocaleString("id-ID"),
          }),
          actionUrl: `/finance/expenses/${input.id}`,
          payload: { expense_id: input.id },
        });
      }

      if (submitter && nextRole) {
        const stepRole = expectedApproverRole(currentStatus);
        await notifyUser({
          recipient: { userId: submitter.user_id, employeeId: submitter.id },
          kind: "APPROVAL_APPROVED",
          title: tSubmitter("submitterProgress.title", {
            stepRoleLabel: roleLabel(stepRole),
          }),
          body: tSubmitter("submitterProgress.body", {
            amount: amountIDR.toLocaleString("id-ID"),
            nextRoleLabel: roleLabel(nextRole),
          }),
          actionUrl: `/finance/expenses/${input.id}`,
          payload: {
            expense_id: input.id,
            from_status: currentStatus,
            to_status: toStatus,
          },
        });
      }
    }

    revalidateExpense(input.id, current.project_id);
    return {
      result: { id: input.id, status: toStatus },
      auditResourceId: input.id,
      auditOldValues: { status: currentStatus },
      auditNewValues: { status: toStatus, action },
    };
  },
});

// ---------------------------------------------------------------------------
// REJECT — terminal REJECTED state. Notifies the submitter.
// ---------------------------------------------------------------------------
export const rejectExpenseAction = withSecureAction({
  schema: rejectExpenseSchema,
  resource: "expense",
  action: "reject",
  auditAction: "REJECT",
  auditResourceName: "project_expenses",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("project_expenses")
      .select("project_id, status, amount, submitter_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.submitter_employee_id ?? undefined,
      amountIDR: row ? Number(parseMoneyFromDb(row.amount)) : undefined,
      pendingApprovalLevel: row
        ? statusToPdpLevel(row.status as ExpenseStatus)
        : undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("project_expenses")
      .select("id, status, project_id, submitter_employee_id, amount")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Expense not found.");

    const currentStatus = current.status as ExpenseStatus;
    if (!canApproveNext(ctx.actor.role, currentStatus)) {
      throw new Error(
        `Your role (${ctx.actor.role}) cannot reject at status ${currentStatus}.`,
      );
    }

    const action: ApprovalActionEnum =
      currentStatus === "PENDING_L2_5_FINANCE" ? "FINANCE_REJECT" : "REJECT";

    const { error: updateErr } = await supabase
      .from("project_expenses")
      .update({
        status: "REJECTED",
        rejected_at: new Date().toISOString(),
        rejected_by: ctx.actor.employeeId,
        rejection_reason: input.reason,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { error: logErr } = await supabase
      .from("expense_approval_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        expense_id: input.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.actor.role,
        action,
        from_status: currentStatus,
        to_status: "REJECTED",
        comment: input.reason,
      });
    if (logErr) throw new Error(logErr.message);

    const { data: submitter } = await supabase
      .from("employees")
      .select("id, user_id")
      .eq("id", current.submitter_employee_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (submitter) {
      const { t: tSubmitter } = await translatorFor({
        employeeId: current.submitter_employee_id,
        tenantId: ctx.actor.tenantId,
        namespace: "notifications.expenses",
      });
      await notifyUser({
        recipient: { userId: submitter.user_id, employeeId: submitter.id },
        kind: "APPROVAL_REJECTED",
        title: tSubmitter("submitterRejected.title"),
        body: input.reason
          ? tSubmitter("submitterRejected.bodyWithReason", {
              reason: input.reason,
            })
          : tSubmitter("submitterRejected.bodyGeneric"),
        actionUrl: `/finance/expenses/${input.id}`,
      });
    }

    revalidateExpense(input.id, current.project_id);
    return {
      result: { id: input.id, status: "REJECTED" as ExpenseStatus },
      auditResourceId: input.id,
      auditOldValues: { status: currentStatus },
      auditNewValues: { status: "REJECTED", reason: input.reason },
    };
  },
});

// ---------------------------------------------------------------------------
// CANCEL — submitter voluntarily withdraws a submitted expense before it
// terminates. For DRAFT rows, use deleteDraftExpenseAction instead.
// ---------------------------------------------------------------------------
export const cancelExpenseAction = withSecureAction({
  schema: cancelExpenseSchema,
  resource: "expense",
  action: "cancel",
  auditAction: "CANCEL",
  auditResourceName: "project_expenses",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("project_expenses")
      .select("status, submitter_employee_id, project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.submitter_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("project_expenses")
      .select("id, status, project_id, submitter_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Expense not found.");

    if (current.submitter_employee_id !== ctx.actor.employeeId) {
      throw new Error("Only the submitter may cancel this expense.");
    }
    if (current.status === "APPROVED" || current.status === "REJECTED") {
      throw new Error("Cannot cancel a terminal expense.");
    }

    const { error: updateErr } = await supabase
      .from("project_expenses")
      .update({ status: "CANCELLED" })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { error: logErr } = await supabase
      .from("expense_approval_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        expense_id: input.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.actor.role,
        action: "CANCEL",
        from_status: current.status as ExpenseStatus,
        to_status: "CANCELLED",
        comment: input.reason ?? null,
      });
    if (logErr) throw new Error(logErr.message);

    revalidateExpense(input.id, current.project_id);
    return {
      result: { id: input.id, status: "CANCELLED" as ExpenseStatus },
      auditResourceId: input.id,
      auditOldValues: { status: current.status },
      auditNewValues: { status: "CANCELLED" },
    };
  },
});

// ---------------------------------------------------------------------------
// DETACH RECEIPT — remove a single uploaded receipt from a DRAFT / PENDING_L1
// expense. Attachments on later-state expenses are read-only.
// ---------------------------------------------------------------------------
export const detachReceiptAction = withSecureAction({
  schema: detachReceiptSchema,
  resource: "expense",
  action: "update",
  auditAction: "DELETE",
  auditResourceName: "attachments",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("project_expenses")
      .select("status, submitter_employee_id, project_id")
      .eq("id", input.expense_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.submitter_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    await deleteAttachment(input.attachment_id);
    revalidatePath(`/finance/expenses/${input.expense_id}`);
    return {
      result: { attachmentId: input.attachment_id },
      auditResourceId: input.attachment_id,
      auditNewValues: { detached_from_expense: input.expense_id },
    };
  },
});

// ---------------------------------------------------------------------------
// ASSIGN BUDGET LINE (MA) — PM / Finance / OM+ codes an expense during
// review. This is the "approver reclassifies before advancing" path so
// field submitters (Employee) can file expenses without knowing the
// budget breakdown. Guarded by PDP's `update` branch which now includes
// TRUSTED_MA_EDITORS on non-terminal money requests.
// ---------------------------------------------------------------------------
export const assignExpenseBudgetLineAction = withSecureAction({
  schema: assignExpenseBudgetLineSchema,
  resource: "expense",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_expenses",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("project_expenses")
      .select("project_id, status, submitter_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.submitter_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: existing, error: readErr } = await supabase
      .from("project_expenses")
      .select("id, project_id, status, budget_detail_id, tenant_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !existing) throw new Error("Expense not found.");

    // If the caller sent a budget_detail_id, sanity-check that it belongs
    // to a budget on the same project + tenant. RLS would already stop a
    // cross-tenant leak but a clearer error message helps.
    if (input.budget_detail_id) {
      const { data: line } = await supabase
        .from("v_project_budget_lines")
        .select("budget_detail_id, project_id, tenant_id")
        .eq("budget_detail_id", input.budget_detail_id)
        .eq("tenant_id", ctx.actor.tenantId)
        .maybeSingle();
      if (!line) {
        throw new Error("Budget line not found in this tenant.");
      }
      if (line.project_id !== existing.project_id) {
        throw new Error("Budget line belongs to a different project.");
      }
    }

    const { error: updateErr } = await supabase
      .from("project_expenses")
      .update({ budget_detail_id: input.budget_detail_id })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    revalidateExpense(input.id, existing.project_id);

    return {
      result: {
        id: input.id,
        budget_detail_id: input.budget_detail_id,
      },
      auditResourceId: input.id,
      auditOldValues: { budget_detail_id: existing.budget_detail_id },
      auditNewValues: { budget_detail_id: input.budget_detail_id },
    };
  },
});

// ---------------------------------------------------------------------------
// ASSIGN COA — approver-side classification (PM / Finance / OM+ picks the
// GL account when an employee submitted without one). Runs the same
// resource/verb gate as `assignExpenseBudgetLineAction` so the same set
// of roles can act on it, plus the standard active + postable check via
// `assertPostableCoa`.
// ---------------------------------------------------------------------------
export const assignExpenseCoaAction = withSecureAction({
  schema: assignExpenseCoaSchema,
  resource: "expense",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_expenses",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("project_expenses")
      .select("project_id, status, submitter_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.submitter_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: existing, error: readErr } = await supabase
      .from("project_expenses")
      .select("id, project_id, coa_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !existing) throw new Error("Expense not found.");

    const validCoaId = await assertPostableCoa(input.coa_id);

    const { error: updateErr } = await supabase
      .from("project_expenses")
      .update({ coa_id: validCoaId })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    revalidateExpense(input.id, existing.project_id);

    return {
      result: { id: input.id, coa_id: validCoaId },
      auditResourceId: input.id,
      auditOldValues: { coa_id: existing.coa_id },
      auditNewValues: { coa_id: validCoaId },
    };
  },
});

// ---------------------------------------------------------------------------
// LEGACY: single-shot submit (kept for backwards compat with any callers
// still on the pre-draft flow).
// @deprecated Use saveDraftExpenseAction + submitDraftExpenseAction.
// ---------------------------------------------------------------------------
export const submitExpenseAction = withSecureAction({
  schema: submitExpenseSchema,
  resource: "expense",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "project_expenses",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data } = await supabase.rpc("is_assigned_to_project", {
      p_project_id: input.project_id,
    });
    return {
      tenantId: ctx.actor.tenantId,
      projectId: input.project_id,
      isActiveAssignment: Boolean(data),
      amountIDR: input.amount_idr,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    await assertProjectOperational(input.project_id);
    const amountDb = moneyToDbString(BigInt(input.amount_idr));
    const nowIso = new Date().toISOString();
    const validCoaId = await assertPostableCoa(input.coa_id);

    const { data: inserted, error: insertErr } = await supabase
      .from("project_expenses")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id,
        submitter_employee_id: ctx.actor.employeeId,
        amount: amountDb as unknown as number,
        category: input.category,
        budget_detail_id: input.budget_detail_id ?? null,
        coa_id: validCoaId,
        payment_method: input.payment_method ?? null,
        description: input.description,
        notes: input.notes ?? null,
        incurred_on: input.incurred_on,
        receipt_url: input.receipt_url ?? null,
        status: "PENDING_L1_SUPERVISOR",
        submitted_at: nowIso,
      })
      .select("id, status")
      .single();
    if (insertErr || !inserted) {
      throw new Error(insertErr?.message ?? "Failed to submit expense.");
    }

    await supabase.from("expense_approval_logs").insert({
      tenant_id: ctx.actor.tenantId,
      expense_id: inserted.id,
      actor_employee_id: ctx.actor.employeeId,
      actor_role: ctx.actor.role,
      action: "SUBMIT",
      from_status: "DRAFT",
      to_status: "PENDING_L1_SUPERVISOR",
      comment: null,
    });

    const { t: tApprover } = await translatorFor({
      employeeId: ctx.actor.employeeId,
      tenantId: ctx.actor.tenantId,
      namespace: "notifications.expenses",
    });
    await notifyRoles({
      tenantId: ctx.actor.tenantId,
      roles: ["SUPERVISOR", "TENANT_ADMIN"],
      kind: "APPROVAL_REQUESTED",
      title: tApprover("approverInbox.title", {
        amount: input.amount_idr.toLocaleString("id-ID"),
      }),
      body: input.description.slice(0, 200),
      actionUrl: `/finance/expenses/${inserted.id}`,
      payload: { expense_id: inserted.id },
    });

    revalidateExpense(inserted.id, input.project_id);
    return {
      result: { id: inserted.id, status: inserted.status as ExpenseStatus },
      auditResourceId: inserted.id,
      auditNewValues: {
        amount: amountDb,
        status: inserted.status,
        project_id: input.project_id,
      },
    };
  },
});
