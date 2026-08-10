"use server";

/**
 * ControlDesk — Server actions for the admin capability-matrix
 * surface at `/settings/capabilities` (rules §3 Fase 2).
 *
 * All mutations go through `withCanonicalSecureAction` gated by
 * the `capability_override` PDP resource. RLS on
 * `tenant_capability_overrides` (migration 0081) enforces the same
 * ADMIN / DIRECTOR write policy at the DB layer.
 *
 * Every write revalidates a small set of paths so the sidebar and
 * page redirect guards see the new capability set on the very next
 * navigation:
 *   • `/settings/capabilities`  — the matrix reloads.
 *   • `/`                       — layout re-computes `filterNavForCaller`.
 *   • the specific page for the toggled capability (best-effort;
 *     the layout revalidation already covers every downstream
 *     RSC because `resolveCapabilitiesFor()` is per-request cached).
 */

import { revalidatePath } from "next/cache";

import { withCanonicalSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import {
  resetCapabilityOverrideSchema,
  resetCapabilitySchema,
  upsertCapabilityOverrideSchema,
} from "@/lib/validation/capabilities";

const ADMIN_PAGE = "/settings/capabilities";

/**
 * Force every RSC in `(app)/*` to re-run so the sidebar + page
 * guards pick up the new matrix on the very next paint. Cheap
 * because the layout is a thin shell around `React.cache`; the
 * per-request memoisation still saves us the DB round-trip for
 * every page in a single render.
 */
function revalidateEverything() {
  revalidatePath(ADMIN_PAGE);
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// UPSERT — grant or revoke a single (capability, role) cell.
// ---------------------------------------------------------------------------

export const upsertCapabilityOverrideAction = withCanonicalSecureAction({
  schema: upsertCapabilityOverrideSchema,
  resource: "capability_override",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "tenant_capability_overrides",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    // Load prior state so the audit log carries the delta.
    const { data: prior } = await supabase
      .from("tenant_capability_overrides")
      .select("id, granted")
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("capability_id", input.capability_id)
      .eq("role", input.role)
      .maybeSingle();

    const { data, error } = await supabase
      .from("tenant_capability_overrides")
      .upsert(
        {
          tenant_id: ctx.actor.tenantId,
          capability_id: input.capability_id,
          role: input.role,
          granted: input.granted,
          updated_by: ctx.actor.employeeId,
        },
        { onConflict: "tenant_id,capability_id,role" },
      )
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(
        error?.message ?? "Failed to save capability override.",
      );
    }

    revalidateEverything();

    return {
      result: {
        id: data.id,
        capability_id: input.capability_id,
        role: input.role,
        granted: input.granted,
      },
      auditResourceId: data.id,
      auditOldValues: prior ?? null,
      auditNewValues: {
        capability_id: input.capability_id,
        role: input.role,
        granted: input.granted,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// RESET single cell — delete a single override row.
// ---------------------------------------------------------------------------

export const resetCapabilityOverrideAction = withCanonicalSecureAction({
  schema: resetCapabilityOverrideSchema,
  resource: "capability_override",
  action: "delete",
  auditAction: "DELETE",
  auditResourceName: "tenant_capability_overrides",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: prior } = await supabase
      .from("tenant_capability_overrides")
      .select("id, granted")
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("capability_id", input.capability_id)
      .eq("role", input.role)
      .maybeSingle();

    if (!prior) {
      // Nothing to delete — the cell is already at catalog default.
      return {
        result: {
          capability_id: input.capability_id,
          role: input.role,
          cleared: false,
        },
        auditResourceId: `${input.capability_id}:${input.role}`,
        auditNewValues: { cleared: false },
      };
    }

    const { error } = await supabase
      .from("tenant_capability_overrides")
      .delete()
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("capability_id", input.capability_id)
      .eq("role", input.role);
    if (error) throw new Error(error.message);

    revalidateEverything();

    return {
      result: {
        capability_id: input.capability_id,
        role: input.role,
        cleared: true,
      },
      auditResourceId: prior.id,
      auditOldValues: prior,
      auditNewValues: {
        capability_id: input.capability_id,
        role: input.role,
        cleared: true,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// RESET entire capability — delete every override row for one
// capability_id in the tenant, reverting all roles to defaults.
// ---------------------------------------------------------------------------

export const resetCapabilityAction = withCanonicalSecureAction({
  schema: resetCapabilitySchema,
  resource: "capability_override",
  action: "delete",
  auditAction: "DELETE",
  auditResourceName: "tenant_capability_overrides",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: prior } = await supabase
      .from("tenant_capability_overrides")
      .select("id, role, granted")
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("capability_id", input.capability_id);

    if (!prior || prior.length === 0) {
      return {
        result: {
          capability_id: input.capability_id,
          cleared: 0,
        },
        auditResourceId: input.capability_id,
        auditNewValues: { cleared: 0 },
      };
    }

    const { error } = await supabase
      .from("tenant_capability_overrides")
      .delete()
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("capability_id", input.capability_id);
    if (error) throw new Error(error.message);

    revalidateEverything();

    return {
      result: {
        capability_id: input.capability_id,
        cleared: prior.length,
      },
      auditResourceId: input.capability_id,
      auditOldValues: { rows: prior },
      auditNewValues: { cleared: prior.length },
    };
  },
});
