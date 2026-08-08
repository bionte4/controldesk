import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type {
  AssignmentStatus,
  PmAssignmentRole,
  ProjectMemberRole,
  ProjectStatus,
} from "@/types/database";

/**
 * Data-access helpers for the Assignments module (rules §7).
 *
 * All loaders are wrapped with `React.cache()` so a single RSC render
 * can call them multiple times without duplicate SELECTs, and are
 * tenant-scoped automatically via RLS (no explicit `tenant_id` filter
 * needed on the top-level table; the client's JWT resolves
 * `current_tenant_id()`).
 */

export type AssignmentEmployee = {
  id: string;
  full_name: string;
  role: string;
};

export type AssignmentProject = {
  id: string;
  code: string | null;
  project_number: string | null;
  name: string;
  status: ProjectStatus;
  client_id: string;
};

export type PmAssignmentRow = {
  id: string;
  kind: "pm";
  project: AssignmentProject;
  employee: AssignmentEmployee;
  role: PmAssignmentRole;
  allocation_pct: 100;
  status: AssignmentStatus;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
};

export type MemberAssignmentRow = {
  id: string;
  kind: "member";
  project: AssignmentProject;
  employee: AssignmentEmployee;
  role: ProjectMemberRole;
  allocation_pct: number;
  status: AssignmentStatus;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
};

export type AssignmentRow = PmAssignmentRow | MemberAssignmentRow;

// ---------------------------------------------------------------------------
// Filter shape shared by all loaders.
// ---------------------------------------------------------------------------

export type AssignmentFilter = {
  projectId?: string;
  employeeId?: string;
  role?: string; // "PRIMARY_PM" | "CO_PM" | project_member_role
  status?: AssignmentStatus; // default ACTIVE
};

// ---------------------------------------------------------------------------
// Unified loader — returns both PM and Member assignments, merged.
// ---------------------------------------------------------------------------

export const loadAssignments = cache(async (filter: AssignmentFilter = {}) => {
  const supabase = await createClient();
  const status = filter.status ?? "ACTIVE";

  // 1. PM assignments
  let pmQ = supabase
    .from("project_pm_assignments")
    .select(
      `
      id, status, started_at, ended_at, notes,
      assignment_role,
      project:projects!inner (id, code, project_number, name, status, client_id),
      employee:employees!pm_employee_id (id, full_name, role)
      `,
    )
    .eq("status", status);
  if (filter.projectId) pmQ = pmQ.eq("project_id", filter.projectId);
  if (filter.employeeId) pmQ = pmQ.eq("pm_employee_id", filter.employeeId);
  if (filter.role && (filter.role === "PRIMARY_PM" || filter.role === "CO_PM")) {
    pmQ = pmQ.eq("assignment_role", filter.role);
  } else if (filter.role) {
    // filter is a member role — skip PM query entirely
    pmQ = pmQ.limit(0);
  }
  const { data: pmData, error: pmErr } = await pmQ;
  if (pmErr) throw new Error(pmErr.message);

  // 2. Member (employee) assignments
  let memQ = supabase
    .from("project_employee_assignments")
    .select(
      `
      id, status, started_at, ended_at, notes,
      role,
      allocation_percentage,
      project:projects!inner (id, code, project_number, name, status, client_id),
      employee:employees!employee_id (id, full_name, role)
      `,
    )
    .eq("status", status);
  if (filter.projectId) memQ = memQ.eq("project_id", filter.projectId);
  if (filter.employeeId) memQ = memQ.eq("employee_id", filter.employeeId);
  if (filter.role && filter.role !== "PRIMARY_PM" && filter.role !== "CO_PM") {
    memQ = memQ.eq("role", filter.role as ProjectMemberRole);
  } else if (filter.role) {
    memQ = memQ.limit(0);
  }
  const { data: memData, error: memErr } = await memQ;
  if (memErr) throw new Error(memErr.message);

  const pmRows: PmAssignmentRow[] = (pmData ?? []).map((r) => ({
    id: r.id,
    kind: "pm" as const,
    project: r.project as AssignmentProject,
    employee: r.employee as AssignmentEmployee,
    role: r.assignment_role,
    allocation_pct: 100 as const,
    status: r.status,
    started_at: r.started_at,
    ended_at: r.ended_at,
    notes: r.notes,
  }));

  const memRows: MemberAssignmentRow[] = (memData ?? []).map((r) => ({
    id: r.id,
    kind: "member" as const,
    project: r.project as AssignmentProject,
    employee: r.employee as AssignmentEmployee,
    role: r.role,
    allocation_pct: r.allocation_percentage,
    status: r.status,
    started_at: r.started_at,
    ended_at: r.ended_at,
    notes: r.notes,
  }));

  return { rows: [...pmRows, ...memRows] as AssignmentRow[], pmRows, memRows };
});

// ---------------------------------------------------------------------------
// Grouped views
// ---------------------------------------------------------------------------

export type GroupedByProject = {
  project: AssignmentProject;
  totalActiveAllocationPct: number;
  byRole: Map<string, AssignmentRow[]>;
};

export function groupByProject(rows: AssignmentRow[]): GroupedByProject[] {
  const byProjectId = new Map<string, GroupedByProject>();
  for (const row of rows) {
    const key = row.project.id;
    if (!byProjectId.has(key)) {
      byProjectId.set(key, {
        project: row.project,
        totalActiveAllocationPct: 0,
        byRole: new Map(),
      });
    }
    const bucket = byProjectId.get(key)!;
    if (row.status === "ACTIVE") {
      bucket.totalActiveAllocationPct += row.allocation_pct;
    }
    const bucketRoleRows = bucket.byRole.get(row.role) ?? [];
    bucketRoleRows.push(row);
    bucket.byRole.set(row.role, bucketRoleRows);
  }
  return Array.from(byProjectId.values()).sort((a, b) =>
    (a.project.project_number ?? a.project.code ?? a.project.name).localeCompare(
      b.project.project_number ?? b.project.code ?? b.project.name,
    ),
  );
}

export type GroupedByEmployee = {
  employee: AssignmentEmployee;
  totalActiveAllocationPct: number;
  rows: AssignmentRow[];
};

export function groupByEmployee(rows: AssignmentRow[]): GroupedByEmployee[] {
  const byEmpId = new Map<string, GroupedByEmployee>();
  for (const row of rows) {
    const key = row.employee.id;
    if (!byEmpId.has(key)) {
      byEmpId.set(key, {
        employee: row.employee,
        totalActiveAllocationPct: 0,
        rows: [],
      });
    }
    const bucket = byEmpId.get(key)!;
    if (row.status === "ACTIVE") {
      bucket.totalActiveAllocationPct += row.allocation_pct;
    }
    bucket.rows.push(row);
  }
  return Array.from(byEmpId.values()).sort((a, b) =>
    a.employee.full_name.localeCompare(b.employee.full_name),
  );
}

// ---------------------------------------------------------------------------
// Workload — one row per employee, sourced from the DB view v_employee_workload.
// ---------------------------------------------------------------------------

export type WorkloadRow = {
  employee_id: string;
  full_name: string;
  employee_role: string;
  total_alloc_pct: number;
  remaining_pct: number;
  active_assignments: number;
};

export const loadWorkload = cache(async (): Promise<WorkloadRow[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_employee_workload")
    .select("employee_id, full_name, employee_role, total_alloc_pct, remaining_pct, active_assignments")
    .order("total_alloc_pct", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as WorkloadRow[];
});

// ---------------------------------------------------------------------------
// Dropdown options — projects + employees (tenant-scoped).
// ---------------------------------------------------------------------------

export type ProjectOption = {
  id: string;
  code: string | null;
  project_number: string | null;
  name: string;
};

export const loadProjectOptions = cache(async (): Promise<ProjectOption[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, code, project_number, name")
    .in("status", ["DRAFT", "PLANNING", "ACTIVE", "ON_HOLD"])
    .order("project_number", { ascending: true, nullsFirst: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectOption[];
});

export type EmployeeOption = {
  id: string;
  full_name: string;
  role: string;
  employment_type: string | null;
};

export const loadEmployeeOptions = cache(async (): Promise<EmployeeOption[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .select("id, full_name, role, employment_type")
    .eq("is_active", true)
    .order("full_name", { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as EmployeeOption[];
});
