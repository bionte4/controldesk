"use server";

/**
 * ControlDesk — Cash Advance canonical Server Actions (Fase 1.5, GAS-aligned).
 *
 * These actions back the NEW cash-advance flow (`ca_type` + canonical
 * PENDING_* statuses) introduced in migration 0027. The legacy actions in
 * `./actions.ts` remain in service for any in-flight `PENDING_L*` rows
 * until they terminate.
 *
 * Every mutation goes through `withCanonicalSecureAction`:
 *   1. Auth (requires an active employee).
 *   2. Zod validation.
 *   3. Canonical PDP (`authorizeCanonical` → resource-specific policy).
 *   4. Handler.
 *   5. Audit log via `recordAudit()`.
 *
 * Money is serialised via `moneyToDbString` (`bigint` → `numeric(18,2)`
 * string). We cast to `number` at the Supabase call site because the
 * generator now types `numeric` columns as `number`; the runtime accepts
 * the string form losslessly.
 */

import { revalidatePath } from "next/cache";

import {
  moneyToDbString,
  parseMoneyFromDb,
} from "@/lib/format/money";
import { createClient } from "@/lib/supabase/server";
import { assertPostableCoa } from "@/lib/data/coa";
import { assertProjectOperational } from "@/lib/data/projects";
import { notifyRoles, notifyUser } from "@/lib/notifications/service";
import { translatorFor } from "@/lib/notifications/localize";
import { withCanonicalSecureAction } from "@/lib/security/action-wrapper";
import {
  CANONICAL_CA_STATUS_SLOT,
  canonicalCaCanApprove,
  isCanonicalCaStatus,
  nextCanonicalCaStatus,
  type CanonicalCaStatus,
} from "@/lib/cash-advance/state-canonical";
import {
  acceptCanonicalSettlementSchema,
  approveCanonicalCashAdvanceSchema,
  cancelCanonicalCashAdvanceSchema,
  disburseCanonicalCashAdvanceSchema,
  rejectCanonicalCashAdvanceSchema,
  returnCanonicalSettlementSchema,
  submitCanonicalCashAdvanceSchema,
  submitCanonicalSettlementSchema,
} from "@/lib/validation/cash-advance-canonical";
import type {
  AnyDbEmployeeRole,
  CanonicalApprovalSlot,
} from "@/lib/rbac/roles";
import type {
  ApprovalAction,
  CashAdvanceSettlementStatus,
  CashAdvanceStatus,
  CashAdvanceType,
  TablesUpdate,
} from "@/types/database";

// ---------------------------------------------------------------------------
// Notification helpers — map a canonical slot onto the set of DB roles that
// can act on it, so `notifyRoles()` reaches both legacy and canonical
// employees in the tenant.
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

function slotForCanonicalStatus(
  status: CanonicalCaStatus,
): CanonicalApprovalSlot | null {
  return CANONICAL_CA_STATUS_SLOT[status];
}

// ---------------------------------------------------------------------------
// SUBMIT — create + move to the first slot in the canonical chain.
// ---------------------------------------------------------------------------

export const submitCanonicalCashAdvanceAction = withCanonicalSecureAction({
  schema: submitCanonicalCashAdvanceSchema,
  resource: (input) =>
    input.ca_type === "FIELD_OPS"
      ? "cash_advance_field_ops"
      : "cash_advance_general",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "cash_advances",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: assigned } = await supabase.rpc("is_assigned_to_project", {
      p_project_id: input.project_id,
    });
    // FieldOps CAs are supervisor-initiated (see pdp-canonical). We map
    // the resource dynamically so the PDP applies the correct policy.
    return {
      tenantId: ctx.actor.tenantId,
      projectId: input.project_id,
      isActiveAssignment: Boolean(assigned),
      amountIDR: input.amount_idr,
      ownerEmployeeId: ctx.actor.employeeId,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    // Fase 1 gate — refuse ops on projects still in DRAFT/PLANNING.
    await assertProjectOperational(input.project_id);
    const amountDb = moneyToDbString(BigInt(input.amount_idr));
    const validCoaId = await assertPostableCoa(input.coa_id);

    const nextStatus = nextCanonicalCaStatus({
      type: input.ca_type,
      amountIDR: input.amount_idr,
      current: "DRAFT",
      action: "SUBMIT",
    });

    const { data: inserted, error: insertErr } = await supabase
      .from("cash_advances")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id,
        requester_employee_id: ctx.actor.employeeId,
        ca_type: input.ca_type,
        amount: amountDb as unknown as number,
        purpose: input.purpose,
        needed_by: input.needed_by ?? null,
        coa_id: validCoaId,
        status: nextStatus satisfies CashAdvanceStatus,
      })
      .select("id, status, ca_type")
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
        actor_role: ctx.legacyActor.role,
        action: "SUBMIT",
        from_status: "DRAFT",
        to_status: nextStatus satisfies CashAdvanceStatus,
        comment: null,
      });
    if (logErr) throw new Error(logErr.message);

    const nextSlot = slotForCanonicalStatus(nextStatus);
    if (nextSlot) {
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: slotToNotifyRoles(nextSlot),
        kind: "APPROVAL_REQUESTED",
        title: `Cash advance awaiting ${nextSlot} · ${input.amount_idr.toLocaleString("id-ID")}`,
        body: input.purpose.slice(0, 200),
        actionUrl: `/finance/cash-advances/${inserted.id}`,
        payload: { cash_advance_id: inserted.id, ca_type: input.ca_type },
      });
    }

    revalidatePath("/finance/cash-advances");
    revalidatePath("/approvals");
    revalidatePath(`/projects/${input.project_id}`);

    return {
      result: {
        id: inserted.id,
        status: inserted.status as CashAdvanceStatus,
        ca_type: inserted.ca_type as CashAdvanceType,
      },
      auditResourceId: inserted.id,
      auditNewValues: {
        ca_type: input.ca_type,
        amount: amountDb,
        status: inserted.status,
        project_id: input.project_id,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// APPROVE — advance one slot in the canonical chain. FINANCE slot expects
// `FINANCE_APPROVE` action; all other slots use `APPROVE`. The state
// machine enforces this contract via `nextCanonicalCaStatus`.
// ---------------------------------------------------------------------------

async function loadCanonicalCa(input: { id: string; tenantId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cash_advances")
    .select(
      "id, tenant_id, ca_type, status, amount, project_id, requester_employee_id",
    )
    .eq("id", input.id)
    .eq("tenant_id", input.tenantId)
    .single();
  if (error || !data) return null;
  return data;
}

/**
 * Map a CA row's `ca_type` onto its canonical PDP resource key.
 *
 * `approve` / `reject` short-circuit to `decideCanonicalApproval` regardless
 * of which of the two keys is passed, so slot enforcement is identical.
 * `cancel` / `disburse` differ per resource — that's why we route.
 */
function caResourceForType(caType: CashAdvanceType | null | undefined) {
  return caType === "FIELD_OPS"
    ? ("cash_advance_field_ops" as const)
    : ("cash_advance_general" as const);
}

export const approveCanonicalCashAdvanceAction = withCanonicalSecureAction({
  schema: approveCanonicalCashAdvanceSchema,
  resource: (_input, attrs) => caResourceForType(attrs.caType ?? null),
  action: "approve",
  auditAction: "APPROVE",
  auditResourceName: "cash_advances",
  resolveAttributes: async (input, ctx) => {
    const row = await loadCanonicalCa({
      id: input.id,
      tenantId: ctx.actor.tenantId,
    });
    const status = row?.status as CashAdvanceStatus | undefined;
    const slot =
      status && isCanonicalCaStatus(status)
        ? CANONICAL_CA_STATUS_SLOT[status]
        : undefined;
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status,
      ownerEmployeeId: row?.requester_employee_id ?? undefined,
      amountIDR: row ? Number(parseMoneyFromDb(row.amount)) : undefined,
      pendingSlot: slot ?? undefined,
      caType: (row?.ca_type as CashAdvanceType | undefined) ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const current = await loadCanonicalCa({
      id: input.id,
      tenantId: ctx.actor.tenantId,
    });
    if (!current) throw new Error("Cash advance not found.");

    const currentStatus = current.status as CashAdvanceStatus;
    if (!isCanonicalCaStatus(currentStatus)) {
      throw new Error(
        `Cash advance ${input.id} is on the legacy flow — use the legacy actions.`,
      );
    }
    if (!canonicalCaCanApprove({
      actorRole: ctx.actor.role,
      current: currentStatus,
    })) {
      throw new Error(
        `Role ${ctx.actor.role} cannot approve status ${currentStatus}.`,
      );
    }

    const amountIDR = Number(parseMoneyFromDb(current.amount));
    const currentSlot = CANONICAL_CA_STATUS_SLOT[currentStatus];
    const action: ApprovalAction =
      currentSlot === "FINANCE" ? "FINANCE_APPROVE" : "APPROVE";
    const nextStatus = nextCanonicalCaStatus({
      type: current.ca_type as CashAdvanceType,
      amountIDR,
      current: currentStatus,
      action,
    });

    const nowIso = new Date().toISOString();
    const patch: TablesUpdate<"cash_advances"> = { status: nextStatus };
    switch (currentSlot) {
      case "SUPERVISOR":
        patch.supervisor_approved_at = nowIso;
        patch.supervisor_approver_id = ctx.actor.employeeId;
        break;
      case "PM":
        patch.pm_approved_at = nowIso;
        patch.pm_approver_id = ctx.actor.employeeId;
        break;
      case "OM":
        patch.om_approved_at = nowIso;
        patch.om_approver_id = ctx.actor.employeeId;
        break;
      case "FINANCE":
        patch.finance_approved_at = nowIso;
        patch.finance_approver_id = ctx.actor.employeeId;
        break;
      case "DIRECTOR":
        patch.director_approved_at = nowIso;
        patch.director_approver_id = ctx.actor.employeeId;
        break;
      case null:
        // Should never happen — canonicalCaCanApprove already guarded this.
        break;
    }
    if (nextStatus === "APPROVED") {
      patch.final_approved_at = nowIso;
      patch.final_approver_id = ctx.actor.employeeId;
    }

    const supabase = await createClient();
    const { error: updateErr } = await supabase
      .from("cash_advances")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const { error: logErr } = await supabase
      .from("cash_advance_approval_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        cash_advance_id: input.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.legacyActor.role,
        action,
        from_status: currentStatus,
        to_status: nextStatus,
        comment: input.comment ?? null,
      });
    if (logErr) throw new Error(logErr.message);

    // Load requester so we can push locale-scoped notifications back to the
    // pengaju at every step (Opsi A · progress updates — mirrors Expenses).
    const { data: requester } = await supabase
      .from("employees")
      .select("user_id, id")
      .eq("id", current.requester_employee_id)
      .maybeSingle();

    const { t: tSubmitter } = await translatorFor({
      employeeId: current.requester_employee_id,
      tenantId: ctx.actor.tenantId,
      namespace: "notifications.cashAdvances",
    });
    const { t: tApproverBlast } = await translatorFor({
      employeeId: ctx.actor.employeeId,
      tenantId: ctx.actor.tenantId,
      namespace: "notifications.cashAdvances",
    });
    const slotLabel = (slot: CanonicalApprovalSlot | null): string => {
      switch (slot) {
        case "SUPERVISOR":
          return tSubmitter("roles.SUPERVISOR");
        case "PM":
          return tSubmitter("roles.PROJECT_MANAGER");
        case "FINANCE":
          return tSubmitter("roles.LEAD_FINANCE");
        case "OM":
          return tSubmitter("roles.OPERATIONS_MANAGER");
        case "DIRECTOR":
          return tSubmitter("roles.HEAD_MANAGER");
        default:
          return "";
      }
    };

    if (nextStatus === "APPROVED") {
      // 1. Fan out to Finance so they can disburse.
      await notifyRoles({
        tenantId: ctx.actor.tenantId,
        roles: slotToNotifyRoles("FINANCE"),
        kind: "APPROVAL_APPROVED",
        title: tApproverBlast("approverInbox.titleGeneric", {
          amount: amountIDR.toLocaleString("id-ID"),
        }),
        actionUrl: `/finance/cash-advances/${input.id}`,
      });
      // 2. Terminal receipt to the pengaju.
      if (requester) {
        await notifyUser({
          recipient: { userId: requester.user_id, employeeId: requester.id },
          kind: "APPROVAL_APPROVED",
          title: tSubmitter("submitterApproved.title"),
          body: tSubmitter("submitterApproved.body", {
            amount: amountIDR.toLocaleString("id-ID"),
          }),
          actionUrl: `/finance/cash-advances/${input.id}`,
        });
      }
    } else {
      const nextSlot = slotForCanonicalStatus(nextStatus);
      if (nextSlot) {
        // 1. Next-slot approver inbox.
        await notifyRoles({
          tenantId: ctx.actor.tenantId,
          roles: slotToNotifyRoles(nextSlot),
          kind: "APPROVAL_REQUESTED",
          title: tApproverBlast("approverInbox.titleGeneric", {
            amount: amountIDR.toLocaleString("id-ID"),
          }),
          actionUrl: `/finance/cash-advances/${input.id}`,
        });
        // 2. Progress update to the pengaju — "X approved, now waiting Y".
        if (requester) {
          await notifyUser({
            recipient: {
              userId: requester.user_id,
              employeeId: requester.id,
            },
            kind: "APPROVAL_APPROVED",
            title: tSubmitter("submitterProgress.title", {
              stepRoleLabel: slotLabel(currentSlot),
            }),
            body: tSubmitter("submitterProgress.body", {
              amount: amountIDR.toLocaleString("id-ID"),
              nextRoleLabel: slotLabel(nextSlot),
            }),
            actionUrl: `/finance/cash-advances/${input.id}`,
            payload: {
              cash_advance_id: input.id,
              from_status: currentStatus,
              to_status: nextStatus,
            },
          });
        }
      }
    }

    revalidatePath("/finance/cash-advances");
    revalidatePath(`/finance/cash-advances/${input.id}`);
    revalidatePath("/approvals");
    revalidatePath(`/projects/${current.project_id}`);

    return {
      result: { id: input.id, status: nextStatus },
      auditResourceId: input.id,
      auditOldValues: { status: currentStatus },
      auditNewValues: { status: nextStatus, action, slot: currentSlot },
    };
  },
});

// ---------------------------------------------------------------------------
// REJECT — any pending slot → REJECTED, notify requester.
// ---------------------------------------------------------------------------

export const rejectCanonicalCashAdvanceAction = withCanonicalSecureAction({
  schema: rejectCanonicalCashAdvanceSchema,
  resource: (_input, attrs) => caResourceForType(attrs.caType ?? null),
  action: "reject",
  auditAction: "REJECT",
  auditResourceName: "cash_advances",
  resolveAttributes: async (input, ctx) => {
    const row = await loadCanonicalCa({
      id: input.id,
      tenantId: ctx.actor.tenantId,
    });
    const status = row?.status as CashAdvanceStatus | undefined;
    const slot =
      status && isCanonicalCaStatus(status)
        ? CANONICAL_CA_STATUS_SLOT[status]
        : undefined;
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status,
      ownerEmployeeId: row?.requester_employee_id ?? undefined,
      amountIDR: row ? Number(parseMoneyFromDb(row.amount)) : undefined,
      pendingSlot: slot ?? undefined,
      caType: (row?.ca_type as CashAdvanceType | undefined) ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const current = await loadCanonicalCa({
      id: input.id,
      tenantId: ctx.actor.tenantId,
    });
    if (!current) throw new Error("Cash advance not found.");

    const currentStatus = current.status as CashAdvanceStatus;
    if (!isCanonicalCaStatus(currentStatus)) {
      throw new Error(
        `Cash advance ${input.id} is on the legacy flow — use the legacy actions.`,
      );
    }
    if (
      !canonicalCaCanApprove({
        actorRole: ctx.actor.role,
        current: currentStatus,
      })
    ) {
      throw new Error(
        `Role ${ctx.actor.role} cannot reject status ${currentStatus}.`,
      );
    }

    const supabase = await createClient();
    const nowIso = new Date().toISOString();
    const { error: updateErr } = await supabase
      .from("cash_advances")
      .update({
        status: "REJECTED",
        rejected_at: nowIso,
        rejected_by: ctx.actor.employeeId,
        rejection_reason: input.reason,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const currentSlot = CANONICAL_CA_STATUS_SLOT[currentStatus];
    const action: ApprovalAction =
      currentSlot === "FINANCE" ? "FINANCE_REJECT" : "REJECT";
    const { error: logErr } = await supabase
      .from("cash_advance_approval_logs")
      .insert({
        tenant_id: ctx.actor.tenantId,
        cash_advance_id: input.id,
        actor_employee_id: ctx.actor.employeeId,
        actor_role: ctx.legacyActor.role,
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
      const { t: tSubmitter } = await translatorFor({
        employeeId: current.requester_employee_id,
        tenantId: ctx.actor.tenantId,
        namespace: "notifications.cashAdvances",
      });
      const reason = input.reason.trim();
      await notifyUser({
        recipient: { userId: requester.user_id, employeeId: requester.id },
        kind: "APPROVAL_REJECTED",
        title: tSubmitter("submitterRejected.title"),
        body: reason.length > 0
          ? tSubmitter("submitterRejected.bodyWithReason", { reason })
          : tSubmitter("submitterRejected.bodyGeneric"),
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
      auditNewValues: { status: "REJECTED", reason: input.reason, action },
    };
  },
});

// ---------------------------------------------------------------------------
// CANCEL — requester withdraws their own open request.
// ---------------------------------------------------------------------------

export const cancelCanonicalCashAdvanceAction = withCanonicalSecureAction({
  schema: cancelCanonicalCashAdvanceSchema,
  resource: (_input, attrs) => caResourceForType(attrs.caType ?? null),
  action: "cancel",
  auditAction: "CANCEL",
  auditResourceName: "cash_advances",
  resolveAttributes: async (input, ctx) => {
    const row = await loadCanonicalCa({
      id: input.id,
      tenantId: ctx.actor.tenantId,
    });
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.requester_employee_id ?? undefined,
      caType: (row?.ca_type as CashAdvanceType | undefined) ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const current = await loadCanonicalCa({
      id: input.id,
      tenantId: ctx.actor.tenantId,
    });
    if (!current) throw new Error("Cash advance not found.");
    if (current.requester_employee_id !== ctx.actor.employeeId) {
      throw new Error("Only the requester may cancel this cash advance.");
    }
    const currentStatus = current.status as CashAdvanceStatus;
    if (
      currentStatus === "SETTLED" ||
      currentStatus === "REJECTED" ||
      currentStatus === "CANCELLED"
    ) {
      throw new Error("Cannot cancel a terminal cash advance.");
    }

    const supabase = await createClient();
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
        actor_role: ctx.legacyActor.role,
        action: "CANCEL",
        from_status: currentStatus,
        to_status: "CANCELLED",
        comment: input.reason ?? null,
      });
    if (logErr) throw new Error(logErr.message);

    revalidatePath("/finance/cash-advances");
    revalidatePath(`/finance/cash-advances/${input.id}`);
    revalidatePath("/approvals");
    revalidatePath(`/projects/${current.project_id}`);

    return {
      result: { id: input.id, status: "CANCELLED" as CashAdvanceStatus },
      auditResourceId: input.id,
      auditOldValues: { status: currentStatus },
      auditNewValues: { status: "CANCELLED", reason: input.reason ?? null },
    };
  },
});

// ---------------------------------------------------------------------------
// DISBURSE — Finance releases the funds.
// ---------------------------------------------------------------------------

export const disburseCanonicalCashAdvanceAction = withCanonicalSecureAction({
  schema: disburseCanonicalCashAdvanceSchema,
  resource: (_input, attrs) => caResourceForType(attrs.caType ?? null),
  action: "disburse",
  auditAction: "DISBURSE",
  auditResourceName: "cash_advances",
  resolveAttributes: async (input, ctx) => {
    const row = await loadCanonicalCa({
      id: input.id,
      tenantId: ctx.actor.tenantId,
    });
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status ?? undefined,
      ownerEmployeeId: row?.requester_employee_id ?? undefined,
      caType: (row?.ca_type as CashAdvanceType | undefined) ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const current = await loadCanonicalCa({
      id: input.id,
      tenantId: ctx.actor.tenantId,
    });
    if (!current) throw new Error("Cash advance not found.");
    if (current.status !== "APPROVED") {
      throw new Error("Only APPROVED cash advances can be disbursed.");
    }

    const supabase = await createClient();
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
        actor_role: ctx.legacyActor.role,
        action: "APPROVE",
        from_status: "APPROVED",
        to_status: "DISBURSED",
        comment:
          input.note
            ? `Disbursed · ref ${input.disbursement_ref} · ${input.note}`
            : `Disbursed · ref ${input.disbursement_ref}`,
      });
    if (logErr) throw new Error(logErr.message);

    const { data: requester } = await supabase
      .from("employees")
      .select("user_id, id")
      .eq("id", current.requester_employee_id)
      .maybeSingle();
    if (requester) {
      const { t: tSubmitter } = await translatorFor({
        employeeId: current.requester_employee_id,
        tenantId: ctx.actor.tenantId,
        namespace: "notifications.cashAdvances",
      });
      await notifyUser({
        recipient: { userId: requester.user_id, employeeId: requester.id },
        kind: "CASH_ADVANCE_DISBURSED",
        title: tSubmitter("submitterDisbursed.title"),
        body: tSubmitter("submitterDisbursed.body", {
          ref: input.disbursement_ref,
        }),
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
// SETTLEMENT — owner submits total spent; Finance accepts (settle) or
// returns (reject). Uses the `cash_advance_settlement` canonical resource.
// ---------------------------------------------------------------------------

export const submitCanonicalSettlementAction = withCanonicalSecureAction({
  schema: submitCanonicalSettlementSchema,
  resource: "cash_advance_settlement",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "cash_advance_settlements",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: ca } = await supabase
      .from("cash_advances")
      .select("requester_employee_id, project_id")
      .eq("id", input.cash_advance_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: ca?.project_id ?? undefined,
      ownerEmployeeId: ca?.requester_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: ca, error: readErr } = await supabase
      .from("cash_advances")
      .select("id, amount, requester_employee_id, status, project_id")
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
      roles: slotToNotifyRoles("FINANCE"),
      kind: "APPROVAL_REQUESTED",
      title: "Cash advance settlement submitted",
      actionUrl: `/finance/cash-advances/${input.cash_advance_id}`,
    });

    revalidatePath(`/finance/cash-advances/${input.cash_advance_id}`);
    revalidatePath("/finance/cash-advances");

    return {
      result: {
        id: inserted.id,
        status: inserted.status as CashAdvanceSettlementStatus,
      },
      auditResourceId: inserted.id,
      auditNewValues: {
        cash_advance_id: input.cash_advance_id,
        total_spent: totalSpentDb,
        status: inserted.status,
      },
    };
  },
});

export const acceptCanonicalSettlementAction = withCanonicalSecureAction({
  schema: acceptCanonicalSettlementSchema,
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

    // Hard rule (rules §22, UU KUP audit trail): if the settlement claims
    // any spend, at least one receipt attachment MUST exist so Finance is
    // reviewing against evidence and the row survives a future audit.
    const totalSpentMoney = parseMoneyFromDb(settlement.total_spent);
    if (totalSpentMoney > 0) {
      const { count: attachmentCount, error: countErr } = await supabase
        .from("attachments")
        .select("id", { count: "exact", head: true })
        .eq("resource_type", "cash_advance_settlement")
        .eq("resource_id", settlement.id)
        .eq("tenant_id", ctx.actor.tenantId);
      if (countErr) throw new Error(countErr.message);
      if (!attachmentCount || attachmentCount === 0) {
        throw new Error(
          "Cannot accept settlement without receipts. Return to the submitter to attach nota/struk first.",
        );
      }
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

    // Net settlement: positive means employee refunds, negative means
    // company owes a top-up (matches legacy behaviour).
    const { data: ca } = await supabase
      .from("cash_advances")
      .select("amount, requester_employee_id, project_id, id")
      .eq("id", settlement.cash_advance_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (!ca) throw new Error("Parent cash advance vanished.");

    const advanceMoney = parseMoneyFromDb(ca.amount);
    const spentMoney = parseMoneyFromDb(settlement.total_spent);
    const netRefund = advanceMoney - spentMoney;

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

    // Roll spent into project budget (best effort — kept legacy path).
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
        .update({
          spent_amount: moneyToDbString(newSpent) as unknown as number,
        })
        .eq("project_id", ca.project_id)
        .eq("tenant_id", ctx.actor.tenantId);
    }

    const { data: requester } = await supabase
      .from("employees")
      .select("user_id, id")
      .eq("id", ca.requester_employee_id)
      .maybeSingle();
    if (requester) {
      const { t: tSubmitter } = await translatorFor({
        employeeId: ca.requester_employee_id,
        tenantId: ctx.actor.tenantId,
        namespace: "notifications.cashAdvances",
      });
      await notifyUser({
        recipient: { userId: requester.user_id, employeeId: requester.id },
        kind: "CASH_ADVANCE_SETTLED",
        title: tSubmitter("submitterSettled.title"),
        body: tSubmitter("submitterSettled.body", {
          amount: parseMoneyFromDb(settlement.total_spent).toLocaleString(
            "id-ID",
          ),
        }),
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

export const returnCanonicalSettlementAction = withCanonicalSecureAction({
  schema: returnCanonicalSettlementSchema,
  resource: "cash_advance_settlement",
  action: "reject",
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

    const { data: ca } = await supabase
      .from("cash_advances")
      .select("requester_employee_id")
      .eq("id", settlement.cash_advance_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (ca?.requester_employee_id) {
      const { data: requester } = await supabase
        .from("employees")
        .select("user_id, id")
        .eq("id", ca.requester_employee_id)
        .maybeSingle();
      if (requester) {
        const { t: tSubmitter } = await translatorFor({
          employeeId: ca.requester_employee_id,
          tenantId: ctx.actor.tenantId,
          namespace: "notifications.cashAdvances",
        });
        const reason = input.reason.trim();
        await notifyUser({
          recipient: { userId: requester.user_id, employeeId: requester.id },
          kind: "APPROVAL_REJECTED",
          title: tSubmitter("submitterSettlementReturned.title"),
          body: reason.length > 0
            ? tSubmitter("submitterSettlementReturned.bodyWithReason", {
                reason,
              })
            : tSubmitter("submitterSettlementReturned.bodyGeneric"),
          actionUrl: `/finance/cash-advances/${settlement.cash_advance_id}`,
        });
      }
    }

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
