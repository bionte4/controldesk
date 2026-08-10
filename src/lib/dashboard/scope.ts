import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";

/**
 * Dashboard visibility scope (rules §3 ABAC, rules §6 role hierarchy).
 *
 * Fixes the audit finding where every role — including a plain
 * `EMPLOYEE` field technician — saw tenant-wide KPI aggregates on
 * `/dashboard` because the Server Actions in `dashboard/actions.ts`
 * only relied on RLS `tenant_id` scoping. Personal / project-level
 * scoping is a policy decision that must be enforced in the app
 * layer as well, so this helper is the single source of truth.
 *
 * Three shapes:
 *   - `org`       — see everything in the tenant (executives,
 *                    Finance leads, HR admin). No project filter.
 *   - `portfolio` — see all projects handled by PMs that report,
 *                    directly or transitively, to the current
 *                    employee (Head Manager, Operations Manager).
 *   - `assigned`  — see only projects the current employee is
 *                    explicitly assigned to via
 *                    `project_pm_assignments` or
 *                    `project_employee_assignments` (PM,
 *                    Supervisor, Employee, Petty-Cash Custodian).
 *
 * The DB role string is matched *before* canonical folding so we
 * can keep `HEAD_MANAGER` in the portfolio bucket even though it
 * folds to canonical `DIRECTOR` (which is org-scoped) — mirrors
 * the reports/registry decision documented in
 * `src/lib/rbac/roles.ts`.
 */

export type DashboardScopeKind = "org" | "portfolio" | "assigned";

export type DashboardScope =
  | { kind: "org" }
  | {
      kind: "portfolio" | "assigned";
      projectIds: string[];
      /**
       * `true` when the caller has some scoped access defined but
       * no active project assignment exists yet. Callers should
       * short-circuit their aggregate queries to avoid emitting
       * `.in("project_id", [])` which Supabase interprets as "no
       * filter" and would leak tenant-wide rows.
       */
      empty: boolean;
    };

/**
 * DB `employees.role` values whose dashboards must NOT be scoped
 * by project assignment. Uses raw DB strings (both legacy and
 * canonical) rather than canonical fold because `HEAD_MANAGER`
 * folds to `DIRECTOR` canonical yet is a portfolio role, not org.
 */
const ORG_DB_ROLES: readonly AnyDbEmployeeRole[] = [
  "TENANT_ADMIN",
  "ADMIN",
  "GENERAL_MANAGER",
  "DIRECTOR",
  "LEAD_FINANCE",
  "FINANCE",
  "HR_ADMIN",
];

const PORTFOLIO_DB_ROLES: readonly AnyDbEmployeeRole[] = [
  "HEAD_MANAGER",
  "OPERATIONS_MANAGER",
  "OM",
];

/**
 * Pure classifier. Extracted so tests can pin the role→kind
 * mapping without hitting Supabase.
 */
export function classifyDashboardScope(
  role: AnyDbEmployeeRole,
): DashboardScopeKind {
  if ((ORG_DB_ROLES as readonly string[]).includes(role)) return "org";
  if ((PORTFOLIO_DB_ROLES as readonly string[]).includes(role))
    return "portfolio";
  return "assigned";
}

// ---------------------------------------------------------------------------
// Assignment resolvers — thin wrappers over `project_pm_assignments`
// and `project_employee_assignments`. Both loaders honour tenant RLS
// implicitly via the caller's Supabase session.
// ---------------------------------------------------------------------------

async function loadAssignedProjectIds(employeeId: string): Promise<string[]> {
  const supabase = await createClient();
  const [pmRes, memRes] = await Promise.all([
    supabase
      .from("project_pm_assignments")
      .select("project_id")
      .eq("pm_employee_id", employeeId)
      .eq("status", "ACTIVE"),
    supabase
      .from("project_employee_assignments")
      .select("project_id")
      .eq("employee_id", employeeId)
      .eq("status", "ACTIVE"),
  ]);
  const ids = new Set<string>();
  for (const row of (pmRes.data ?? []) as { project_id: string }[]) {
    ids.add(row.project_id);
  }
  for (const row of (memRes.data ?? []) as { project_id: string }[]) {
    ids.add(row.project_id);
  }
  return [...ids];
}

/**
 * BFS descent through `employees.reports_to_employee_id` to gather
 * the transitive set of employees reporting (directly or via any
 * number of hops) to `rootEmployeeId`. Depth is bounded by the
 * organisational chart height (typically 4–6), so the loop
 * terminates quickly. Root is included in the return set.
 */
async function collectSubordinateIds(
  rootEmployeeId: string,
): Promise<string[]> {
  const supabase = await createClient();
  const seen = new Set<string>([rootEmployeeId]);
  let frontier: string[] = [rootEmployeeId];
  // Hard safety cap in case of accidental cycles (constraint prevents
  // self-report but a longer cycle via bad data is theoretically
  // possible — bail out after 8 hops).
  for (let depth = 0; depth < 8 && frontier.length > 0; depth += 1) {
    const { data } = await supabase
      .from("employees")
      .select("id")
      .in("reports_to_employee_id", frontier);
    const next: string[] = [];
    for (const row of (data ?? []) as { id: string }[]) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        next.push(row.id);
      }
    }
    frontier = next;
  }
  return [...seen];
}

async function loadPortfolioProjectIds(
  employeeId: string,
): Promise<string[]> {
  const supabase = await createClient();
  const employeeIds = await collectSubordinateIds(employeeId);
  if (employeeIds.length === 0) return [];

  // Chunk to keep the `.in()` payload under Supabase's practical
  // limit. In real-world tenants employeeIds is small enough to
  // fit in one batch, but be defensive.
  const chunks: string[][] = [];
  const CHUNK = 500;
  for (let i = 0; i < employeeIds.length; i += CHUNK) {
    chunks.push(employeeIds.slice(i, i + CHUNK));
  }

  const projectIds = new Set<string>();
  for (const chunk of chunks) {
    const [pmRes, memRes] = await Promise.all([
      supabase
        .from("project_pm_assignments")
        .select("project_id")
        .in("pm_employee_id", chunk)
        .eq("status", "ACTIVE"),
      supabase
        .from("project_employee_assignments")
        .select("project_id")
        .in("employee_id", chunk)
        .eq("status", "ACTIVE"),
    ]);
    for (const row of (pmRes.data ?? []) as { project_id: string }[]) {
      projectIds.add(row.project_id);
    }
    for (const row of (memRes.data ?? []) as { project_id: string }[]) {
      projectIds.add(row.project_id);
    }
  }
  return [...projectIds];
}

// ---------------------------------------------------------------------------
// Public entry point — memoised per request so a page that calls
// `getDashboardMetrics()` and `getPortfolioSnapshot()` in parallel
// only pays for the assignment lookup once.
// ---------------------------------------------------------------------------

export const resolveDashboardScope = cache(
  async (
    employee: { id: string; role: AnyDbEmployeeRole },
  ): Promise<DashboardScope> => {
    const kind = classifyDashboardScope(employee.role);
    if (kind === "org") return { kind: "org" };

    const projectIds =
      kind === "portfolio"
        ? await loadPortfolioProjectIds(employee.id)
        : await loadAssignedProjectIds(employee.id);

    return {
      kind,
      projectIds,
      empty: projectIds.length === 0,
    };
  },
);

/**
 * Convenience predicate — `true` when the caller is entitled to
 * see aggregate approval queues that live under a different
 * user's name (e.g. as an approver on other people's expenses).
 * Employees, PCC and Field-Ops-only supervisors default to
 * seeing only *their own* submissions.
 */
export function isApproverRole(role: AnyDbEmployeeRole): boolean {
  const APPROVER_DB_ROLES: readonly AnyDbEmployeeRole[] = [
    "TENANT_ADMIN",
    "ADMIN",
    "GENERAL_MANAGER",
    "DIRECTOR",
    "HEAD_MANAGER",
    "OPERATIONS_MANAGER",
    "OM",
    "PROJECT_MANAGER",
    "PM",
    "LEAD_FINANCE",
    "FINANCE",
    "HR_ADMIN",
    "SUPERVISOR",
  ];
  return (APPROVER_DB_ROLES as readonly string[]).includes(role);
}
