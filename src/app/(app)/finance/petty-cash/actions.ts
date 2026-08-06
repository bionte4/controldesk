"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { moneyToDbString, parseMoneyFromDb } from "@/lib/format/money";
import { createClient } from "@/lib/supabase/server";
import { notifyRoles, notifyUser } from "@/lib/notifications/service";
import {
  approveReplenishmentSchema,
  createPettyCashFundSchema,
  createPettyCashVoucherSchema,
  disburseReplenishmentSchema,
  rejectReplenishmentSchema,
  requestReplenishmentSchema,
  voidPettyCashVoucherSchema,
} from "@/lib/validation/petty-cash";
import type { PettyCashReplenishmentStatus } from "@/types/database";

// ---------------------------------------------------------------------------
// FUND — create
// ---------------------------------------------------------------------------
export const createPettyCashFundAction = withSecureAction({
  schema: createPettyCashFundSchema,
  resource: "petty_cash_fund",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "petty_cash_funds",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const imprestDb = moneyToDbString(BigInt(input.imprest_idr));
    const minBalanceDb = moneyToDbString(BigInt(input.min_balance_idr));
    const openingDb = moneyToDbString(
      BigInt(input.opening_balance_idr ?? input.imprest_idr),
    );

    const { data: inserted, error: insertErr } = await supabase
      .from("petty_cash_funds")
      .insert({
        tenant_id: ctx.actor.tenantId,
        location_name: input.location_name,
        custodian_employee_id: input.custodian_employee_id,
        imprest_amount: imprestDb as unknown as number,
        balance: openingDb as unknown as number,
        min_balance: minBalanceDb as unknown as number,
      })
      .select("id, location_name")
      .single();
    if (insertErr || !inserted) {
      throw new Error(insertErr?.message ?? "Failed to create fund.");
    }

    revalidatePath("/finance/petty-cash");

    return {
      result: { id: inserted.id },
      auditResourceId: inserted.id,
      auditNewValues: {
        location_name: inserted.location_name,
        imprest: imprestDb,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// VOUCHER — record petty spend
// ---------------------------------------------------------------------------
export const recordPettyCashVoucherAction = withSecureAction({
  schema: createPettyCashVoucherSchema,
  resource: "petty_cash_voucher",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "petty_cash_vouchers",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const amountDb = moneyToDbString(BigInt(input.amount_idr));

    const { data: fund, error: fundErr } = await supabase
      .from("petty_cash_funds")
      .select("id, balance, min_balance")
      .eq("id", input.fund_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (fundErr || !fund) throw new Error("Fund not found.");

    const currentBalance = parseMoneyFromDb(fund.balance);
    if (currentBalance < BigInt(input.amount_idr)) {
      throw new Error("Insufficient fund balance for this voucher.");
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("petty_cash_vouchers")
      .insert({
        tenant_id: ctx.actor.tenantId,
        fund_id: input.fund_id,
        created_by: ctx.actor.employeeId,
        amount: amountDb as unknown as number,
        category: input.category,
        description: input.description,
        incurred_on: input.incurred_on,
        receipt_url: input.receipt_url ?? null,
        status: "RECORDED",
      })
      .select("id, amount")
      .single();
    if (insertErr || !inserted) {
      throw new Error(insertErr?.message ?? "Failed to record voucher.");
    }

    // Check whether the fund now needs replenishment.
    const newBalance = currentBalance - BigInt(input.amount_idr);
    const minBalance = parseMoneyFromDb(fund.min_balance);
    if (newBalance < minBalance) {
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: ["LEAD_FINANCE", "TENANT_ADMIN"],
        kind: "PETTY_CASH_LOW_BALANCE",
        title: "Petty cash fund below minimum threshold",
        body: "Please review and disburse a replenishment request.",
        actionUrl: `/finance/petty-cash/${input.fund_id}`,
      });
    }

    revalidatePath("/finance/petty-cash");
    revalidatePath(`/finance/petty-cash/${input.fund_id}`);

    return {
      result: { id: inserted.id },
      auditResourceId: inserted.id,
      auditNewValues: {
        fund_id: input.fund_id,
        amount: amountDb,
        category: input.category,
      },
    };
  },
});

export const voidPettyCashVoucherAction = withSecureAction({
  schema: voidPettyCashVoucherSchema,
  resource: "petty_cash_voucher",
  action: "cancel",
  auditAction: "CANCEL",
  auditResourceName: "petty_cash_vouchers",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("petty_cash_vouchers")
      .select("created_by")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      ownerEmployeeId: row?.created_by ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const nowIso = new Date().toISOString();
    const { data: current, error: readErr } = await supabase
      .from("petty_cash_vouchers")
      .select("status, fund_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Voucher not found.");
    if (current.status !== "RECORDED") {
      throw new Error("Only RECORDED vouchers can be voided.");
    }

    const { error: updateErr } = await supabase
      .from("petty_cash_vouchers")
      .update({
        status: "VOIDED",
        voided_at: nowIso,
        voided_by: ctx.actor.employeeId,
        void_reason: input.reason,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    revalidatePath("/finance/petty-cash");
    revalidatePath(`/finance/petty-cash/${current.fund_id}`);

    return {
      result: { id: input.id, status: "VOIDED" as const },
      auditResourceId: input.id,
      auditOldValues: { status: current.status },
      auditNewValues: { status: "VOIDED", reason: input.reason },
    };
  },
});

// ---------------------------------------------------------------------------
// REPLENISHMENT — custodian requests, Lead Finance approves + disburses.
// ---------------------------------------------------------------------------
export const requestReplenishmentAction = withSecureAction({
  schema: requestReplenishmentSchema,
  resource: "petty_cash_replenishment",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "petty_cash_replenishments",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const amountDb = moneyToDbString(BigInt(input.requested_amount_idr));

    const { data: inserted, error: insertErr } = await supabase
      .from("petty_cash_replenishments")
      .insert({
        tenant_id: ctx.actor.tenantId,
        fund_id: input.fund_id,
        requested_by: ctx.actor.employeeId,
        requested_amount: amountDb as unknown as number,
        reason: input.reason ?? null,
        status: "PENDING_FINANCE",
      })
      .select("id")
      .single();
    if (insertErr || !inserted) {
      throw new Error(insertErr?.message ?? "Failed to submit request.");
    }

    await notifyRoles({
      tenantId: ctx.actor.tenantId,
      roles: ["LEAD_FINANCE", "TENANT_ADMIN"],
      kind: "APPROVAL_REQUESTED",
      title: "Petty cash replenishment awaiting approval",
      actionUrl: `/finance/petty-cash/replenishments/${inserted.id}`,
    });

    revalidatePath("/finance/petty-cash");
    revalidatePath("/approvals");

    return {
      result: { id: inserted.id },
      auditResourceId: inserted.id,
      auditNewValues: {
        fund_id: input.fund_id,
        requested_amount: amountDb,
      },
    };
  },
});

export const approveReplenishmentAction = withSecureAction({
  schema: approveReplenishmentSchema,
  resource: "petty_cash_replenishment",
  action: "approve",
  auditAction: "APPROVE",
  auditResourceName: "petty_cash_replenishments",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("petty_cash_replenishments")
      .select("status, fund_id, requested_by")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Replenishment not found.");
    if (current.status !== "PENDING_FINANCE") {
      throw new Error("Only PENDING_FINANCE requests can be approved.");
    }

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("petty_cash_replenishments")
      .update({
        status: "APPROVED" satisfies PettyCashReplenishmentStatus,
        approved_at: nowIso,
        approved_by: ctx.actor.employeeId,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { data: requester } = await supabase
      .from("employees")
      .select("user_id, id")
      .eq("id", current.requested_by)
      .maybeSingle();
    if (requester) {
      await notifyUser({
        recipient: { userId: requester.user_id, employeeId: requester.id },
        kind: "APPROVAL_APPROVED",
        title: "Replenishment approved · awaiting disbursement",
        actionUrl: `/finance/petty-cash/${current.fund_id}`,
      });
    }

    revalidatePath("/finance/petty-cash");
    revalidatePath("/approvals");

    return {
      result: {
        id: input.id,
        status: "APPROVED" as PettyCashReplenishmentStatus,
      },
      auditResourceId: input.id,
      auditOldValues: { status: current.status },
      auditNewValues: { status: "APPROVED" },
    };
  },
});

export const rejectReplenishmentAction = withSecureAction({
  schema: rejectReplenishmentSchema,
  resource: "petty_cash_replenishment",
  action: "reject",
  auditAction: "REJECT",
  auditResourceName: "petty_cash_replenishments",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("petty_cash_replenishments")
      .select("status, fund_id, requested_by")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Replenishment not found.");
    if (current.status !== "PENDING_FINANCE") {
      throw new Error("Only PENDING_FINANCE requests can be rejected.");
    }

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("petty_cash_replenishments")
      .update({
        status: "REJECTED" satisfies PettyCashReplenishmentStatus,
        rejected_at: nowIso,
        rejected_by: ctx.actor.employeeId,
        rejection_reason: input.reason,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { data: requester } = await supabase
      .from("employees")
      .select("user_id, id")
      .eq("id", current.requested_by)
      .maybeSingle();
    if (requester) {
      await notifyUser({
        recipient: { userId: requester.user_id, employeeId: requester.id },
        kind: "APPROVAL_REJECTED",
        title: "Replenishment rejected",
        body: input.reason,
        actionUrl: `/finance/petty-cash/${current.fund_id}`,
      });
    }

    revalidatePath("/finance/petty-cash");
    revalidatePath("/approvals");

    return {
      result: {
        id: input.id,
        status: "REJECTED" as PettyCashReplenishmentStatus,
      },
      auditResourceId: input.id,
      auditOldValues: { status: current.status },
      auditNewValues: { status: "REJECTED", reason: input.reason },
    };
  },
});

export const disburseReplenishmentAction = withSecureAction({
  schema: disburseReplenishmentSchema,
  resource: "petty_cash_replenishment",
  action: "disburse",
  auditAction: "DISBURSE",
  auditResourceName: "petty_cash_replenishments",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("petty_cash_replenishments")
      .select("status, fund_id, requested_by")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Replenishment not found.");
    if (current.status !== "APPROVED") {
      throw new Error("Only APPROVED replenishments can be disbursed.");
    }

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("petty_cash_replenishments")
      .update({
        status: "DISBURSED" satisfies PettyCashReplenishmentStatus,
        disbursed_at: nowIso,
        disbursed_by: ctx.actor.employeeId,
        disbursement_ref: input.disbursement_ref,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { data: requester } = await supabase
      .from("employees")
      .select("user_id, id")
      .eq("id", current.requested_by)
      .maybeSingle();
    if (requester) {
      await notifyUser({
        recipient: { userId: requester.user_id, employeeId: requester.id },
        kind: "APPROVAL_APPROVED",
        title: "Replenishment disbursed",
        body: `Ref ${input.disbursement_ref}. Fund balance updated.`,
        actionUrl: `/finance/petty-cash/${current.fund_id}`,
      });
    }

    revalidatePath("/finance/petty-cash");
    revalidatePath(`/finance/petty-cash/${current.fund_id}`);
    revalidatePath("/approvals");

    return {
      result: {
        id: input.id,
        status: "DISBURSED" as PettyCashReplenishmentStatus,
      },
      auditResourceId: input.id,
      auditOldValues: { status: current.status },
      auditNewValues: {
        status: "DISBURSED",
        disbursement_ref: input.disbursement_ref,
      },
    };
  },
});
