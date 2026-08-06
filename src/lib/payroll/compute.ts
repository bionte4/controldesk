/**
 * ControlDesk payroll compute helpers (rules §14).
 *
 * Pure functions used both by the payroll generator (server action) and by
 * unit tests. All money in IDR whole rupiah unless otherwise noted.
 *
 * Formula:
 *   overtime_pay  = hours_overtime * hourly_rate * OVERTIME_MULTIPLIER
 *   base_pay      = base_salary (pro-rated by working days when applicable)
 *   gross_pay     = base_pay + overtime_pay + shift_allowance
 *   deductions    = configurable per tenant; default 0 in the app-level
 *                   generator (real deductions computed by an external
 *                   payroll provider).
 *   net_pay       = gross_pay - deductions
 *
 * We keep the multipliers explicit constants — a future migration can move
 * them into `tenants.prefs`.
 */

export const OVERTIME_MULTIPLIER = 1.5;

export type PayrollComputeInput = {
  monthly_salary: number;
  hourly_rate: number;
  hours_worked: number;
  hours_overtime: number;
  shift_allowance_total: number;
  deductions?: number;
};

export type PayrollComputeOutput = {
  base_salary: number;
  hours_worked: number;
  hours_overtime: number;
  overtime_pay: number;
  shift_allowance: number;
  gross_pay: number;
  deductions: number;
  net_pay: number;
};

export function computePayroll(input: PayrollComputeInput): PayrollComputeOutput {
  const base = round(Math.max(0, input.monthly_salary));
  const ot = round(
    Math.max(0, input.hours_overtime) *
      Math.max(0, input.hourly_rate) *
      OVERTIME_MULTIPLIER,
  );
  const allowance = round(Math.max(0, input.shift_allowance_total));
  const deductions = round(Math.max(0, input.deductions ?? 0));
  const gross = round(base + ot + allowance);
  const net = round(gross - deductions);

  return {
    base_salary: base,
    hours_worked: round(input.hours_worked, 2),
    hours_overtime: round(input.hours_overtime, 2),
    overtime_pay: ot,
    shift_allowance: allowance,
    gross_pay: gross,
    deductions,
    net_pay: net,
  };
}

/**
 * Real-time direct labour for a project window given aggregated inputs.
 * The SQL function `compute_project_direct_labour` performs the same math
 * inside Postgres; keep them in lockstep.
 */
export function directLabourCost(input: {
  hours_worked: number;
  hours_overtime: number;
  hourly_rate: number;
  shift_allowance_total: number;
}): number {
  const base = Math.max(0, input.hours_worked) * Math.max(0, input.hourly_rate);
  const ot =
    Math.max(0, input.hours_overtime) *
    Math.max(0, input.hourly_rate) *
    OVERTIME_MULTIPLIER;
  const allowance = Math.max(0, input.shift_allowance_total);
  return round(base + ot + allowance);
}

function round(value: number, decimals = 0): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
