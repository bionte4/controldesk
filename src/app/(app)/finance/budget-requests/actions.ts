"use server";

/**
 * ControlDesk — Budget Request Server Actions (Fase 2, rules §9.6 / §29).
 *
 * All mutations flow through `withCanonicalSecureAction`:
 *   1. Auth (active employee).
 *   2. Zod validation.
 *   3. Canonical PDP (`budget_request` resource for create/cancel;
 *      `decideCanonicalApproval` short-circuit for approve/reject).
 *   4. Handler → DB write + approval-log row.
 *   5. Audit log via wrapper.
 *
 * The `apply` step (APPROVED → APPLIED) also uses the wrapper with a
 * bespoke `update` PDP call so only PM+ / FINANCE can materialise the
 * mutation to `budget_details.planned_amount`.
 */

import { revalidatePath } from "next/cache";

import { computePlannedDeltas } from "@/lib/budget-requests/apply";
import {
  BR_STATUS_SLOT,
  brApproverSlot,
  brCanApprove,
  isBrPending,
  isBrTerminal,
  nextBrStatus,
} from "@/lib/budget-requests/state";
import {
  moneyToDbString,
  parseMoneyFromDb,
} from "@/lib/format/money";
import { notifyRoles, notifyUser } from "@/lib/notifications/service";
import { createClient } from "@/lib/supabase/server";
import { withCanonicalSecureAction } from "@/lib/security/action-wrapper";
import {
  applyBudgetRequestSchema,
  approveBudgetRequestSchema,
  cancelBudgetRequestSchema,
  rejectBudgetRequestSchema,
  submitBudgetRequestSchema,
} from "@/lib/validation/budget-request";
import type {
  AnyDbEmployeeRole,
  CanonicalApprovalSlot,
} from "@/lib/rbac/roles";
import type {
  ApprovalAction,
  BudgetRequestStatus,
  TablesUpdate,
} from "@/types/database";

// ---------------------------------------------------------------------------
// Notification helpers — mirror the pattern used by canonical cash advances.
// ---------------------------------------------------------------------------

const ADMIN_DB_ROLES: readonly AnyDbEmployeeRole[] = [
  "TENANT_ADMIN",
  "ADMIN",
];

function slotToNotifyRoles(
  slot: CanonicalApprovalSlot,
): readonly AnyDbEmployeeRole[] {
  switch (slot) {
    case "SUPERVISOR":
      return ["SUPERVISOR", ...ADMIN_DB_ROLES];
    case "PM":
      return ["PROJECT_MANAGER", "PM", ...ADMIN_DB_ROLES];
    case "OM":
      return ["OPERATIONS_MANAGER", "OM", ...ADMIN_DB_ROLES];
    case "FINANCE":
      return ["LEAD_FINANCE", "FINANCE", ...ADMIN_DB_ROLES];
    case "DIRECTOR":
      return [
        "HEAD_MANAGER",
        "GENERAL_MANAGER",
        "DIRECTOR",
        ...ADMIN_DB_ROLES,
      ];
  }
}

// ---------------------------------------------------------------------------
// Row loader.
// ---------------------------------------------------------------------------

async function loadBudgetRequest(
  id: string,
  tenantId: string,
): Promise<{
  id: string;
  tenant_id: string;
  budget_id: string;
  requester_employee_id: string;
  kind: "INCREASE" | "DECREASE" | "TRANSFER";
  amount: number;
  status: BudgetRequestStatus;
  justification: string;
} | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("budget_requests")
    .select(
      "id, tenant_id, budget_id, requester_employee_id, kind, amount, status, justification",
    )
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as never;
}

async function loadRequestLines(
  requestId: string,
): Promise<
  {
    budget_detail_id: string;
    direction: "FROM" | "TO";
    delta_amount: bigint;
  }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("budget_request_lines")
    .select("budget_detail_id, direction, delta_amount")
    .eq("budget_request_id", requestId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((l) => ({
    budget_detail_id: l.budget_detail_id,
    direction: l.direction as "FROM" | "TO",
    delta_amount: BigInt(parseMoneyFromDb(l.delta_amount)),
  }));
}

async function appendApprovalLog(input: {
  tenantId: string;
  requestId: string;
  actorEmployeeId: string;
  actorRole: AnyDbEmployeeRole | null;
  action: ApprovalAction;
  fromStatus: BudgetRequestStatus;
  toStatus: BudgetRequestStatus;
  comment?: string | null;
}) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("budget_request_approval_logs")
    .insert({
      tenant_id: input.tenantId,
      budget_request_id: input.requestId,
      actor_employee_id: input.actorEmployeeId,
      actor_role: input.actorRole,
      action: input.action,
      from_status: input.fromStatus,
      to_status: input.toStatus,
      comment: input.comment ?? null,
    });
  if (error) throw new Error(error.message);
}

function revalidateBudgetRequestPaths(opts: {
  budgetId: string;
  projectId?: string | null;
}) {
  revalidatePath("/finance/budgets");
  revalidatePath(`/finance/budgets/${opts.budgetId}`);
  revalidatePath("/finance/budget-requests");
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  if (opts.projectId) revalidatePath(`/projects/${opts.projectId}`);
}

async function projectIdFromBudget(budgetId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("budgets")
    .select("project_id")
    .eq("id", budgetId)
    .maybeSingle();
  if (error) return null;
  return data?.project_id ?? null;
}

// ---------------------------------------------------------------------------
// SUBMIT — create request + lines + move to first-slot pending.
// ---------------------------------------------------------------------------

export const submitBudgetRequestAction = withCanonicalSecureAction({
  schema: submitBudgetRequestSchema,
  resource: "budget_request",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "budget_requests",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: budget } = await supabase
      .from("budgets")
      .select("project_id, status")
      .eq("id", input.budget_id)
      .maybeSingle();
    let isAssigned = false;
    if (budget?.project_id) {
      const { data } = await supabase.rpc("is_assigned_to_project", {
        p_project_id: budget.project_id,
      });
      isAssigned = Boolean(data);
    }
    return {
      tenantId: ctx.actor.tenantId,
      projectId: budget?.project_id ?? undefined,
      isActiveAssignment: isAssigned,
      amountIDR: input.amount_idr,
      ownerEmployeeId: ctx.actor.employeeId,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: budget, error: bErr } = await supabase
      .from("budgets")
      .select("id, project_id, status")
      .eq("id", input.budget_id)
      .maybeSingle();
    if (bErr || !budget) throw new Error(bErr?.message ?? "Budget not found.");
    if (budget.status !== "APPROVED") {
      throw new Error(
        `Budget must be APPROVED to accept requests (current=${budget.status}).`,
      );
    }

    const nextStatus = nextBrStatus({
      current: "DRAFT",
      amountIDR: input.amount_idr,
      action: "SUBMIT",
    });

    const { data: inserted, error: insertErr } = await supabase
      .from("budget_requests")
      .insert({
        tenant_id: ctx.actor.tenantId,
        budget_id: input.budget_id,
        requester_employee_id: ctx.actor.employeeId,
        kind: input.kind,
        amount: moneyToDbString(BigInt(input.amount_idr)) as unknown as number,
        justification: input.justification,
        status: nextStatus,
      })
      .select("id, status")
      .single();
    if (insertErr || !inserted) {
      throw new Error(insertErr?.message ?? "Failed to submit budget request.");
    }

    // Build the line payload based on the discriminated `kind`.
    const lineInserts: {
      tenant_id: string;
      budget_request_id: string;
      budget_detail_id: string;
      direction: "FROM" | "TO";
      delta_amount: number;
    }[] = [];
    const deltaDb = moneyToDbString(
      BigInt(input.amount_idr),
    ) as unknown as number;
    if (input.kind === "INCREASE") {
      lineInserts.push({
        tenant_id: ctx.actor.tenantId,
        budget_request_id: inserted.id,
        budget_detail_id: input.target_detail_id,
        direction: "TO",
        delta_amount: deltaDb,
      });
    } else if (input.kind === "DECREASE") {
      lineInserts.push({
        tenant_id: ctx.actor.tenantId,
        budget_request_id: inserted.id,
        budget_detail_id: input.source_detail_id,
        direction: "FROM",
        delta_amount: deltaDb,
      });
    } else {
      lineInserts.push(
        {
          tenant_id: ctx.actor.tenantId,
          budget_request_id: inserted.id,
          budget_detail_id: input.source_detail_id,
          direction: "FROM",
          delta_amount: deltaDb,
        },
        {
          tenant_id: ctx.actor.tenantId,
          budget_request_id: inserted.id,
          budget_detail_id: input.target_detail_id,
          direction: "TO",
          delta_amount: deltaDb,
        },
      );
    }

    // For DECREASE / TRANSFER: verify the source detail line has enough
    // remaining_amount before we route for approval.
    const sourceIds = lineInserts
      .filter((l) => l.direction === "FROM")
      .map((l) => l.budget_detail_id);
    if (sourceIds.length > 0) {
      const { data: details, error: dErr } = await supabase
        .from("budget_details")
        .select("id, remaining_amount")
        .in("id", sourceIds);
      if (dErr) throw new Error(dErr.message);
      const insufficient = (details ?? []).find(
        (d) =>
          BigInt(parseMoneyFromDb(d.remaining_amount)) < BigInt(input.amount_idr),
      );
      if (insufficient) {
        // Rollback the just-inserted header before throwing.
        await supabase
          .from("budget_requests")
          .delete()
          .eq("id", inserted.id)
          .eq("tenant_id", ctx.actor.tenantId);
        throw new Error(
          "Source line has insufficient remaining amount for this request.",
        );
      }
    }

    const { error: lineErr } = await supabase
      .from("budget_request_lines")
      .insert(lineInserts);
    if (lineErr) {
      await supabase
        .from("budget_requests")
        .delete()
        .eq("id", inserted.id)
        .eq("tenant_id", ctx.actor.tenantId);
      throw new Error(lineErr.message);
    }

    await appendApprovalLog({
      tenantId: ctx.actor.tenantId,
      requestId: inserted.id,
      actorEmployeeId: ctx.actor.employeeId,
      actorRole: ctx.legacyActor.role,
      action: "SUBMIT",
      fromStatus: "DRAFT",
      toStatus: nextStatus,
    });

    const nextSlot = brApproverSlot(nextStatus);
    if (nextSlot) {
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: slotToNotifyRoles(nextSlot),
        kind: "APPROVAL_REQUESTED",
        title: `Budget ${input.kind.toLowerCase()} · ${input.amount_idr.toLocaleString("id-ID")} awaiting ${nextSlot}`,
        body: input.justification.slice(0, 200),
        actionUrl: `/finance/budgets/${input.budget_id}#br-${inserted.id}`,
        payload: {
          budget_request_id: inserted.id,
          budget_id: input.budget_id,
          kind: input.kind,
        },
      });
    }

    revalidateBudgetRequestPaths({
      budgetId: input.budget_id,
      projectId: budget.project_id ?? null,
    });

    return {
      result: {
        id: inserted.id,
        status: inserted.status as BudgetRequestStatus,
      },
      auditResourceId: inserted.id,
      auditNewValues: {
        kind: input.kind,
        amount_idr: input.amount_idr,
        budget_id: input.budget_id,
        status: nextStatus,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// APPROVE — advance one slot.
// ---------------------------------------------------------------------------

export const approveBudgetRequestAction = withCanonicalSecureAction({
  schema: approveBudgetRequestSchema,
  resource: "budget_request",
  action: "approve",
  auditAction: "APPROVE",
  auditResourceName: "budget_requests",
  resolveAttributes: async (input, ctx) => {
    const row = await loadBudgetRequest(input.id, ctx.actor.tenantId);
    const slot = row ? BR_STATUS_SLOT[row.status] : null;
    return {
      tenantId: ctx.actor.tenantId,
      status: row?.status,
      amountIDR: row ? Number(parseMoneyFromDb(row.amount)) : undefined,
      pendingSlot: slot ?? undefined,
      ownerEmployeeId: row?.requester_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const row = await loadBudgetRequest(input.id, ctx.actor.tenantId);
    if (!row) throw new Error("Budget request not found.");
    if (!isBrPending(row.status)) {
      throw new Error(
        `Cannot approve status ${row.status} (not pending).`,
      );
    }
    if (
      !brCanApprove({ actorRole: ctx.actor.role, current: row.status })
    ) {
      throw new Error(
        `Role ${ctx.actor.role} cannot approve status ${row.status}.`,
      );
    }

    const amountIDR = Number(parseMoneyFromDb(row.amount));
    const currentSlot = BR_STATUS_SLOT[row.status];
    const action: ApprovalAction =
      currentSlot === "FINANCE" ? "FINANCE_APPROVE" : "APPROVE";
    const nextStatus = nextBrStatus({
      current: row.status,
      amountIDR,
      action,
    });

    const nowIso = new Date().toISOString();
    const patch: TablesUpdate<"budget_requests"> = { status: nextStatus };
    switch (currentSlot) {
      case "PM":
        patch.pm_approved_at = nowIso;
        patch.pm_approver_id = ctx.actor.employeeId;
        break;
      case "FINANCE":
        patch.finance_approved_at = nowIso;
        patch.finance_approver_id = ctx.actor.employeeId;
        break;
      case "DIRECTOR":
        patch.director_approved_at = nowIso;
        patch.director_approver_id = ctx.actor.employeeId;
        break;
      default:
        break;
    }
    if (nextStatus === "APPROVED") {
      patch.approved_at = nowIso;
    }

    const supabase = await createClient();
    const { error: updateErr } = await supabase
      .from("budget_requests")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    await appendApprovalLog({
      tenantId: ctx.actor.tenantId,
      requestId: input.id,
      actorEmployeeId: ctx.actor.employeeId,
      actorRole: ctx.legacyActor.role,
      action,
      fromStatus: row.status,
      toStatus: nextStatus,
      comment: input.comment ?? null,
    });

    // Notify requester + next approver.
    const projectId = await projectIdFromBudget(row.budget_id);
    const nextSlot = brApproverSlot(nextStatus);
    if (nextStatus === "APPROVED") {
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: slotToNotifyRoles("FINANCE"),
        kind: "APPROVAL_APPROVED",
        title: "Budget request approved · ready to apply",
        actionUrl: `/finance/budgets/${row.budget_id}#br-${input.id}`,
        payload: { budget_request_id: input.id },
      });
    } else if (nextSlot) {
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: slotToNotifyRoles(nextSlot),
        kind: "APPROVAL_REQUESTED",
        title: `Budget request awaiting ${nextSlot}`,
        actionUrl: `/finance/budgets/${row.budget_id}#br-${input.id}`,
        payload: { budget_request_id: input.id },
      });
    }

    revalidateBudgetRequestPaths({
      budgetId: row.budget_id,
      projectId,
    });

    return {
      result: { id: input.id, status: nextStatus },
      auditResourceId: input.id,
      auditOldValues: { status: row.status },
      auditNewValues: { status: nextStatus, slot: currentSlot },
    };
  },
});

// ---------------------------------------------------------------------------
// REJECT — any pending → REJECTED.
// ---------------------------------------------------------------------------

export const rejectBudgetRequestAction = withCanonicalSecureAction({
  schema: rejectBudgetRequestSchema,
  resource: "budget_request",
  action: "reject",
  auditAction: "REJECT",
  auditResourceName: "budget_requests",
  resolveAttributes: async (input, ctx) => {
    const row = await loadBudgetRequest(input.id, ctx.actor.tenantId);
    const slot = row ? BR_STATUS_SLOT[row.status] : null;
    return {
      tenantId: ctx.actor.tenantId,
      status: row?.status,
      amountIDR: row ? Number(parseMoneyFromDb(row.amount)) : undefined,
      pendingSlot: slot ?? undefined,
      ownerEmployeeId: row?.requester_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const row = await loadBudgetRequest(input.id, ctx.actor.tenantId);
    if (!row) throw new Error("Budget request not found.");
    if (!isBrPending(row.status)) {
      throw new Error(`Cannot reject status ${row.status}.`);
    }
    if (
      !brCanApprove({ actorRole: ctx.actor.role, current: row.status })
    ) {
      throw new Error(
        `Role ${ctx.actor.role} cannot reject status ${row.status}.`,
      );
    }

    const supabase = await createClient();
    const nowIso = new Date().toISOString();
    const currentSlot = BR_STATUS_SLOT[row.status];
    const action: ApprovalAction =
      currentSlot === "FINANCE" ? "FINANCE_REJECT" : "REJECT";

    const { error: updateErr } = await supabase
      .from("budget_requests")
      .update({
        status: "REJECTED",
        rejected_at: nowIso,
        rejected_by: ctx.actor.employeeId,
        rejection_reason: input.reason,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    await appendApprovalLog({
      tenantId: ctx.actor.tenantId,
      requestId: input.id,
      actorEmployeeId: ctx.actor.employeeId,
      actorRole: ctx.legacyActor.role,
      action,
      fromStatus: row.status,
      toStatus: "REJECTED",
      comment: input.reason,
    });

    const { data: requester } = await supabase
      .from("employees")
      .select("user_id")
      .eq("id", row.requester_employee_id)
      .maybeSingle();
    if (requester?.user_id) {
      await notifyUser({
        recipient: {
          userId: requester.user_id,
          employeeId: row.requester_employee_id,
        },
        kind: "APPROVAL_REJECTED",
        title: "Budget request rejected",
        body: input.reason,
        actionUrl: `/finance/budgets/${row.budget_id}#br-${input.id}`,
        payload: { budget_request_id: input.id },
      });
    }

    const projectId = await projectIdFromBudget(row.budget_id);
    revalidateBudgetRequestPaths({
      budgetId: row.budget_id,
      projectId,
    });

    return {
      result: { id: input.id, status: "REJECTED" as const },
      auditResourceId: input.id,
      auditOldValues: { status: row.status },
      auditNewValues: { status: "REJECTED", reason: input.reason },
    };
  },
});

// ---------------------------------------------------------------------------
// CANCEL — requester withdraws while still pending / DRAFT.
// ---------------------------------------------------------------------------

export const cancelBudgetRequestAction = withCanonicalSecureAction({
  schema: cancelBudgetRequestSchema,
  resource: "budget_request",
  action: "cancel",
  auditAction: "UPDATE",
  auditResourceName: "budget_requests",
  resolveAttributes: async (input, ctx) => {
    const row = await loadBudgetRequest(input.id, ctx.actor.tenantId);
    return {
      tenantId: ctx.actor.tenantId,
      status: row?.status,
      ownerEmployeeId: row?.requester_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const row = await loadBudgetRequest(input.id, ctx.actor.tenantId);
    if (!row) throw new Error("Budget request not found.");
    if (isBrTerminal(row.status)) {
      throw new Error(
        `Cannot cancel terminal status ${row.status}.`,
      );
    }

    const supabase = await createClient();
    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("budget_requests")
      .update({
        status: "CANCELLED",
        cancelled_at: nowIso,
        cancelled_by: ctx.actor.employeeId,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    await appendApprovalLog({
      tenantId: ctx.actor.tenantId,
      requestId: input.id,
      actorEmployeeId: ctx.actor.employeeId,
      actorRole: ctx.legacyActor.role,
      action: "CANCEL",
      fromStatus: row.status,
      toStatus: "CANCELLED",
      comment: input.comment ?? null,
    });

    const projectId = await projectIdFromBudget(row.budget_id);
    revalidateBudgetRequestPaths({
      budgetId: row.budget_id,
      projectId,
    });

    return {
      result: { id: input.id, status: "CANCELLED" as const },
      auditResourceId: input.id,
      auditOldValues: { status: row.status },
      auditNewValues: { status: "CANCELLED" },
    };
  },
});

// ---------------------------------------------------------------------------
// APPLY — APPROVED → APPLIED, mutate budget_details.planned_amount, roll up
// budgets.total_planned_amount. Finance (or PM+) triggers this button.
// ---------------------------------------------------------------------------

export const applyBudgetRequestAction = withCanonicalSecureAction({
  schema: applyBudgetRequestSchema,
  resource: "budget_request",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "budget_requests",
  resolveAttributes: async (input, ctx) => {
    const row = await loadBudgetRequest(input.id, ctx.actor.tenantId);
    return {
      tenantId: ctx.actor.tenantId,
      status: row?.status,
      // For the PDP: apply is only allowed when the row is APPROVED. The
      // PDP `update` policy denies write when status is not DRAFT/PENDING_PM,
      // so we short-circuit at the handler level below with the actor role
      // gate (Finance + PM+ can apply).
      ownerEmployeeId: row?.requester_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const row = await loadBudgetRequest(input.id, ctx.actor.tenantId);
    if (!row) throw new Error("Budget request not found.");
    if (row.status !== "APPROVED") {
      throw new Error(
        `Only APPROVED requests can be applied (current=${row.status}).`,
      );
    }
    // PDP restricts update to DRAFT/PENDING_PM+owner. For APPLY we need a
    // separate role gate: Finance / PM / OM / Director / Admin.
    const allowedApplyRoles: readonly AnyDbEmployeeRole[] = [
      "LEAD_FINANCE",
      "FINANCE",
      "PROJECT_MANAGER",
      "PM",
      "OPERATIONS_MANAGER",
      "OM",
      "HEAD_MANAGER",
      "GENERAL_MANAGER",
      "DIRECTOR",
      ...ADMIN_DB_ROLES,
    ];
    if (!allowedApplyRoles.includes(ctx.actor.role)) {
      throw new Error(
        `Role ${ctx.actor.role} cannot apply budget requests.`,
      );
    }

    const lines = await loadRequestLines(input.id);
    const deltas = computePlannedDeltas({
      kind: row.kind,
      lines,
    });

    // Load current planned_amount + budget total for each affected detail.
    const supabase = await createClient();
    const detailIds = deltas.map((d) => d.budget_detail_id);
    const { data: details, error: dErr } = await supabase
      .from("budget_details")
      .select("id, budget_id, planned_amount")
      .in("id", detailIds);
    if (dErr) throw new Error(dErr.message);
    const detailById = new Map<string, { budget_id: string; planned: bigint }>();
    for (const d of details ?? []) {
      detailById.set(d.id, {
        budget_id: d.budget_id,
        planned: BigInt(parseMoneyFromDb(d.planned_amount)),
      });
    }

    // Guard: every detail belongs to this request's budget.
    for (const d of details ?? []) {
      if (d.budget_id !== row.budget_id) {
        throw new Error(
          "Line references a budget_detail from a different budget.",
        );
      }
    }

    // Apply per-line deltas. Validate no negative planned_amount before
    // issuing the UPDATE — respects the CHECK constraint.
    const newPlannedById = new Map<string, bigint>();
    for (const delta of deltas) {
      const cur = detailById.get(delta.budget_detail_id);
      if (!cur) {
        throw new Error(
          `Detail ${delta.budget_detail_id} not found for this budget.`,
        );
      }
      const next = cur.planned + delta.delta;
      if (next < 0n) {
        throw new Error(
          "Applying this request would drive a line planned_amount below zero.",
        );
      }
      newPlannedById.set(delta.budget_detail_id, next);
    }

    for (const [detailId, planned] of newPlannedById.entries()) {
      const { error: pErr } = await supabase
        .from("budget_details")
        .update({
          planned_amount: moneyToDbString(planned) as unknown as number,
          updated_by: ctx.actor.employeeId,
        })
        .eq("id", detailId)
        .eq("tenant_id", ctx.actor.tenantId);
      if (pErr) throw new Error(pErr.message);
    }

    // Roll up budgets.total_planned_amount by the net delta (0 for TRANSFER).
    let totalDelta = 0n;
    for (const d of deltas) totalDelta += d.delta;
    if (totalDelta !== 0n) {
      const { data: budgetRow, error: bErr } = await supabase
        .from("budgets")
        .select("total_planned_amount")
        .eq("id", row.budget_id)
        .single();
      if (bErr || !budgetRow) throw new Error(bErr?.message ?? "Budget not found.");
      const newTotal =
        BigInt(parseMoneyFromDb(budgetRow.total_planned_amount)) + totalDelta;
      if (newTotal < 0n) {
        throw new Error("Applying this request drives budget total below zero.");
      }
      const { error: uErr } = await supabase
        .from("budgets")
        .update({
          total_planned_amount: moneyToDbString(newTotal) as unknown as number,
          updated_by: ctx.actor.employeeId,
        })
        .eq("id", row.budget_id)
        .eq("tenant_id", ctx.actor.tenantId);
      if (uErr) throw new Error(uErr.message);
    }

    // Mark request APPLIED.
    const nowIso = new Date().toISOString();
    const { error: applyErr } = await supabase
      .from("budget_requests")
      .update({
        status: "APPLIED",
        applied_at: nowIso,
        applied_by: ctx.actor.employeeId,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (applyErr) throw new Error(applyErr.message);

    await appendApprovalLog({
      tenantId: ctx.actor.tenantId,
      requestId: input.id,
      actorEmployeeId: ctx.actor.employeeId,
      actorRole: ctx.legacyActor.role,
      action: "APPROVE",
      fromStatus: "APPROVED",
      toStatus: "APPLIED",
      comment: input.comment ?? "Applied to budget_details.",
    });

    // Notify requester of the applied change.
    const { data: requester } = await supabase
      .from("employees")
      .select("user_id")
      .eq("id", row.requester_employee_id)
      .maybeSingle();
    if (requester?.user_id) {
      await notifyUser({
        recipient: {
          userId: requester.user_id,
          employeeId: row.requester_employee_id,
        },
        kind: "APPROVAL_APPROVED",
        title: "Budget request applied",
        body: `Your ${row.kind.toLowerCase()} of ${Number(
          parseMoneyFromDb(row.amount),
        ).toLocaleString("id-ID")} has been applied.`,
        actionUrl: `/finance/budgets/${row.budget_id}#br-${input.id}`,
        payload: { budget_request_id: input.id },
      });
    }

    const projectId = await projectIdFromBudget(row.budget_id);
    revalidateBudgetRequestPaths({
      budgetId: row.budget_id,
      projectId,
    });

    return {
      result: { id: input.id, status: "APPLIED" as const },
      auditResourceId: input.id,
      auditOldValues: { status: row.status },
      auditNewValues: {
        status: "APPLIED",
        deltas: deltas.map((d) => ({
          budget_detail_id: d.budget_detail_id,
          delta_idr: d.delta.toString(),
        })),
      },
    };
  },
});
