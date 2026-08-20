import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/server";

import type { ReportBaseFilters, ReportResult, ReportRow } from "../types";

/**
 * Project Portfolio — snapshot of every project the caller can see
 * (RLS enforces scope). Optional date range filter clips to projects
 * whose lifespan overlaps `[from, to]`.
 *
 * Columns (in emitted order):
 *   1. Project code       (project_number ?? code)
 *   2. Project name
 *   3. Client
 *   4. Primary PM         (assignment role = PRIMARY_PM)
 *   5. Status
 *   6. Contract value     (money)
 *   7. Budget planned     (money · aggregated from budgets)
 *   8. Budget realized    (money · aggregated from budget_details)
 *   9. Utilisation %      (realized / planned)
 *  10. Progress %         (project_progress column if present, else 0)
 *  11. Start date
 *  12. End date
 */
export async function runProjectPortfolio(
  filters: ReportBaseFilters,
): Promise<ReportResult> {
  // Uses the service-role client because `projects.contract_value` is
  // REVOKE'd from `authenticated` (migration 0102). The caller has
  // already cleared both PDP `read:report` and the fine-grained
  // `meta.allowedRoles.includes(dbRole)` gate in `runReport()` before
  // this function is invoked, so bypassing RLS here is safe. Rows are
  // still constrained to the caller's tenant via `.eq('tenant_id',
  // filters.tenantId)` — see runner.ts where the tenant is resolved
  // from `requireCurrentEmployee()`.
  const supabase = createServiceRoleClient();

  // Base project select — join client + budgets so we can roll up the
  // portfolio in a single round-trip.
  const query = supabase
    .from("projects")
    .select(
      `id, code, project_number, name, status, contract_value, progress,
       start_date, end_date, updated_at,
       client:client_id(id, name),
       budgets(total_planned_amount,
               budget_details(realized_amount, outstanding_amount))`,
    )
    .eq("tenant_id", filters.tenantId)
    .order("updated_at", { ascending: false });

  // Optional date range: overlap semantics — a project is "in range"
  // when its lifespan intersects [from, to]. Skipped for callers who
  // want the raw snapshot.
  if (filters.from && filters.to) {
    query
      .or(`end_date.gte.${filters.from},end_date.is.null`)
      .lte("start_date", filters.to);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Portfolio query failed: ${error.message}`);

  // Resolve primary PMs in a second round-trip. Doing it separately
  // keeps the main select from ballooning the join graph.
  const projectIds = (data ?? []).map((p) => p.id);
  const { data: pmRows } = await supabase
    .from("project_pm_assignments")
    .select("project_id, pm_employee_id, employee:pm_employee_id(full_name)")
    .in("project_id", projectIds.length > 0 ? projectIds : [""])
    .eq("assignment_role", "PRIMARY_PM")
    .eq("status", "ACTIVE");

  const pmByProject = new Map<string, string>();
  for (const row of pmRows ?? []) {
    const emp = row.employee as { full_name: string } | null;
    if (emp?.full_name) pmByProject.set(row.project_id, emp.full_name);
  }

  let totalContract = 0;
  let totalPlanned = 0;
  let totalRealized = 0;

  const rows: ReportRow[] = (data ?? []).map((p) => {
    const client = p.client as { name: string } | null;
    // Budgets is `[]` (per-project header) — sum planned + realized.
    // budget_details is nested inside each budget row.
    const budgets = (p.budgets ?? []) as Array<{
      total_planned_amount: string | number | null;
      budget_details:
        | Array<{
            realized_amount: string | number | null;
            outstanding_amount: string | number | null;
          }>
        | null;
    }>;
    const planned = budgets.reduce(
      (s, b) => s + Number(b.total_planned_amount ?? 0),
      0,
    );
    const realized = budgets.reduce(
      (s, b) =>
        s +
        (b.budget_details ?? []).reduce(
          (t, d) => t + Number(d.realized_amount ?? 0),
          0,
        ),
      0,
    );
    const contract = Number(p.contract_value ?? 0);
    const utilisation = planned > 0 ? (realized / planned) * 100 : null;

    totalContract += contract;
    totalPlanned += planned;
    totalRealized += realized;

    return [
      p.project_number ?? p.code,
      p.name,
      client?.name ?? "—",
      pmByProject.get(p.id) ?? "—",
      p.status,
      contract,
      planned,
      realized,
      utilisation !== null ? Number(utilisation.toFixed(1)) : null,
      p.progress !== null && p.progress !== undefined
        ? Number(p.progress)
        : 0,
      p.start_date,
      p.end_date,
    ];
  });

  const utilTotal =
    totalPlanned > 0 ? (totalRealized / totalPlanned) * 100 : null;

  const generatedAt = new Date().toISOString();
  const scopePieces: string[] = [`${rows.length} projects`];
  if (filters.from && filters.to) {
    scopePieces.unshift(`${filters.from} → ${filters.to}`);
  }

  return {
    kind: "project-portfolio",
    title: "Project Portfolio",
    generatedAt,
    scopeSummary: scopePieces.join(" · "),
    columns: [
      { key: "code", label: "Code", nowrap: true },
      { key: "name", label: "Project" },
      { key: "client", label: "Client" },
      { key: "pm", label: "PM" },
      { key: "status", label: "Status", format: "status" },
      { key: "contract", label: "Contract", format: "money", align: "right" },
      { key: "planned", label: "Planned", format: "money", align: "right" },
      { key: "realized", label: "Realized", format: "money", align: "right" },
      { key: "utilisation", label: "Util %", format: "percent", align: "right" },
      { key: "progress", label: "Progress %", format: "percent", align: "right" },
      { key: "start_date", label: "Start", format: "date" },
      { key: "end_date", label: "End", format: "date" },
    ],
    rows,
    totals: [
      "TOTAL",
      null,
      null,
      null,
      null,
      totalContract,
      totalPlanned,
      totalRealized,
      utilTotal !== null ? Number(utilTotal.toFixed(1)) : null,
      null,
      null,
      null,
    ],
  };
}
