"use server";

/**
 * ControlDesk — Server actions for the admin approval-thresholds CRUD
 * surface (Option B, rules §9).
 *
 * All mutations go through `withCanonicalSecureAction` gated by the
 * `approval_threshold` PDP resource in `src/lib/security/pdp-canonical.ts`.
 * RLS on `public.approval_thresholds` (migration 0024) enforces the same
 * ADMIN-or-DIRECTOR write policy at the DB layer.
 */

import { revalidatePath } from "next/cache";

import { withCanonicalSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import {
  resetApprovalThresholdSchema,
  upsertApprovalThresholdSchema,
} from "@/lib/validation/approval-thresholds";

const ADMIN_PAGE = "/settings/approval-thresholds";

// ---------------------------------------------------------------------------
// UPSERT — write / update a single (tenant, kind) row.
// ---------------------------------------------------------------------------

export const upsertApprovalThresholdAction = withCanonicalSecureAction({
  schema: upsertApprovalThresholdSchema,
  resource: "approval_threshold",
  // Insert-or-update mapped to a single `update` verb — PDP treats both
  // as the "tune thresholds" capability (ADMIN + DIRECTOR).
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "approval_thresholds",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    // Load prior row so audit log can carry old_values.
    const { data: prior } = await supabase
      .from("approval_thresholds")
      .select(
        "supervisor_threshold, pm_threshold, om_threshold, director_threshold, petty_auto_approve_below, petty_receipt_required_above, petty_hard_ceiling, settlement_sla_days, notes",
      )
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("kind", input.kind)
      .maybeSingle();

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("approval_thresholds")
      .upsert(
        {
          tenant_id: ctx.actor.tenantId,
          kind: input.kind,
          supervisor_threshold: input.supervisor_threshold ?? null,
          pm_threshold: input.pm_threshold ?? null,
          om_threshold: input.om_threshold ?? null,
          director_threshold: input.director_threshold ?? null,
          petty_auto_approve_below: input.petty_auto_approve_below ?? null,
          petty_receipt_required_above:
            input.petty_receipt_required_above ?? null,
          petty_hard_ceiling: input.petty_hard_ceiling ?? null,
          settlement_sla_days: input.settlement_sla_days ?? null,
          notes: input.notes ?? null,
          updated_by: ctx.actor.employeeId,
          updated_at: nowIso,
        },
        { onConflict: "tenant_id,kind" },
      )
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(error?.message ?? "Failed to save threshold override.");
    }

    revalidatePath(ADMIN_PAGE);
    // Approval chain previews are RSC-side — bust the tenant-scoped
    // caches so the next render picks up the new values.
    revalidatePath("/finance/expenses");
    revalidatePath("/finance/budgets");
    revalidatePath("/finance/cash-advances");
    revalidatePath("/finance/budget-requests");

    return {
      result: { id: data.id, kind: input.kind },
      auditResourceId: data.id,
      auditOldValues: prior ?? null,
      auditNewValues: {
        kind: input.kind,
        supervisor_threshold: input.supervisor_threshold ?? null,
        pm_threshold: input.pm_threshold ?? null,
        om_threshold: input.om_threshold ?? null,
        director_threshold: input.director_threshold ?? null,
        petty_auto_approve_below: input.petty_auto_approve_below ?? null,
        petty_receipt_required_above:
          input.petty_receipt_required_above ?? null,
        petty_hard_ceiling: input.petty_hard_ceiling ?? null,
        settlement_sla_days: input.settlement_sla_days ?? null,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// RESET — delete the override row for a (tenant, kind), reverting to
// `APPROVAL_CONFIG` defaults on the next `resolveThresholds()` read.
// ---------------------------------------------------------------------------

export const resetApprovalThresholdAction = withCanonicalSecureAction({
  schema: resetApprovalThresholdSchema,
  resource: "approval_threshold",
  action: "delete",
  auditAction: "DELETE",
  auditResourceName: "approval_thresholds",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: prior } = await supabase
      .from("approval_thresholds")
      .select(
        "id, supervisor_threshold, pm_threshold, om_threshold, director_threshold, petty_auto_approve_below, petty_receipt_required_above, petty_hard_ceiling, settlement_sla_days",
      )
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("kind", input.kind)
      .maybeSingle();

    if (!prior) {
      // Nothing to delete — treat as no-op success so the caller doesn't
      // have to differentiate "reset" from "already default".
      return {
        result: { kind: input.kind, cleared: false },
        auditResourceId: input.kind,
        auditNewValues: { kind: input.kind, cleared: false },
      };
    }

    const { error } = await supabase
      .from("approval_thresholds")
      .delete()
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("kind", input.kind);
    if (error) throw new Error(error.message);

    revalidatePath(ADMIN_PAGE);
    revalidatePath("/finance/expenses");
    revalidatePath("/finance/budgets");
    revalidatePath("/finance/cash-advances");
    revalidatePath("/finance/budget-requests");

    return {
      result: { kind: input.kind, cleared: true },
      auditResourceId: prior.id,
      auditOldValues: prior,
      auditNewValues: { kind: input.kind, cleared: true },
    };
  },
});
