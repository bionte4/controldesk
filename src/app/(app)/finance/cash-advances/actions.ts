"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { moneyToDbString, parseMoneyFromDb } from "@/lib/format/money";
import { createClient } from "@/lib/supabase/server";
import { notifyRoles, notifyUser } from "@/lib/notifications/service";
import {
  canApproveNextCa,
  expectedCaApproverRole,
  nextCashAdvanceStatus,
} from "@/lib/cash-advance/state";
import {
  acceptSettlementSchema,
  approveCashAdvanceSchema,
  cancelCashAdvanceSchema,
  disburseCashAdvanceSchema,
  rejectCashAdvanceSchema,
  returnSettlementSchema,
  submitCashAdvanceSchema,
  submitSettlementSchema,
} from "@/lib/validation/cash-advance";
import type {
  ApprovalAction as ApprovalActionEnum,
  CashAdvanceStatus,
  CashAdvanceSettlementStatus,
  TablesUpdate,
} from "@/types/database";

function statusToPdpLevel(status: CashAdvanceStatus) {
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
// SUBMIT
// ---------------------------------------------------------------------------
export const submitCashAdvanceAction = withSecureAction({
  schema: submitCashAdvanceSchema,
  resource: "cash_advance",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "cash_advances",
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
      .from("cash_advances")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id,
        requester_employee_id: ctx.actor.employeeId,
        amount: amountDb as unknown as number,
        purpose: input.purpose,
        needed_by: input.needed_by ?? null,
        status: "PENDING_L1_SUPERVISOR",
      })
      .select("id, status")
      .single();
    if (insertErr || !inserted) {
      throw new Error(insertErr?.message ?? "Failed to submit cash advance.");
    }

    const { error: logErr } = await supabase
      .from("cash_advance_approval_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        cash_advance_id: inserted.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.actor.role,
        action: "SUBMIT",
        from_status: "DRAFT",
        to_status: "PENDING_L1_SUPERVISOR",
        comment: null,
      });
    if (logErr) throw new Error(logErr.message);

    await notifyRoles({
      tenantId: ctx.actor.tenantId,
      roles: ["SUPERVISOR", "TENANT_ADMIN"],
      kind: "APPROVAL_REQUESTED",
      title: `Cash advance awaiting L1 · ${input.amount_idr.toLocaleString("id-ID")}`,
      body: input.purpose.slice(0, 200),
      actionUrl: `/finance/cash-advances/${inserted.id}`,
      payload: { cash_advance_id: inserted.id },
    });

    revalidatePath("/finance/cash-advances");
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
// APPROVE
// ---------------------------------------------------------------------------
export const approveCashAdvanceAction = withSecureAction({
  schema: approveCashAdvanceSchema,
  resource: "cash_advance",
  action: "approve",
  auditAction: "APPROVE",
  auditResourceName: "cash_advances",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("cash_advances")
      .select("project_id, status, amount, requester_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.requester_employee_id ?? undefined,
      amountIDR: row ? Number(parseMoneyFromDb(row.amount)) : undefined,
      pendingApprovalLevel: row
        ? statusToPdpLevel(row.status as CashAdvanceStatus)
        : undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("cash_advances")
      .select("*")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Cash advance not found.");

    const currentStatus = current.status as CashAdvanceStatus;
    if (!canApproveNextCa(ctx.actor.role, currentStatus)) {
      throw new Error(
        `Your role (${ctx.actor.role}) cannot approve status ${currentStatus}.`,
      );
    }

    const amountIDR = Number(parseMoneyFromDb(current.amount));
    const action: ApprovalActionEnum =
      currentStatus === "PENDING_L2_5_FINANCE" ? "FINANCE_APPROVE" : "APPROVE";
    const toStatus = nextCashAdvanceStatus({
      amountIDR,
      current: currentStatus,
      action,
    });

    const updatePatch: TablesUpdate<"cash_advances"> = { status: toStatus };
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
      .from("cash_advances")
      .update(updatePatch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { error: logErr } = await supabase
      .from("cash_advance_approval_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        cash_advance_id: input.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.actor.role,
        action,
        from_status: currentStatus,
        to_status: toStatus,
        comment: input.comment ?? null,
      });
    if (logErr) throw new Error(logErr.message);

    if (toStatus === "APPROVED") {
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: ["LEAD_FINANCE", "TENANT_ADMIN"],
        kind: "APPROVAL_APPROVED",
        title: "Cash advance approved · awaiting disbursement",
        actionUrl: `/finance/cash-advances/${input.id}`,
      });
    } else {
      const nextRole = expectedCaApproverRole(toStatus);
      if (nextRole) {
        await notifyRoles({
          tenantId: ctx.actor.tenantId,
          roles: [nextRole, "TENANT_ADMIN"],
          kind: "APPROVAL_REQUESTED",
          title: "Cash advance awaiting your approval",
          actionUrl: `/finance/cash-advances/${input.id}`,
        });
      }
    }

    revalidatePath("/finance/cash-advances");
    revalidatePath(`/finance/cash-advances/${input.id}`);
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
// REJECT
// ---------------------------------------------------------------------------
export const rejectCashAdvanceAction = withSecureAction({
  schema: rejectCashAdvanceSchema,
  resource: "cash_advance",
  action: "reject",
  auditAction: "REJECT",
  auditResourceName: "cash_advances",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("cash_advances")
      .select("project_id, status, amount, requester_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.requester_employee_id ?? undefined,
      amountIDR: row ? Number(parseMoneyFromDb(row.amount)) : undefined,
      pendingApprovalLevel: row
        ? statusToPdpLevel(row.status as CashAdvanceStatus)
        : undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("cash_advances")
      .select("id, status, project_id, requester_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Cash advance not found.");

    const currentStatus = current.status as CashAdvanceStatus;
    if (!canApproveNextCa(ctx.actor.role, currentStatus)) {
      throw new Error(
        `Your role (${ctx.actor.role}) cannot reject at status ${currentStatus}.`,
      );
    }

    const action: ApprovalActionEnum =
      currentStatus === "PENDING_L2_5_FINANCE" ? "FINANCE_REJECT" : "REJECT";

    const { error: updateErr } = await supabase
      .from("cash_advances")
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
      .from("cash_advance_approval_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        cash_advance_id: input.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.actor.role,
        action,
        from_status: currentStatus,
        to_status: "REJECTED",
        comment: input.reason,
      });
    if (logErr) throw new Error(logErr.message);

    const { data: requester } = await supabase
      .from("employees")
      .select("user_id, id")
      .eq("id", current.requester_employee_id)
      .maybeSingle();
    if (requester) {
      await notifyUser({
        recipient: { userId: requester.user_id, employeeId: requester.id },
        kind: "APPROVAL_REJECTED",
        title: "Cash advance rejected",
        body: input.reason,
        actionUrl: `/finance/cash-advances/${input.id}`,
      });
    }

    revalidatePath("/finance/cash-advances");
    revalidatePath(`/finance/cash-advances/${input.id}`);
    revalidatePath("/approvals");
    revalidatePath(`/projects/${current.project_id}`);

    return {
      result: { id: input.id, status: "REJECTED" as CashAdvanceStatus },
      auditResourceId: input.id,
      auditOldValues: { status: currentStatus },
      auditNewValues: { status: "REJECTED", reason: input.reason },
    };
  },
});

// ---------------------------------------------------------------------------
// CANCEL
// ---------------------------------------------------------------------------
export const cancelCashAdvanceAction = withSecureAction({
  schema: cancelCashAdvanceSchema,
  resource: "cash_advance",
  action: "cancel",
  auditAction: "CANCEL",
  auditResourceName: "cash_advances",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("cash_advances")
      .select("status, requester_employee_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.requester_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("cash_advances")
      .select("id, status, requester_employee_id, project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Cash advance not found.");

    if (current.requester_employee_id !== ctx.actor.employeeId) {
      throw new Error("Only the requester may cancel this cash advance.");
    }
    if (
      current.status === "SETTLED" ||
      current.status === "REJECTED" ||
      current.status === "CANCELLED"
    ) {
      throw new Error("Cannot cancel a terminal cash advance.");
    }

    const { error: updateErr } = await supabase
      .from("cash_advances")
      .update({ status: "CANCELLED" })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { error: logErr } = await supabase
      .from("cash_advance_approval_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        cash_advance_id: input.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.actor.role,
        action: "CANCEL",
        from_status: current.status as CashAdvanceStatus,
        to_status: "CANCELLED",
        comment: input.reason ?? null,
      });
    if (logErr) throw new Error(logErr.message);

    revalidatePath("/finance/cash-advances");
    revalidatePath(`/finance/cash-advances/${input.id}`);
    revalidatePath("/approvals");

    return {
      result: { id: input.id, status: "CANCELLED" as CashAdvanceStatus },
      auditResourceId: input.id,
      auditOldValues: { status: current.status },
      auditNewValues: { status: "CANCELLED" },
    };
  },
});

// ---------------------------------------------------------------------------
// DISBURSE — Lead Finance releases funds
// ---------------------------------------------------------------------------
export const disburseCashAdvanceAction = withSecureAction({
  schema: disburseCashAdvanceSchema,
  resource: "cash_advance",
  action: "disburse",
  auditAction: "DISBURSE",
  auditResourceName: "cash_advances",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("cash_advances")
      .select("id, status, requester_employee_id, project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Cash advance not found.");

    if (current.status !== "APPROVED") {
      throw new Error("Only APPROVED cash advances can be disbursed.");
    }

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("cash_advances")
      .update({
        status: "DISBURSED",
        disbursed_at: nowIso,
        disbursed_by: ctx.actor.employeeId,
        disbursement_ref: input.disbursement_ref,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { error: logErr } = await supabase
      .from("cash_advance_approval_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        cash_advance_id: input.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.actor.role,
        action: "APPROVE",
        from_status: "APPROVED",
        to_status: "DISBURSED",
        comment: `Disbursed · ref ${input.disbursement_ref}`,
      });
    if (logErr) throw new Error(logErr.message);

    const { data: requester } = await supabase
      .from("employees")
      .select("user_id, id")
      .eq("id", current.requester_employee_id)
      .maybeSingle();
    if (requester) {
      await notifyUser({
        recipient: { userId: requester.user_id, employeeId: requester.id },
        kind: "CASH_ADVANCE_DISBURSED",
        title: "Cash advance disbursed",
        body: `Ref ${input.disbursement_ref}. Please submit settlement after use.`,
        actionUrl: `/finance/cash-advances/${input.id}`,
      });
    }

    revalidatePath("/finance/cash-advances");
    revalidatePath(`/finance/cash-advances/${input.id}`);
    revalidatePath("/approvals");

    return {
      result: { id: input.id, status: "DISBURSED" as CashAdvanceStatus },
      auditResourceId: input.id,
      auditOldValues: { status: current.status },
      auditNewValues: {
        status: "DISBURSED",
        disbursement_ref: input.disbursement_ref,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// SETTLEMENT — owner submits nota/struk
// ---------------------------------------------------------------------------
export const submitSettlementAction = withSecureAction({
  schema: submitSettlementSchema,
  resource: "cash_advance_settlement",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "cash_advance_settlements",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: ca } = await supabase
      .from("cash_advances")
      .select("requester_employee_id")
      .eq("id", input.cash_advance_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      ownerEmployeeId: ca?.requester_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: ca, error: readErr } = await supabase
      .from("cash_advances")
      .select("id, amount, requester_employee_id, status")
      .eq("id", input.cash_advance_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !ca) throw new Error("Cash advance not found.");
    if (ca.status !== "DISBURSED") {
      throw new Error("Only DISBURSED cash advances can be settled.");
    }
    if (ca.requester_employee_id !== ctx.actor.employeeId) {
      throw new Error("Only the requester may submit settlement.");
    }

    const nowIso = new Date().toISOString();
    const totalSpentDb = moneyToDbString(BigInt(input.total_spent_idr));

    const { data: inserted, error: insertErr } = await supabase
      .from("cash_advance_settlements")
      .insert({
        tenant_id: ctx.actor.tenantId,
        cash_advance_id: input.cash_advance_id,
        submitted_by: ctx.actor.employeeId,
        status: "SUBMITTED",
        total_spent: totalSpentDb as unknown as number,
        notes: input.notes ?? null,
        submitted_at: nowIso,
      })
      .select("id, status")
      .single();
    if (insertErr || !inserted) {
      throw new Error(insertErr?.message ?? "Failed to submit settlement.");
    }

    await notifyRoles({
      tenantId: ctx.actor.tenantId,
      roles: ["LEAD_FINANCE", "TENANT_ADMIN"],
      kind: "APPROVAL_REQUESTED",
      title: "Cash advance settlement submitted",
      actionUrl: `/finance/cash-advances/${input.cash_advance_id}`,
    });

    revalidatePath(`/finance/cash-advances/${input.cash_advance_id}`);
    revalidatePath("/finance/cash-advances");

    return {
      result: { id: inserted.id, status: inserted.status },
      auditResourceId: inserted.id,
      auditNewValues: {
        cash_advance_id: input.cash_advance_id,
        total_spent: totalSpentDb,
        status: inserted.status,
      },
    };
  },
});

export const acceptSettlementAction = withSecureAction({
  schema: acceptSettlementSchema,
  resource: "cash_advance_settlement",
  action: "settle",
  auditAction: "SETTLE",
  auditResourceName: "cash_advance_settlements",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: settlement, error: readErr } = await supabase
      .from("cash_advance_settlements")
      .select("*")
      .eq("id", input.settlement_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !settlement) throw new Error("Settlement not found.");
    if (settlement.status !== "SUBMITTED") {
      throw new Error("Only SUBMITTED settlements can be accepted.");
    }

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("cash_advance_settlements")
      .update({
        status: "ACCEPTED" satisfies CashAdvanceSettlementStatus,
        accepted_at: nowIso,
        accepted_by: ctx.actor.employeeId,
      })
      .eq("id", input.settlement_id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    // Compute net (positive = employee refunds; negative = top-up to employee).
    const { data: ca } = await supabase
      .from("cash_advances")
      .select("amount, requester_employee_id, project_id, id")
      .eq("id", settlement.cash_advance_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (!ca) throw new Error("Parent cash advance vanished.");

    const advanceMoney = parseMoneyFromDb(ca.amount);
    const spentMoney = parseMoneyFromDb(settlement.total_spent);
    const netRefund = advanceMoney - spentMoney; // positive → employee owes back

    const { error: caErr } = await supabase
      .from("cash_advances")
      .update({
        status: "SETTLED",
        settled_at: nowIso,
        net_settlement_amount: moneyToDbString(netRefund) as unknown as number,
      })
      .eq("id", ca.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (caErr) throw new Error(caErr.message);

    // Roll spent into project budget.
    const { data: budget } = await supabase
      .from("project_budgets")
      .select("spent_amount")
      .eq("project_id", ca.project_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (budget) {
      const newSpent =
        parseMoneyFromDb(budget.spent_amount) +
        parseMoneyFromDb(settlement.total_spent);
      await supabase
        .from("project_budgets")
        .update({ spent_amount: moneyToDbString(newSpent) as unknown as number })
        .eq("project_id", ca.project_id)
        .eq("tenant_id", ctx.actor.tenantId);
    }

    const { data: requester } = await supabase
      .from("employees")
      .select("user_id, id")
      .eq("id", ca.requester_employee_id)
      .maybeSingle();
    if (requester) {
      await notifyUser({
        recipient: { userId: requester.user_id, employeeId: requester.id },
        kind: "CASH_ADVANCE_SETTLED",
        title: "Cash advance settled",
        actionUrl: `/finance/cash-advances/${ca.id}`,
      });
    }

    revalidatePath(`/finance/cash-advances/${ca.id}`);
    revalidatePath("/finance/cash-advances");

    return {
      result: {
        id: input.settlement_id,
        status: "ACCEPTED" as CashAdvanceSettlementStatus,
      },
      auditResourceId: input.settlement_id,
      auditOldValues: { status: settlement.status },
      auditNewValues: { status: "ACCEPTED" },
    };
  },
});

export const returnSettlementAction = withSecureAction({
  schema: returnSettlementSchema,
  resource: "cash_advance_settlement",
  action: "settle",
  auditAction: "REJECT",
  auditResourceName: "cash_advance_settlements",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: settlement, error: readErr } = await supabase
      .from("cash_advance_settlements")
      .select("*")
      .eq("id", input.settlement_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !settlement) throw new Error("Settlement not found.");
    if (settlement.status !== "SUBMITTED") {
      throw new Error("Only SUBMITTED settlements can be returned.");
    }

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("cash_advance_settlements")
      .update({
        status: "RETURNED" satisfies CashAdvanceSettlementStatus,
        returned_at: nowIso,
        returned_by: ctx.actor.employeeId,
        return_reason: input.reason,
      })
      .eq("id", input.settlement_id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    revalidatePath(`/finance/cash-advances/${settlement.cash_advance_id}`);
    revalidatePath("/finance/cash-advances");

    return {
      result: {
        id: input.settlement_id,
        status: "RETURNED" as CashAdvanceSettlementStatus,
      },
      auditResourceId: input.settlement_id,
      auditOldValues: { status: settlement.status },
      auditNewValues: { status: "RETURNED", reason: input.reason },
    };
  },
});
