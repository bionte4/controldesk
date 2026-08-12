import "server-only";

import { cache } from "react";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

import {
  CAPABILITY_CATALOG,
  isCapabilityId,
  type CapabilityId,
} from "./capabilities";
import type { AnyDbEmployeeRole, EmployeeRole } from "./roles";
import { EMPLOYEE_ROLES, roleInGate } from "./roles";

/**
 * Read-only view of a tenant's fully-resolved capability matrix.
 *
 * Constructed once per request via `resolveCapabilitiesFor()` and
 * memoised by `React.cache`, so every RSC / Server Action in that
 * render pays exactly one DB round-trip for the overrides table.
 *
 * Contract:
 *   caps.can("view_budget")               // → boolean (uses caller's role)
 *   caps.canFor("view_budget", "EMPLOYEE") // → boolean (arbitrary role)
 *   caps.rolesFor("view_budget")           // → readonly EmployeeRole[]
 *
 * Prefer `.can()` for page-level gates; `.canFor()` is only useful
 * on `/settings/capabilities` (rendering the checkbox matrix) and
 * unit tests. `.rolesFor()` is intended for the admin matrix UI.
 */
export interface CapabilitySet {
  can(id: CapabilityId): boolean;
  canFor(id: CapabilityId, role: AnyDbEmployeeRole): boolean;
  rolesFor(id: CapabilityId): readonly EmployeeRole[];
  /**
   * Same as `rolesFor` but classifies each role as `default`,
   * `granted-override`, or `revoked-override` so the admin matrix
   * can distinguish "user's setting" from "catalog baseline". Used
   * for the UI colour coding on `/settings/capabilities`.
   */
  matrixFor(id: CapabilityId): ReadonlyMap<EmployeeRole, CapabilityCellState>;
}

/**
 * Per-cell (capability × role) state as seen by the admin matrix
 * UI. `default-*` variants mean "no override in DB, catalog decides".
 */
export type CapabilityCellState =
  | "default-allow"
  | "default-deny"
  | "override-allow"
  | "override-deny";

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type OverrideRow = {
  capability_id: string;
  role: EmployeeRole;
  granted: boolean;
};

/**
 * Load raw overrides for a tenant. Cached per request so parallel
 * consumers (page + sidebar + server actions) don't re-query.
 */
const loadOverridesFor = cache(
  async (tenantId: string): Promise<OverrideRow[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("tenant_capability_overrides")
      .select("capability_id, role, granted")
      .eq("tenant_id", tenantId);
    if (error) {
      // Fail-closed: a broken override read should NOT silently
      // grant every role, but ALSO should not brick the whole app.
      // We log and return an empty override set — every capability
      // falls back to catalog defaults, which is the safer branch.
      // Verified via unit tests in capability-resolver.test.ts.
      console.error("[capability-resolver] override load failed", error);
      return [];
    }
    return (data ?? []).filter((r) =>
      isCapabilityId(r.capability_id),
    ) as OverrideRow[];
  },
);

/**
 * Build the (capability × role) matrix by folding overrides onto the
 * catalog defaults. Kept small so it fits comfortably in React.cache.
 */
function buildMatrix(
  overrides: OverrideRow[],
  callerRole: AnyDbEmployeeRole,
): CapabilitySet {
  // Pre-compute `matrixFor` results so `.can()` and repeated
  // `.canFor()` calls in the same request never re-fold.
  const byCap = new Map<
    CapabilityId,
    { effective: Set<EmployeeRole>; cellState: Map<EmployeeRole, CapabilityCellState> }
  >();

  for (const cap of CAPABILITY_CATALOG) {
    const effective = new Set<EmployeeRole>(cap.defaultRoles);
    const cellState = new Map<EmployeeRole, CapabilityCellState>();
    for (const role of EMPLOYEE_ROLES) {
      cellState.set(
        role,
        (cap.defaultRoles as readonly string[]).includes(role)
          ? "default-allow"
          : "default-deny",
      );
    }
    for (const ov of overrides) {
      if (ov.capability_id !== cap.id) continue;
      if (ov.granted) {
        effective.add(ov.role);
        cellState.set(ov.role, "override-allow");
      } else {
        effective.delete(ov.role);
        cellState.set(ov.role, "override-deny");
      }
    }
    byCap.set(cap.id, { effective, cellState });
  }

  const rolesForImpl = (id: CapabilityId): readonly EmployeeRole[] => {
    const entry = byCap.get(id);
    if (!entry) return [];
    // Preserve `EMPLOYEE_ROLES` ordering for stable UI rendering.
    return EMPLOYEE_ROLES.filter((r) => entry.effective.has(r));
  };

  const canForImpl = (id: CapabilityId, role: AnyDbEmployeeRole): boolean => {
    const roles = rolesForImpl(id);
    // Canonical fold — same one-directional semantics as `roleInGate`
    // in roles.ts. This is critical: without it, a caller signed in
    // as canonical `PM` would fail against a legacy `PROJECT_MANAGER`
    // gate list. See `roleInGate` docstring for the full argument.
    return roleInGate(role, roles);
  };

  const matrixForImpl = (
    id: CapabilityId,
  ): ReadonlyMap<EmployeeRole, CapabilityCellState> => {
    return byCap.get(id)?.cellState ?? new Map();
  };

  return {
    can(id: CapabilityId): boolean {
      return canForImpl(id, callerRole);
    },
    canFor: canForImpl,
    rolesFor: rolesForImpl,
    matrixFor: matrixForImpl,
  };
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Resolve the current caller's capability set. Reads
 * `requireCurrentEmployee()` internally so RSC pages can call it
 * without threading the employee object explicitly. Cached per
 * request so multiple pages / layouts in the same render tree
 * share one DB fetch.
 *
 * Prefer this in page code:
 *
 *   const caps = await resolveCapabilitiesFor();
 *   if (!caps.can("view_budget")) notFound();
 */
export const resolveCapabilitiesFor = cache(
  async (): Promise<CapabilitySet> => {
    const employee = await requireCurrentEmployee();
    const overrides = await loadOverridesFor(employee.tenant_id);
    return buildMatrix(overrides, employee.role as AnyDbEmployeeRole);
  },
);

/**
 * Admin-facing loader — resolves the matrix for `tenantId` without
 * requiring a specific caller role. Used by
 * `/settings/capabilities` to render the full matrix regardless of
 * who's viewing (the page itself is gated by TENANT_ADMIN / GM).
 *
 * The returned `.can()` uses TENANT_ADMIN as the "self" role so
 * calls that hit `.can()` on this instance always return `true` for
 * admin-catalog capabilities — but in practice this instance is
 * only consumed via `.canFor()` / `.rolesFor()` / `.matrixFor()`.
 */
export const resolveCapabilitiesForTenant = cache(
  async (tenantId: string): Promise<CapabilitySet> => {
    const overrides = await loadOverridesFor(tenantId);
    return buildMatrix(overrides, "TENANT_ADMIN");
  },
);
