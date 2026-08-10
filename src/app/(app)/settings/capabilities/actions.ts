"use server";

/**
 * ControlDesk — Server actions for the admin capability-matrix
 * surface at `/settings/capabilities` (rules §3 Fase 2 + Fase 3B).
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
 *
 * Reads (Fase 3B history sheet) go through a lightweight PDP check
 * without audit — audit writes are for mutations only.
 */

import { revalidatePath } from "next/cache";

import { requireCurrentEmployee } from "@/lib/auth/session";
import {
  loadCapabilityHistory,
  type CapabilityHistoryEntry,
} from "@/lib/rbac/capability-audit";
import {
  isCapabilityId,
  type CapabilityId,
} from "@/lib/rbac/capabilities";
import {
  EMPLOYEE_ROLES,
  toCanonicalRole,
  type AnyDbEmployeeRole,
  type EmployeeRole,
} from "@/lib/rbac/roles";
import { authorizeCanonical } from "@/lib/security/pdp-canonical";
import type { ActionResult } from "@/lib/security/action-wrapper";
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

// ---------------------------------------------------------------------------
// READ — capability override history (Fase 3B).
//
// Read-only server action for the history sheet. We deliberately do NOT
// use `withCanonicalSecureAction` here because:
//   1. Reads shouldn't write audit rows (audit is for mutations).
//   2. The wrapper's Zod requirement is heavier than we need for a
//      2-field input; hand-rolled validation is clearer here.
//
// PDP is enforced explicitly via `authorizeCanonical(read,
// capability_override)`, which resolves to the same ADMIN / DIRECTOR
// gate as the write actions (see `pdp-canonical.ts`).
// ---------------------------------------------------------------------------

export type LoadCapabilityHistoryInput = {
  capability_id: string;
  role?: string;
  limit?: number;
};

export async function loadCapabilityHistoryAction(
  input: LoadCapabilityHistoryInput,
): Promise<ActionResult<CapabilityHistoryEntry[]>> {
  // 1. Validate input shape without a Zod round-trip. Anything
  //    outside the catalog / role list is a hard reject — clients
  //    should never send unknown IDs.
  if (!isCapabilityId(input.capability_id)) {
    return {
      ok: false,
      code: "VALIDATION",
      reason: `Unknown capability_id: ${input.capability_id}`,
    };
  }
  const capabilityId: CapabilityId = input.capability_id;

  let role: EmployeeRole | undefined;
  if (input.role !== undefined) {
    if (!(EMPLOYEE_ROLES as readonly string[]).includes(input.role)) {
      return {
        ok: false,
        code: "VALIDATION",
        reason: `Unknown role: ${input.role}`,
      };
    }
    role = input.role as EmployeeRole;
  }

  const limit = input.limit ?? 25;

  // 2. Auth + PDP.
  const employee = await requireCurrentEmployee();
  const canonicalRole = toCanonicalRole(employee.role as AnyDbEmployeeRole);
  const decision = authorizeCanonical({
    actor: {
      userId: employee.user_id,
      employeeId: employee.id,
      role: canonicalRole,
      tenantId: employee.tenant_id,
    },
    action: "read",
    resource: "capability_override",
    attributes: { tenantId: employee.tenant_id },
  });
  if (decision.effect === "DENY") {
    return { ok: false, code: "FORBIDDEN", reason: decision.reason };
  }

  // 3. Fetch.
  try {
    const entries = await loadCapabilityHistory({
      capabilityId,
      role,
      limit,
    });
    return { ok: true, data: entries };
  } catch (err) {
    return {
      ok: false,
      code: "INTERNAL",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
