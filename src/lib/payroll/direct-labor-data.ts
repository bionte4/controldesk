/**
 * ControlDesk — Direct Labor Cost data access (rules §14).
 *
 * RSC-safe query helpers that materialise the joined shape expected by
 * `aggregateDirectLaborCost`. All queries tenant-scoped via RLS.
 */

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import {
  aggregateDirectLaborCost,
  type DlcAggregateOutput,
  type DlcTimesheetInput,
} from "./direct-labor";

// ---------------------------------------------------------------------------
// Query row shape — narrow projection over `timesheets` + `timesheet_weeks`.
// ---------------------------------------------------------------------------

type TimesheetJoinRow = {
  employee_id: string;
  project_id: string | null;
  hours_worked: string;
  hours_overtime: string;
  week_id: string | null;
  week: { status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" } | null;
};

/**
 * Compute Direct Labor Cost for a single project across an inclusive date
 * window. Only APPROVED daily rows are counted (per rules §14 — hours must
 * be signed off before entering DLC).
 *
 * `approved_via_weekly` is `true` when the daily row is attached to a
 * `timesheet_weeks` row whose status is `APPROVED` (GAS §27 path); `false`
 * for legacy per-day approvals.
 */
export const getProjectDirectLaborCost = cache(
  async (input: {
    projectId: string;
    from: string; // YYYY-MM-DD inclusive
    to: string; // YYYY-MM-DD inclusive
  }): Promise<DlcAggregateOutput> => {
    const supabase = await createClient();

    const { data: rawRows, error } = await supabase
      .from("timesheets")
      .select(
        `
          employee_id,
          project_id,
          hours_worked,
          hours_overtime,
          week_id,
          week:timesheet_weeks!timesheets_week_id_fkey(status)
        `,
      )
      .eq("project_id", input.projectId)
      .gte("work_date", input.from)
      .lte("work_date", input.to)
      .eq("status", "APPROVED")
      .limit(5000);

    if (error) throw error;

    const rows = (rawRows ?? []) as unknown as TimesheetJoinRow[];
    const timesheets: DlcTimesheetInput[] = rows.map((r) => ({
      employee_id: r.employee_id,
      project_id: r.project_id,
      hours_worked: Number(r.hours_worked ?? 0),
      hours_overtime: Number(r.hours_overtime ?? 0),
      approved_via_weekly: !!r.week && r.week.status === "APPROVED",
    }));

    if (timesheets.length === 0) {
      return aggregateDirectLaborCost({ timesheets: [], employees: [] });
    }

    // Load hourly rates for every employee referenced in the timesheets.
    const employeeIds = Array.from(
      new Set(timesheets.map((t) => t.employee_id)),
    );
    const { data: empRows } = await supabase
      .from("employees")
      .select("id, full_name, hourly_rate")
      .in("id", employeeIds);

    const employees = (empRows ?? []).map((e) => ({
      id: e.id,
      full_name: e.full_name,
      hourly_rate: Number(e.hourly_rate ?? 0),
    }));

    return aggregateDirectLaborCost({ timesheets, employees });
  },
);
