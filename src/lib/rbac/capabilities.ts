/**
 * ControlDesk — Capability Catalog (rules §3, Fase 2 admin-toggle system).
 *
 * A "capability" is a stable identifier for a permission that gates a
 * specific piece of UI or an entire page — e.g. `view_budget`,
 * `view_employee_directory`, `view_petty_cash`.
 *
 * Prior to Fase 2, capabilities were expressed as inline role lists
 * scattered across `roles.ts` (e.g. `BUDGET_VIEWER_ROLES`) and consumed
 * directly by page guards, sidebar filters, and page components. That
 * worked for a single-tenant demo, but breaks the moment a tenant asks
 * "can we let our Supervisor see budgets?" — we'd have to fork the code
 * or ship a per-tenant deploy.
 *
 * The catalog below centralises those role lists as *defaults*. Per-
 * tenant overrides live in `public.tenant_capability_overrides` (see
 * migration 0081). The runtime `CapabilitySet` (resolved once per
 * request via `resolveCapabilitiesFor()` in `capability-resolver.ts`)
 * layers overrides on top of these defaults and answers the
 * authoritative `can("view_budget", role)` question everywhere else in
 * the app.
 *
 * Design contract:
 *   • Adding a new capability = append an entry here + optionally a
 *     new page/UI gate + i18n key. No migration needed — the overrides
 *     table is schema-less on `capability_id` (arbitrary text).
 *   • Removing a capability = delete the entry AND run a cleanup
 *     migration to purge stale rows from `tenant_capability_overrides`.
 *     Stale rows are inert (ignored by resolver) but leave dead data
 *     around; prefer explicit removal.
 *   • Renaming a capability_id = migrate override rows first, then
 *     rename here. Never rename without a data migration or existing
 *     overrides silently revert to defaults.
 */

import type { EmployeeRole } from "./roles";

/**
 * Canonical capability identifier. Persisted verbatim in
 * `tenant_capability_overrides.capability_id`, so once a value ships
 * you can only rename it via a data migration (see file header).
 */
export type CapabilityId =
  | "view_contract"
  | "view_performance"
  | "view_payroll"
  | "view_budget"
  | "view_employee_directory"
  | "view_petty_cash"
  | "view_upk"
  | "view_client"
  | "view_assignment"
  | "view_handover"
  | "view_insights";

/**
 * UI-facing grouping. The admin matrix at `/settings/capabilities`
 * clusters capabilities by category so admins don't have to scroll
 * through a flat 20-row grid.
 */
export type CapabilityCategory = "finance" | "hr" | "operations" | "strategy";

/**
 * Sensitivity gate for the admin toggle UI. `high` capabilities
 * (payroll, contracts) get an extra "are you sure?" confirmation
 * before a grant is applied to a non-default role; `low` toggles
 * are one-click.
 */
export type CapabilitySensitivity = "low" | "medium" | "high";

export type CapabilityDescriptor = {
  id: CapabilityId;
  category: CapabilityCategory;
  sensitivity: CapabilitySensitivity;
  /**
   * i18n key path under `capabilities.<id>.title` and
   * `capabilities.<id>.description`. Rendered by
   * `/settings/capabilities` and by the Sidebar tooltips.
   */
  titleKey: string;
  descriptionKey: string;
  /**
   * Roles allowed to exercise this capability *before* per-tenant
   * overrides. Sourced from the original `*_VIEWER_ROLES` constants
   * in `roles.ts` — that file re-exports these lists via
   * `defaultRolesFor(capability)` so existing imports keep working
   * during the migration.
   */
  defaultRoles: readonly EmployeeRole[];
};

// ---------------------------------------------------------------------------
// Catalog definition. Order here drives display order in the admin UI.
// ---------------------------------------------------------------------------

const FINANCE_MGMT: readonly EmployeeRole[] = [
  "PROJECT_MANAGER",
  "OPERATIONS_MANAGER",
  "HEAD_MANAGER",
  "GENERAL_MANAGER",
  "LEAD_FINANCE",
  "TENANT_ADMIN",
] as const;

export const CAPABILITY_CATALOG: readonly CapabilityDescriptor[] = [
  {
    id: "view_budget",
    category: "finance",
    sensitivity: "medium",
    titleKey: "capabilities.view_budget.title",
    descriptionKey: "capabilities.view_budget.description",
    defaultRoles: FINANCE_MGMT,
  },
  {
    id: "view_contract",
    category: "finance",
    sensitivity: "high",
    titleKey: "capabilities.view_contract.title",
    descriptionKey: "capabilities.view_contract.description",
    defaultRoles: [
      "LEAD_FINANCE",
      "HEAD_MANAGER",
      "GENERAL_MANAGER",
      "TENANT_ADMIN",
    ] as const,
  },
  {
    id: "view_petty_cash",
    category: "finance",
    sensitivity: "medium",
    titleKey: "capabilities.view_petty_cash.title",
    descriptionKey: "capabilities.view_petty_cash.description",
    defaultRoles: [
      "PETTY_CASH_CUSTODIAN",
      "LEAD_FINANCE",
      "TENANT_ADMIN",
      "GENERAL_MANAGER",
      "HEAD_MANAGER",
      "OPERATIONS_MANAGER",
      "PROJECT_MANAGER",
    ] as const,
  },
  {
    id: "view_payroll",
    category: "hr",
    sensitivity: "high",
    titleKey: "capabilities.view_payroll.title",
    descriptionKey: "capabilities.view_payroll.description",
    defaultRoles: [
      "LEAD_FINANCE",
      "HR_ADMIN",
      "TENANT_ADMIN",
      "GENERAL_MANAGER",
    ] as const,
  },
  {
    id: "view_performance",
    category: "hr",
    sensitivity: "medium",
    titleKey: "capabilities.view_performance.title",
    descriptionKey: "capabilities.view_performance.description",
    defaultRoles: [
      "SUPERVISOR",
      "PROJECT_MANAGER",
      "OPERATIONS_MANAGER",
      "HEAD_MANAGER",
      "GENERAL_MANAGER",
      "HR_ADMIN",
      "TENANT_ADMIN",
    ] as const,
  },
  {
    id: "view_employee_directory",
    category: "hr",
    sensitivity: "medium",
    titleKey: "capabilities.view_employee_directory.title",
    descriptionKey: "capabilities.view_employee_directory.description",
    defaultRoles: [
      "SUPERVISOR",
      "PROJECT_MANAGER",
      "OPERATIONS_MANAGER",
      "HEAD_MANAGER",
      "GENERAL_MANAGER",
      "LEAD_FINANCE",
      "HR_ADMIN",
      "TENANT_ADMIN",
    ] as const,
  },
  {
    id: "view_upk",
    category: "hr",
    sensitivity: "high",
    titleKey: "capabilities.view_upk.title",
    descriptionKey: "capabilities.view_upk.description",
    defaultRoles: [
      "PROJECT_MANAGER",
      "OPERATIONS_MANAGER",
      "HEAD_MANAGER",
      "HR_ADMIN",
      "LEAD_FINANCE",
      "GENERAL_MANAGER",
      "TENANT_ADMIN",
    ] as const,
  },
  {
    id: "view_client",
    category: "operations",
    sensitivity: "medium",
    titleKey: "capabilities.view_client.title",
    descriptionKey: "capabilities.view_client.description",
    defaultRoles: [
      "PROJECT_MANAGER",
      "OPERATIONS_MANAGER",
      "HEAD_MANAGER",
      "GENERAL_MANAGER",
      "LEAD_FINANCE",
      "TENANT_ADMIN",
    ] as const,
  },
  {
    id: "view_assignment",
    category: "operations",
    sensitivity: "low",
    titleKey: "capabilities.view_assignment.title",
    descriptionKey: "capabilities.view_assignment.description",
    defaultRoles: [
      "PROJECT_MANAGER",
      "OPERATIONS_MANAGER",
      "HEAD_MANAGER",
      "GENERAL_MANAGER",
      "HR_ADMIN",
      "TENANT_ADMIN",
    ] as const,
  },
  {
    id: "view_handover",
    category: "operations",
    sensitivity: "medium",
    titleKey: "capabilities.view_handover.title",
    descriptionKey: "capabilities.view_handover.description",
    defaultRoles: [
      "PROJECT_MANAGER",
      "OPERATIONS_MANAGER",
      "HEAD_MANAGER",
      "GENERAL_MANAGER",
      "TENANT_ADMIN",
    ] as const,
  },
  {
    id: "view_insights",
    category: "strategy",
    sensitivity: "medium",
    titleKey: "capabilities.view_insights.title",
    descriptionKey: "capabilities.view_insights.description",
    defaultRoles: [
      "TENANT_ADMIN",
      "GENERAL_MANAGER",
      "HEAD_MANAGER",
      "OPERATIONS_MANAGER",
      "PROJECT_MANAGER",
      "LEAD_FINANCE",
    ] as const,
  },
] as const;

/**
 * All capability IDs as a `readonly string[]` — cheap membership test
 * for validation (server action / API guard) and for iterating the
 * catalog without importing the full descriptor array.
 */
export const CAPABILITY_IDS: readonly CapabilityId[] = CAPABILITY_CATALOG.map(
  (c) => c.id,
) as readonly CapabilityId[];

/**
 * Runtime guard — narrows `unknown` to `CapabilityId`. Used by
 * server actions that accept a `capability_id` string from the
 * admin toggle UI (input coming across the wire is untrusted).
 */
export function isCapabilityId(value: unknown): value is CapabilityId {
  return (
    typeof value === "string" &&
    (CAPABILITY_IDS as readonly string[]).includes(value)
  );
}

/**
 * Convenience lookup — throws in dev if `id` is missing so bad refactors
 * fail loudly rather than silently returning an empty descriptor.
 */
export function getCapability(id: CapabilityId): CapabilityDescriptor {
  const found = CAPABILITY_CATALOG.find((c) => c.id === id);
  if (!found) {
    throw new Error(
      `Unknown capability id: ${id}. Did you forget to add it to CAPABILITY_CATALOG?`,
    );
  }
  return found;
}

/**
 * Default roles for a capability — thin wrapper so call sites can
 * migrate from `BUDGET_VIEWER_ROLES` to
 * `defaultRolesFor("view_budget")` without exposing the descriptor
 * internals.
 */
export function defaultRolesFor(
  id: CapabilityId,
): readonly EmployeeRole[] {
  return getCapability(id).defaultRoles;
}
