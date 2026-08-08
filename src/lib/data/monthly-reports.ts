import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { MonthlyReportSectionKind } from "@/lib/validation/monthly-report";

/**
 * Pre-computed snapshot of a project's month — used to seed the six
 * default sections when a SPV starts a new report (rules §26).
 *
 * All values come from tables + views that already exist:
 *   - `timesheets`         → hours worked / overtime per day, per project
 *   - `project_milestones` → completed vs. active milestones
 *   - `project_expenses`   → approved cash outflows for the month
 *
 * The result lands verbatim into `monthly_report_sections.metrics`
 * (jsonb) so we keep it compact + JSON-friendly.
 */
export type MonthlySnapshot = {
  hoursLogged: {
    total: number;
    overtime: number;
    perEmployee: Array<{ employee_id: string; full_name: string; hours: number }>;
  };
  milestones: {
    completedCount: number;
    activeCount: number;
    completed: Array<{
      id: string;
      name: string;
      completed_at: string | null;
    }>;
  };
  costs: {
    approvedIdr: number;
    approvedCount: number;
  };
};

/** ISO month bounds — `[start, end)` half-open, expressed as `YYYY-MM-DD`. */
function monthBounds(periodMonth: string): { start: string; end: string } {
  const [y, m] = periodMonth.split("-").map((v) => Number(v));
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/**
 * Aggregate hours + milestones + expenses for the given project in
 * the given calendar month. Returns a compact snapshot suitable for
 * rendering directly in a form or storing as JSON metrics.
 */
export async function computeMonthlySnapshot(input: {
  projectId: string;
  periodMonth: string;
}): Promise<MonthlySnapshot> {
  const supabase = await createClient();
  const { start, end } = monthBounds(input.periodMonth);

  // Run all three lookups in parallel — they're independent.
  const [tsRes, msRes, exRes] = await Promise.all([
    supabase
      .from("timesheets")
      .select("hours_worked, hours_overtime, employee_id")
      .eq("project_id", input.projectId)
      .gte("work_date", start)
      .lt("work_date", end),
    supabase
      .from("project_milestones")
      .select("id, name, status, actual_end_date")
      .eq("project_id", input.projectId),
    supabase
      .from("project_expenses")
      .select("id, amount, status, incurred_on")
      .eq("project_id", input.projectId)
      .gte("incurred_on", start)
      .lt("incurred_on", end),
  ]);

  // Hours — resolve employee names in a second, small round-trip.
  const timesheetRows = (tsRes.data ?? []) as Array<{
    hours_worked: string | number;
    hours_overtime: string | number;
    employee_id: string;
  }>;
  const perEmployeeMap = new Map<string, { hours: number }>();
  let totalHours = 0;
  let overtimeHours = 0;
  for (const row of timesheetRows) {
    const w = Number(row.hours_worked ?? 0);
    const o = Number(row.hours_overtime ?? 0);
    totalHours += w;
    overtimeHours += o;
    const cur = perEmployeeMap.get(row.employee_id) ?? { hours: 0 };
    cur.hours += w;
    perEmployeeMap.set(row.employee_id, cur);
  }
  const employeeIds = Array.from(perEmployeeMap.keys());
  const empNames = new Map<string, string>();
  if (employeeIds.length > 0) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, full_name")
      .in("id", employeeIds);
    for (const e of (emps ?? []) as Array<{ id: string; full_name: string }>) {
      empNames.set(e.id, e.full_name);
    }
  }
  const perEmployee = Array.from(perEmployeeMap.entries())
    .map(([id, v]) => ({
      employee_id: id,
      full_name: empNames.get(id) ?? id.slice(0, 8),
      hours: Math.round(v.hours * 100) / 100,
    }))
    .sort((a, b) => b.hours - a.hours);

  // Milestones completed *in* this month.
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const milestoneRows = (msRes.data ?? []) as Array<{
    id: string;
    name: string;
    status: string;
    actual_end_date: string | null;
  }>;
  const completed = milestoneRows
    .filter((m) => {
      if (m.status !== "DONE") return false;
      if (!m.actual_end_date) return false;
      const t = new Date(m.actual_end_date).getTime();
      return t >= startMs && t < endMs;
    })
    .map((m) => ({
      id: m.id,
      name: m.name,
      completed_at: m.actual_end_date,
    }));
  const activeCount = milestoneRows.filter(
    (m) => m.status === "IN_PROGRESS" || m.status === "PLANNED",
  ).length;

  // Costs — sum APPROVED expenses.
  const expenseRows = (exRes.data ?? []) as Array<{
    amount: string | number;
    status: string;
  }>;
  let approvedIdr = 0;
  let approvedCount = 0;
  for (const ex of expenseRows) {
    if (ex.status === "APPROVED") {
      approvedIdr += Number(ex.amount ?? 0);
      approvedCount += 1;
    }
  }

  return {
    hoursLogged: {
      total: Math.round(totalHours * 100) / 100,
      overtime: Math.round(overtimeHours * 100) / 100,
      perEmployee,
    },
    milestones: {
      completedCount: completed.length,
      activeCount,
      completed,
    },
    costs: {
      approvedIdr,
      approvedCount,
    },
  };
}

/**
 * Generate default section drafts from a snapshot. Section content
 * strings are intentionally terse — SPV expands them before submit.
 */
export function defaultSectionDrafts(snapshot: MonthlySnapshot): Array<{
  kind: MonthlyReportSectionKind;
  content: string;
  metrics: Record<string, unknown>;
}> {
  return [
    { kind: "EXECUTIVE_SUMMARY", content: "", metrics: {} },
    {
      kind: "MILESTONE_PROGRESS",
      content:
        snapshot.milestones.completedCount > 0
          ? `${snapshot.milestones.completedCount} milestone(s) completed this month.`
          : "No milestones completed this month.",
      metrics: {
        completedCount: snapshot.milestones.completedCount,
        activeCount: snapshot.milestones.activeCount,
        completed: snapshot.milestones.completed,
      },
    },
    {
      kind: "HOURS_LOGGED",
      content: `${snapshot.hoursLogged.total} total hours (${snapshot.hoursLogged.overtime} overtime).`,
      metrics: snapshot.hoursLogged,
    },
    {
      kind: "COSTS_INCURRED",
      content:
        snapshot.costs.approvedCount > 0
          ? `${snapshot.costs.approvedCount} approved expense(s), IDR ${snapshot.costs.approvedIdr.toLocaleString("id-ID")}.`
          : "No approved expenses this month.",
      metrics: snapshot.costs,
    },
    { kind: "BLOCKERS", content: "", metrics: {} },
    { kind: "NEXT_MONTH_PLAN", content: "", metrics: {} },
  ];
}
