import { z } from "zod";

import { CAPABILITY_IDS, type CapabilityId } from "@/lib/rbac/capabilities";
import { EMPLOYEE_ROLES, type EmployeeRole } from "@/lib/rbac/roles";

/**
 * Schema for the "toggle a single (capability, role) cell" server
 * action. Both `capability_id` and `role` are validated against the
 * catalog / DB enum so the wire input can never smuggle in an
 * unknown value that would silently persist into
 * `tenant_capability_overrides`.
 *
 * `granted` is the effective bit we store:
 *   • `true`  → row exists with granted = true  (explicit ALLOW)
 *   • `false` → row exists with granted = false (explicit DENY)
 *   • no row  → resolver falls back to catalog default
 *
 * The admin UI translates a checkbox's 3-state (`override-allow`,
 * `override-deny`, or `default-*`) to either an upsert (allow / deny)
 * or a call to `resetCapabilityOverrideAction` (see below) which
 * deletes the row entirely.
 */
export const upsertCapabilityOverrideSchema = z.object({
  capability_id: z.enum(
    [...CAPABILITY_IDS] as [CapabilityId, ...CapabilityId[]],
  ),
  role: z.enum([...EMPLOYEE_ROLES] as [EmployeeRole, ...EmployeeRole[]]),
  granted: z.boolean(),
});

export type UpsertCapabilityOverrideInput = z.infer<
  typeof upsertCapabilityOverrideSchema
>;

/**
 * "Reset this cell back to catalog default" — deletes the row from
 * `tenant_capability_overrides` if one exists, no-op otherwise.
 */
export const resetCapabilityOverrideSchema = z.object({
  capability_id: z.enum(
    [...CAPABILITY_IDS] as [CapabilityId, ...CapabilityId[]],
  ),
  role: z.enum([...EMPLOYEE_ROLES] as [EmployeeRole, ...EmployeeRole[]]),
});

export type ResetCapabilityOverrideInput = z.infer<
  typeof resetCapabilityOverrideSchema
>;

/**
 * "Reset entire capability" — deletes all overrides for a given
 * capability_id in the tenant, reverting every role to defaults.
 * Used by the "Reset this capability" button next to each row in
 * the matrix UI.
 */
export const resetCapabilitySchema = z.object({
  capability_id: z.enum(
    [...CAPABILITY_IDS] as [CapabilityId, ...CapabilityId[]],
  ),
});

export type ResetCapabilityInput = z.infer<typeof resetCapabilitySchema>;
