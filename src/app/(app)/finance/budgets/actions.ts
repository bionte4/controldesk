"use server";

import { revalidatePath } from "next/cache";

import { moneyToDbString, parseMoneyFromDb } from "@/lib/format/money";
import { toLegacyDbRole } from "@/lib/rbac/roles";
import { withCanonicalSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import {
  budgetSlotForStatus,
  canBudgetAdvance,
  nextBudgetStatus,
} from "@/lib/budgets/state";
import {
  addBudgetLineItemSchema,
  approveBudgetSchema,
  cancelBudgetSchema,
  createBudgetSchema,
  deleteBudgetLineItemSchema,
  rejectBudgetSchema,
  submitBudgetSchema,
  updateBudgetLineItemSchema,
} from "@/lib/validation/budget";
import type { BudgetStatus, TablesUpdate } from "@/types/database";

// ---------------------------------------------------------------------------
// CREATE — new DRAFT budget header for (project, fiscal_year).
// ---------------------------------------------------------------------------
export const createBudgetAction = withCanonicalSecureAction({
  schema: createBudgetSchema,
  resource: "budget",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "budgets",
  resolveAttributes: (input, ctx) => ({
    tenantId: ctx.actor.tenantId,
    projectId: input.project_id,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: inserted, error } = await supabase
      .from("budgets")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id,
        fiscal_year: input.fiscal_year,
        title: input.title,
        notes: input.notes ?? null,
        status: "DRAFT",
        created_by: ctx.actor.employeeId,
        updated_by: ctx.actor.employeeId,
      })
      .select("id, status, fiscal_year")
      .single();
    if (error || !inserted) {
      throw new Error(error?.message ?? "Failed to create budget.");
    }

    revalidatePath("/finance/budgets");
    revalidatePath(`/projects/${input.project_id}`);

    return {
      result: { id: inserted.id, status: inserted.status as BudgetStatus },
      auditResourceId: inserted.id,
      auditNewValues: {
        project_id: input.project_id,
        fiscal_year: inserted.fiscal_year,
        title: input.title,
        status: inserted.status,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// ADD LINE ITEM — planned amount only; realized/outstanding default to 0.
// ---------------------------------------------------------------------------
export const addBudgetLineItemAction = withCanonicalSecureAction({
  schema: addBudgetLineItemSchema,
  resource: "budget_detail",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "budget_details",
  resolveAttributes: (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: parent, error: parentErr } = await supabase
      .from("budgets")
      .select("id, status, project_id")
      .eq("id", input.budget_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (parentErr || !parent) throw new Error("Budget not found.");
    if (parent.status === "APPROVED" || parent.status === "CANCELLED") {
      throw new Error(`Budget is locked at status ${parent.status}.`);
    }

    const { data: inserted, error } = await supabase
      .from("budget_details")
      .insert({
        tenant_id: ctx.actor.tenantId,
        budget_id: input.budget_id,
        seq: input.seq,
        category: input.category,
        description: input.description ?? null,
        planned_amount: moneyToDbString(
          BigInt(input.planned_amount),
        ) as unknown as number,
        realized_amount: moneyToDbString(0n) as unknown as number,
        outstanding_amount: moneyToDbString(0n) as unknown as number,
        created_by: ctx.actor.employeeId,
        updated_by: ctx.actor.employeeId,
      })
      .select("id, seq, category, planned_amount")
      .single();
    if (error || !inserted) {
      throw new Error(error?.message ?? "Failed to add line item.");
    }

    revalidatePath("/finance/budgets");
    revalidatePath(`/finance/budgets/${input.budget_id}`);
    revalidatePath(`/projects/${parent.project_id}`);

    return {
      result: { id: inserted.id },
      auditResourceId: inserted.id,
      auditNewValues: {
        budget_id: input.budget_id,
        category: inserted.category,
        planned_amount: inserted.planned_amount,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// UPDATE LINE ITEM — partial. Callers pass only the fields they want to change.
// ---------------------------------------------------------------------------
export const updateBudgetLineItemAction = withCanonicalSecureAction({
  schema: updateBudgetLineItemSchema,
  resource: "budget_detail",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "budget_details",
  resolveAttributes: (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("budget_details")
      .select("id, budget_id, planned_amount, realized_amount, outstanding_amount")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Line item not found.");

    const { data: parent } = await supabase
      .from("budgets")
      .select("status, project_id")
      .eq("id", current.budget_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (parent && (parent.status === "APPROVED" || parent.status === "CANCELLED")) {
      throw new Error(`Budget is locked at status ${parent.status}.`);
    }

    const patch: TablesUpdate<"budget_details"> = {
      updated_by: ctx.actor.employeeId,
    };
    if (input.category !== undefined) patch.category = input.category;
    if (input.description !== undefined) patch.description = input.description ?? null;
    if (input.planned_amount !== undefined) {
      patch.planned_amount = moneyToDbString(
        BigInt(input.planned_amount),
      ) as unknown as number;
    }
    if (input.realized_amount !== undefined) {
      patch.realized_amount = moneyToDbString(
        BigInt(input.realized_amount),
      ) as unknown as number;
    }
    if (input.outstanding_amount !== undefined) {
      patch.outstanding_amount = moneyToDbString(
        BigInt(input.outstanding_amount),
      ) as unknown as number;
    }

    const { error: updateErr } = await supabase
      .from("budget_details")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    revalidatePath("/finance/budgets");
    revalidatePath(`/finance/budgets/${current.budget_id}`);
    if (parent?.project_id) revalidatePath(`/projects/${parent.project_id}`);

    return {
      result: { id: input.id },
      auditResourceId: input.id,
      auditOldValues: {
        planned_amount: current.planned_amount,
        realized_amount: current.realized_amount,
        outstanding_amount: current.outstanding_amount,
      },
      auditNewValues: patch as Record<string, unknown>,
    };
  },
});

// ---------------------------------------------------------------------------
// DELETE LINE ITEM.
// ---------------------------------------------------------------------------
export const deleteBudgetLineItemAction = withCanonicalSecureAction({
  schema: deleteBudgetLineItemSchema,
  resource: "budget_detail",
  action: "delete",
  auditAction: "DELETE",
  auditResourceName: "budget_details",
  resolveAttributes: (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("budget_details")
      .select("id, budget_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Line item not found.");

    const { data: parent } = await supabase
      .from("budgets")
      .select("status, project_id")
      .eq("id", current.budget_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (parent && (parent.status === "APPROVED" || parent.status === "CANCELLED")) {
      throw new Error(`Budget is locked at status ${parent.status}.`);
    }

    const { error } = await supabase
      .from("budget_details")
      .delete()
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    revalidatePath("/finance/budgets");
    revalidatePath(`/finance/budgets/${current.budget_id}`);
    if (parent?.project_id) revalidatePath(`/projects/${parent.project_id}`);

    return {
      result: { id: input.id },
      auditResourceId: input.id,
      auditOldValues: { budget_id: current.budget_id },
    };
  },
});

// ---------------------------------------------------------------------------
// SUBMIT — DRAFT → PENDING_FINANCE.
// ---------------------------------------------------------------------------
export const submitBudgetAction = withCanonicalSecureAction({
  schema: submitBudgetSchema,
  resource: "budget",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "budgets",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("budgets")
      .select("status, project_id, total_planned_amount, created_by")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: data?.project_id,
      status: data?.status,
      ownerEmployeeId: data?.created_by ?? undefined,
      amountIDR: data?.total_planned_amount
        ? Number(parseMoneyFromDb(data.total_planned_amount))
        : undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("budgets")
      .select("*")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Budget not found.");

    const currentStatus = current.status as BudgetStatus;
    const totalPlanned = Number(parseMoneyFromDb(current.total_planned_amount));

    if (totalPlanned <= 0) {
      throw new Error(
        "Cannot submit a budget with zero total. Add at least one line item.",
      );
    }

    const toStatus = nextBudgetStatus({
      totalPlannedIDR: totalPlanned,
      current: currentStatus,
      action: "SUBMIT",
    });

    const { error: updateErr } = await supabase
      .from("budgets")
      .update({ status: toStatus, updated_by: ctx.actor.employeeId })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    revalidatePath("/finance/budgets");
    revalidatePath(`/finance/budgets/${input.id}`);
    revalidatePath("/approvals");
    revalidatePath(`/projects/${current.project_id}`);

    return {
      result: { id: input.id, status: toStatus },
      auditResourceId: input.id,
      auditOldValues: { status: currentStatus },
      auditNewValues: { status: toStatus, total_planned_amount: totalPlanned },
    };
  },
});

// ---------------------------------------------------------------------------
// APPROVE — advance one step (PENDING_FINANCE → PENDING_DIRECTOR | APPROVED,
// PENDING_DIRECTOR → APPROVED).
// ---------------------------------------------------------------------------
export const approveBudgetAction = withCanonicalSecureAction({
  schema: approveBudgetSchema,
  resource: "budget",
  action: "approve",
  auditAction: "APPROVE",
  auditResourceName: "budgets",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("budgets")
      .select("status, project_id, total_planned_amount, created_by")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: data?.project_id,
      status: data?.status,
      ownerEmployeeId: data?.created_by ?? undefined,
      amountIDR: data?.total_planned_amount
        ? Number(parseMoneyFromDb(data.total_planned_amount))
        : undefined,
      pendingSlot: data?.status
        ? budgetSlotForStatus(data.status as BudgetStatus) ?? undefined
        : undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("budgets")
      .select("*")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Budget not found.");

    const currentStatus = current.status as BudgetStatus;
    if (!canBudgetAdvance(ctx.actor.role, currentStatus)) {
      throw new Error(
        `Your role (${ctx.actor.role}) cannot approve status ${currentStatus}.`,
      );
    }

    const totalPlanned = Number(parseMoneyFromDb(current.total_planned_amount));
    const toStatus = nextBudgetStatus({
      totalPlannedIDR: totalPlanned,
      current: currentStatus,
      action: "APPROVE",
    });

    const patch: TablesUpdate<"budgets"> = {
      status: toStatus,
      updated_by: ctx.actor.employeeId,
    };
    if (toStatus === "APPROVED") {
      patch.approved_at = new Date().toISOString();
      patch.approved_by = ctx.actor.employeeId;
    }

    const { error: updateErr } = await supabase
      .from("budgets")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    revalidatePath("/finance/budgets");
    revalidatePath(`/finance/budgets/${input.id}`);
    revalidatePath("/approvals");
    revalidatePath(`/projects/${current.project_id}`);

    return {
      result: { id: input.id, status: toStatus },
      auditResourceId: input.id,
      auditOldValues: { status: currentStatus },
      auditNewValues: {
        status: toStatus,
        actor_canonical_role: ctx.actor.role,
        actor_legacy_role: toLegacyDbRole(ctx.actor.role),
        comment: input.comment ?? null,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// REJECT — terminal CANCELLED with rejection reason.
// ---------------------------------------------------------------------------
export const rejectBudgetAction = withCanonicalSecureAction({
  schema: rejectBudgetSchema,
  resource: "budget",
  action: "reject",
  auditAction: "REJECT",
  auditResourceName: "budgets",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("budgets")
      .select("status, project_id, total_planned_amount, created_by")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: data?.project_id,
      status: data?.status,
      ownerEmployeeId: data?.created_by ?? undefined,
      amountIDR: data?.total_planned_amount
        ? Number(parseMoneyFromDb(data.total_planned_amount))
        : undefined,
      pendingSlot: data?.status
        ? budgetSlotForStatus(data.status as BudgetStatus) ?? undefined
        : undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("budgets")
      .select("id, status, project_id, total_planned_amount, notes")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Budget not found.");

    const currentStatus = current.status as BudgetStatus;
    if (!canBudgetAdvance(ctx.actor.role, currentStatus)) {
      throw new Error(
        `Your role (${ctx.actor.role}) cannot reject status ${currentStatus}.`,
      );
    }

    const toStatus = nextBudgetStatus({
      totalPlannedIDR: Number(parseMoneyFromDb(current.total_planned_amount)),
      current: currentStatus,
      action: "REJECT",
    });

    // Append the rejection reason to notes so the detail page can render the
    // rationale without needing a dedicated column (rules §21 audit trail
    // still captures the structured actor + reason).
    const notesSuffix = `\n\n[REJECTED by ${ctx.actor.role} @ ${new Date().toISOString()}]: ${input.reason}`;
    const nextNotes = (current.notes ?? "") + notesSuffix;

    const { error: updateErr } = await supabase
      .from("budgets")
      .update({
        status: toStatus,
        notes: nextNotes,
        updated_by: ctx.actor.employeeId,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    revalidatePath("/finance/budgets");
    revalidatePath(`/finance/budgets/${input.id}`);
    revalidatePath("/approvals");
    revalidatePath(`/projects/${current.project_id}`);

    return {
      result: { id: input.id, status: toStatus },
      auditResourceId: input.id,
      auditOldValues: { status: currentStatus },
      auditNewValues: {
        status: toStatus,
        rejection_reason: input.reason,
        actor_canonical_role: ctx.actor.role,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// CANCEL — submitter withdraws before terminal approval.
// ---------------------------------------------------------------------------
export const cancelBudgetAction = withCanonicalSecureAction({
  schema: cancelBudgetSchema,
  resource: "budget",
  action: "cancel",
  auditAction: "CANCEL",
  auditResourceName: "budgets",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("budgets")
      .select("status, project_id, created_by")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: data?.project_id,
      status: data?.status,
      ownerEmployeeId: data?.created_by ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("budgets")
      .select("id, status, project_id, created_by")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Budget not found.");

    if (current.created_by !== ctx.actor.employeeId && ctx.actor.role !== "ADMIN") {
      throw new Error("Only the submitter or ADMIN may cancel this budget.");
    }
    if (current.status === "APPROVED") {
      throw new Error("Cannot cancel an APPROVED budget.");
    }
    if (current.status === "CANCELLED") {
      throw new Error("Budget already cancelled.");
    }

    const { error } = await supabase
      .from("budgets")
      .update({
        status: "CANCELLED",
        updated_by: ctx.actor.employeeId,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    revalidatePath("/finance/budgets");
    revalidatePath(`/finance/budgets/${input.id}`);
    revalidatePath("/approvals");
    revalidatePath(`/projects/${current.project_id}`);

    return {
      result: { id: input.id, status: "CANCELLED" as BudgetStatus },
      auditResourceId: input.id,
      auditOldValues: { status: current.status },
      auditNewValues: { status: "CANCELLED", reason: input.reason ?? null },
    };
  },
});
