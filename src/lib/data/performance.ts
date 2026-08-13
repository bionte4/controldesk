import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * Data-access helpers for the Performance Evaluation module (rules
 * §17). Loaders are wrapped with `React.cache()` so a single RSC
 * render can invoke them multiple times without duplicate SELECTs.
 *
 * All queries are tenant-scoped automatically via RLS — the caller's
 * JWT resolves `current_tenant_id()` server-side.
 */

/**
 * A minimal snapshot of an employee's active project participation
 * plus the project's PRIMARY_PM (used as the default project
 * reviewer). Only ACTIVE rows are returned — completed/ended
 * assignments do not surface as candidates for a new evaluation.
 *
 * NOTE: `primary_pm_id` may be `null` when the project has no
 * PRIMARY_PM assigned yet (rare, but possible for freshly-created
 * projects). The UI must handle that case by asking the SPV to pick
 * a reviewer manually.
 */
export type EmployeeProjectCandidate = {
  project_id: string;
  project_name: string;
  project_number: string | null;
  primary_pm_id: string | null;
  primary_pm_name: string | null;
};

/**
 * Batch loader — returns a map keyed by `employee_id` with the list
 * of the employee's ACTIVE project assignments, each enriched with
 * the project's PRIMARY_PM (if any). Suitable for populating the
 * project-context dropdown on the "New evaluation" sheet when the
 * SPV picks the target employee.
 *
 * Uses two flat queries + an in-memory join because Supabase-js does
 * not support arbitrary post-filter joins (the alternative — an RPC
 * — is not worth introducing for a rarely-hit form).
 */
export const loadEmployeeProjectCandidates = cache(
  async (
    employeeIds: readonly string[],
  ): Promise<Map<string, EmployeeProjectCandidate[]>> => {
    const result = new Map<string, EmployeeProjectCandidate[]>();
    if (employeeIds.length === 0) return result;

    const supabase = await createClient();

    // Load active member assignments for all target employees.
    const { data: peaRows, error: peaErr } = await supabase
      .from("project_employee_assignments")
      .select(
        `
        employee_id,
        project:projects!inner (id, name, project_number)
        `,
      )
      .in("employee_id", employeeIds as string[])
      .eq("status", "ACTIVE");
    if (peaErr) throw new Error(peaErr.message);

    const projectIds = Array.from(
      new Set(
        (peaRows ?? []).map((r) => (r.project as unknown as { id: string }).id),
      ),
    );
    if (projectIds.length === 0) return result;

    // Resolve PRIMARY_PM per project — single query, in-memory join.
    const { data: ppaRows, error: ppaErr } = await supabase
      .from("project_pm_assignments")
      .select(
        `
        project_id,
        employee:employees!pm_employee_id (id, full_name)
        `,
      )
      .in("project_id", projectIds)
      .eq("status", "ACTIVE")
      .eq("assignment_role", "PRIMARY_PM");
    if (ppaErr) throw new Error(ppaErr.message);

    const pmByProject = new Map<
      string,
      { id: string; full_name: string } | null
    >();
    for (const r of ppaRows ?? []) {
      const emp = r.employee as unknown as {
        id: string;
        full_name: string;
      } | null;
      pmByProject.set(r.project_id, emp);
    }

    for (const row of peaRows ?? []) {
      const proj = row.project as unknown as {
        id: string;
        name: string;
        project_number: string | null;
      };
      const pm = pmByProject.get(proj.id) ?? null;
      const list = result.get(row.employee_id) ?? [];
      list.push({
        project_id: proj.id,
        project_name: proj.name,
        project_number: proj.project_number,
        primary_pm_id: pm?.id ?? null,
        primary_pm_name: pm?.full_name ?? null,
      });
      result.set(row.employee_id, list);
    }

    return result;
  },
);

// NOTE: `assertEmployeeAssignedToProject()` lives in
// `src/lib/data/assignments.ts` — the more general home for
// assignment-based guards. Import from there:
//
//   import { assertEmployeeAssignedToProject } from "@/lib/data/assignments";
