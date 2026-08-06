"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { moneyToDbString, parseMoneyFromDb } from "@/lib/format/money";
import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/types/database";
import {
  approveExpenseSchema,
  cancelExpenseSchema,
  rejectExpenseSchema,
  submitExpenseSchema,
} from "@/lib/validation/expense";
import { nextExpenseStatus, canApproveNext } from "@/lib/expenses/state";
import type {
  ApprovalAction as ApprovalActionEnum,
  ExpenseStatus,
} from "@/types/database";

/**
 * Utility: map internal expense_status → PDP pendingApprovalLevel so we can
 * reuse the `expense` policy in `pdp.ts` without duplicating logic.
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

// ---------------------------------------------------------------------------
// SUBMIT — DRAFT → PENDING_L1_SUPERVISOR
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

    const amountDb = moneyToDbString(BigInt(input.amount_idr));

    const { data: inserted, error: insertErr } = await supabase
      .from("project_expenses")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id,
        submitter_employee_id: ctx.actor.employeeId,
        amount: amountDb as unknown as number,
        category: input.category,
        description: input.description,
        incurred_on: input.incurred_on,
        receipt_url: input.receipt_url ?? null,
        status: "PENDING_L1_SUPERVISOR",
      })
      .select("id, status")
      .single();
    if (insertErr || !inserted) {
      throw new Error(insertErr?.message ?? "Failed to submit expense.");
    }

    const { error: logErr } = await supabase
      .from("expense_approval_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        expense_id: inserted.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.actor.role,
        action: "SUBMIT",
        from_status: "DRAFT",
        to_status: "PENDING_L1_SUPERVISOR",
        comment: null,
      });
    if (logErr) throw new Error(logErr.message);

    revalidatePath("/finance/expenses");
    revalidatePath(`/finance/expenses/${inserted.id}`);
    revalidatePath("/approvals");
    revalidatePath(`/projects/${input.project_id}`);

    return {
      result: { id: inserted.id, status: inserted.status },
      auditResourceId: inserted.id,
      auditNewValues: {
        amount: amountDb,
        status: inserted.status,
        project_id: input.project_id,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// APPROVE — advance the state machine one step
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

    // If APPROVED, roll the amount into project_budgets.spent_amount.
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
    }

    revalidatePath("/finance/expenses");
    revalidatePath(`/finance/expenses/${input.id}`);
    revalidatePath("/approvals");
    revalidatePath(`/projects/${current.project_id}`);

    return {
      result: { id: input.id, status: toStatus },
      auditResourceId: input.id,
      auditOldValues: { status: currentStatus },
      auditNewValues: { status: toStatus, action },
    };
  },
});

// ---------------------------------------------------------------------------
// REJECT — terminal REJECTED state
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
      .select("id, status, project_id")
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

    revalidatePath("/finance/expenses");
    revalidatePath(`/finance/expenses/${input.id}`);
    revalidatePath("/approvals");
    revalidatePath(`/projects/${current.project_id}`);

    return {
      result: { id: input.id, status: "REJECTED" as ExpenseStatus },
      auditResourceId: input.id,
      auditOldValues: { status: currentStatus },
      auditNewValues: { status: "REJECTED", reason: input.reason },
    };
  },
});

// ---------------------------------------------------------------------------
// CANCEL — submitter voluntarily withdraws
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
      .select("status, submitter_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
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

    revalidatePath("/finance/expenses");
    revalidatePath(`/finance/expenses/${input.id}`);
    revalidatePath("/approvals");
    revalidatePath(`/projects/${current.project_id}`);

    return {
      result: { id: input.id, status: "CANCELLED" as ExpenseStatus },
      auditResourceId: input.id,
      auditOldValues: { status: current.status },
      auditNewValues: { status: "CANCELLED" },
    };
  },
});
