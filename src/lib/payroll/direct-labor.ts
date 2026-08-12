/**
 * ControlDesk — Project-level Direct Labor Cost aggregation (rules §14).
 *
 * Closes the GAS §27 payroll loop: given a set of APPROVED timesheet rows
 * (either individually approved or attached to an APPROVED weekly packet),
 * plus each employee's `hourly_rate`, compute:
 *
 *   direct_labor_cost = Σ (hours_worked × hourly_rate)
 *                     + Σ (hours_overtime × hourly_rate × OVERTIME_MULTIPLIER)
 *
 * Result includes per-employee breakdowns so the UI can render a table and
 * mark rows sourced from weekly packets ("via weekly") vs. legacy per-day
 * approvals ("daily-only") — this gives BPO managers real-time visibility
 * of gross margin.
 *
 * Pure module — no DB access. Callers pass the joined shape.
 */

import { OVERTIME_MULTIPLIER } from "./compute";

// ---------------------------------------------------------------------------
// Input types — deliberately narrow so callers can synthesise them from any
// join query. Numeric fields are already coerced to `number` (Postgres
// `numeric` values arrive as strings and MUST be `Number()`-ed at the query
// boundary).
// ---------------------------------------------------------------------------

export type DlcTimesheetInput = {
  employee_id: string;
  project_id: string | null;
  hours_worked: number;
  hours_overtime: number;
  /**
   * Whether the row was approved as part of a weekly packet (GAS §27) vs.
   * per-day approval (legacy path). Used only for provenance reporting.
   */
  approved_via_weekly: boolean;
};

export type DlcEmployeeInput = {
  id: string;
  full_name: string;
  hourly_rate: number;
};

// ---------------------------------------------------------------------------
// Output types.
// ---------------------------------------------------------------------------

export type DlcEmployeeRow = {
  employee_id: string;
  full_name: string;
  hourly_rate: number;
  hours_worked: number;
  hours_overtime: number;
  base_cost: number;
  overtime_cost: number;
  total_cost: number;
  /** Provenance — how many hours came from an approved weekly packet. */
  weekly_hours: number;
  daily_only_hours: number;
};

export type DlcAggregateOutput = {
  total_cost: number;
  base_cost: number;
  overtime_cost: number;
  total_hours: number;
  total_overtime: number;
  employees: DlcEmployeeRow[];
  provenance: {
    weekly_hours: number;
    daily_only_hours: number;
    weekly_share_pct: number;
  };
};

// ---------------------------------------------------------------------------
// Aggregation.
// ---------------------------------------------------------------------------

/**
 * Aggregate direct labor cost across a set of approved timesheet rows.
 *
 * `timesheets` MUST all be already-approved rows for the project window the
 * caller cares about — this function does NOT filter by status or project;
 * callers are expected to have narrowed at the query layer.
 */
export function aggregateDirectLaborCost(input: {
  timesheets: readonly DlcTimesheetInput[];
  employees: readonly DlcEmployeeInput[];
}): DlcAggregateOutput {
  const empById = new Map<string, DlcEmployeeInput>();
  for (const e of input.employees) empById.set(e.id, e);

  // Per-employee accumulator.
  type Accum = {
    hw: number;
    ho: number;
    weekly_hw: number;
    weekly_ho: number;
  };
  const perEmp = new Map<string, Accum>();

  for (const t of input.timesheets) {
    const hw = safeNonNeg(t.hours_worked);
    const ho = safeNonNeg(t.hours_overtime);
    if (hw === 0 && ho === 0) continue;
    const cur = perEmp.get(t.employee_id) ?? {
      hw: 0,
      ho: 0,
      weekly_hw: 0,
      weekly_ho: 0,
    };
    cur.hw += hw;
    cur.ho += ho;
    if (t.approved_via_weekly) {
      cur.weekly_hw += hw;
      cur.weekly_ho += ho;
    }
    perEmp.set(t.employee_id, cur);
  }

  const rows: DlcEmployeeRow[] = [];
  let totalBase = 0;
  let totalOt = 0;
  let totalHours = 0;
  let totalOvertime = 0;
  let weeklyHours = 0;
  let dailyOnlyHours = 0;

  for (const [empId, accum] of perEmp) {
    const emp = empById.get(empId);
    const rate = emp ? safeNonNeg(emp.hourly_rate) : 0;
    const baseCost = round(accum.hw * rate);
    const otCost = round(accum.ho * rate * OVERTIME_MULTIPLIER);
    const totalCost = baseCost + otCost;

    const employeeHours = accum.hw + accum.ho;
    const employeeWeekly = accum.weekly_hw + accum.weekly_ho;
    const employeeDaily = employeeHours - employeeWeekly;

    rows.push({
      employee_id: empId,
      full_name: emp?.full_name ?? "(unknown)",
      hourly_rate: rate,
      hours_worked: round(accum.hw, 2),
      hours_overtime: round(accum.ho, 2),
      base_cost: baseCost,
      overtime_cost: otCost,
      total_cost: totalCost,
      weekly_hours: round(employeeWeekly, 2),
      daily_only_hours: round(employeeDaily, 2),
    });

    totalBase += baseCost;
    totalOt += otCost;
    totalHours += accum.hw;
    totalOvertime += accum.ho;
    weeklyHours += employeeWeekly;
    dailyOnlyHours += employeeDaily;
  }

  rows.sort((a, b) => b.total_cost - a.total_cost);

  const totalHoursAll = totalHours + totalOvertime;
  const weeklyShare =
    totalHoursAll > 0 ? (weeklyHours / totalHoursAll) * 100 : 0;

  return {
    total_cost: round(totalBase + totalOt),
    base_cost: round(totalBase),
    overtime_cost: round(totalOt),
    total_hours: round(totalHours, 2),
    total_overtime: round(totalOvertime, 2),
    employees: rows,
    provenance: {
      weekly_hours: round(weeklyHours, 2),
      daily_only_hours: round(dailyOnlyHours, 2),
      weekly_share_pct: round(weeklyShare, 1),
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

function safeNonNeg(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function round(value: number, decimals = 0): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
