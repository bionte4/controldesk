"use server";

import { revalidatePath } from "next/cache";

import { computePayroll } from "@/lib/payroll/compute";
import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import {
  finalizePayrollPeriodSchema,
  generatePayrollPeriodSchema,
} from "@/lib/validation/hr-schedule";

// ---------------------------------------------------------------------------
// Generate a payroll period — aggregates timesheets & rosters for a month.
// Idempotent: re-running for the same (year, month) refreshes lines.
// ---------------------------------------------------------------------------
export const generatePayrollPeriodAction = withSecureAction({
  schema: generatePayrollPeriodSchema,
  resource: "payroll_period",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "payroll_periods",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { period_year, period_month } = input;

    // Compute date bounds — end date is the last day of the month.
    const startDate = new Date(Date.UTC(period_year, period_month - 1, 1));
    const endDate = new Date(Date.UTC(period_year, period_month, 0));
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    // 1. Upsert the period record.
    const { data: existingPeriod } = await supabase
      .from("payroll_periods")
      .select("id, status")
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("period_year", period_year)
      .eq("period_month", period_month)
      .maybeSingle();

    let periodId: string;
    if (existingPeriod) {
      if (existingPeriod.status === "FINALIZED") {
        throw new Error("Period already finalized. Reopen before regenerating.");
      }
      periodId = existingPeriod.id;
    } else {
      const { data: inserted, error } = await supabase
        .from("payroll_periods")
        .insert({
          tenant_id: ctx.actor.tenantId,
          period_year,
          period_month,
          status: "DRAFT",
          generated_by: ctx.actor.employeeId,
        })
        .select("id")
        .single();
      if (error || !inserted) {
        throw new Error(error?.message ?? "Failed to create payroll period.");
      }
      periodId = inserted.id;
    }

    // 2. Load all active employees.
    const { data: employees, error: empErr } = await supabase
      .from("employees")
      .select("id, monthly_salary, hourly_rate")
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("is_active", true)
      .limit(500);
    if (empErr) throw new Error(empErr.message);

    // 3. For each employee, aggregate timesheets + roster allowances.
    //
    // Note (Fase 2 / GAS §27): daily rows attached to an APPROVED
    // `timesheet_weeks` packet already have their per-day status cascaded
    // to `APPROVED` (see `approveWeeklyTimesheetAction`), so the filter
    // below transparently picks up both legacy per-day approvals AND
    // weekly-packet approvals with identical math. `direct-labor.ts`
    // additionally exposes the per-employee weekly-vs-daily provenance
    // split for the Project DLC view (rules §14).
    const { data: timesheets } = await supabase
      .from("timesheets")
      .select("employee_id, hours_worked, hours_overtime, status, work_date")
      .eq("tenant_id", ctx.actor.tenantId)
      .gte("work_date", iso(startDate))
      .lte("work_date", iso(endDate))
      .eq("status", "APPROVED");

    const { data: rosters } = await supabase
      .from("employee_rosters")
      .select("employee_id, shift:shift_id(shift_allowance), status, work_date")
      .eq("tenant_id", ctx.actor.tenantId)
      .gte("work_date", iso(startDate))
      .lte("work_date", iso(endDate))
      .eq("status", "PLANNED");

    const tsByEmp = new Map<string, { hw: number; ho: number }>();
    for (const t of timesheets ?? []) {
      const cur = tsByEmp.get(t.employee_id) ?? { hw: 0, ho: 0 };
      cur.hw += Number(t.hours_worked ?? 0);
      cur.ho += Number(t.hours_overtime ?? 0);
      tsByEmp.set(t.employee_id, cur);
    }

    const allowanceByEmp = new Map<string, number>();
    type RosterAgg = {
      employee_id: string;
      shift: { shift_allowance: string } | null;
    };
    for (const r of (rosters ?? []) as unknown as RosterAgg[]) {
      const alw = Number(r.shift?.shift_allowance ?? 0);
      const cur = allowanceByEmp.get(r.employee_id) ?? 0;
      allowanceByEmp.set(r.employee_id, cur + alw);
    }

    // 4. Delete existing DRAFT lines and re-insert.
    if (existingPeriod) {
      await supabase
        .from("payroll_lines")
        .delete()
        .eq("period_id", periodId)
        .eq("tenant_id", ctx.actor.tenantId);
    }

    const linesToInsert = (employees ?? []).map((e) => {
      const ts = tsByEmp.get(e.id) ?? { hw: 0, ho: 0 };
      const line = computePayroll({
        monthly_salary: Number(e.monthly_salary ?? 0),
        hourly_rate: Number(e.hourly_rate ?? 0),
        hours_worked: ts.hw,
        hours_overtime: ts.ho,
        shift_allowance_total: allowanceByEmp.get(e.id) ?? 0,
      });
      return {
        tenant_id: ctx.actor.tenantId,
        period_id: periodId,
        employee_id: e.id,
        base_salary: line.base_salary,
        hours_worked: line.hours_worked,
        hours_overtime: line.hours_overtime,
        overtime_pay: line.overtime_pay,
        shift_allowance: line.shift_allowance,
        gross_pay: line.gross_pay,
        deductions: line.deductions,
        net_pay: line.net_pay,
      };
    });

    if (linesToInsert.length > 0) {
      const { error: insertErr } = await supabase
        .from("payroll_lines")
        .insert(linesToInsert);
      if (insertErr) throw new Error(insertErr.message);
    }

    revalidatePath("/hr/payroll");
    return {
      result: { id: periodId, lines: linesToInsert.length },
      auditResourceId: periodId,
      auditNewValues: {
        period_year,
        period_month,
        lines: linesToInsert.length,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Finalize a period — marks it read-only for downstream disbursement.
// ---------------------------------------------------------------------------
export const finalizePayrollPeriodAction = withSecureAction({
  schema: finalizePayrollPeriodSchema,
  resource: "payroll_period",
  action: "settle",
  auditAction: "SETTLE",
  auditResourceName: "payroll_periods",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("payroll_periods")
      .select("id, status")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!current) throw new Error("Period not found.");
    if (current.status === "FINALIZED") {
      throw new Error("Period already finalized.");
    }

    const { error } = await supabase
      .from("payroll_periods")
      .update({
        status: "FINALIZED",
        finalized_by: ctx.actor.employeeId,
        finalized_at: new Date().toISOString(),
      })
      .eq("id", current.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    revalidatePath("/hr/payroll");
    return {
      result: { id: current.id },
      auditResourceId: current.id,
      auditOldValues: { status: current.status },
      auditNewValues: { status: "FINALIZED" },
    };
  },
});
