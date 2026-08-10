/**
 * ControlDesk — Weekly Timesheet data access (GAS §27).
 *
 * All queries tenant-scoped via RLS. Callers are RSC / Server Actions.
 * Wrapped in `React.cache()` for request-lifetime deduplication.
 */

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { Tables, TimesheetStatus } from "@/types/database";

export type WeekRow = Tables<"timesheet_weeks">;
export type WeekApprovalLogRow = Tables<"timesheet_week_approval_logs">;
export type TimesheetDayRow = Tables<"timesheets">;

export type WeekWithMeta = WeekRow & {
  employee: Pick<Tables<"employees">, "id" | "full_name" | "role"> | null;
};

export type WeekDetail = WeekWithMeta & {
  days: (TimesheetDayRow & {
    project: Pick<Tables<"projects">, "id" | "code" | "name"> | null;
  })[];
  logs: (WeekApprovalLogRow & {
    actor: Pick<Tables<"employees">, "id" | "full_name"> | null;
  })[];
};

const WEEK_META_SELECT = `
  *,
  employee:employees!timesheet_weeks_employee_id_fkey(id, full_name, role)
` as const;

/** All weeks for the tenant, newest first — for the listing page. */
export const listWeeklyTimesheets = cache(
  async (opts?: {
    limit?: number;
    status?: TimesheetStatus[];
    employeeId?: string;
    /**
     * Optional narrow — restrict to a set of employee ids (used by
     * scoped viewers such as SPV/PM who should only see their own
     * team's weekly packets). Precedence rules:
     *   • `undefined` — no employee narrowing (org scope).
     *   • Empty array — collapse to "no rows"; supabase-js normally
     *     drops an empty `.in()` filter and would leak the tenant,
     *     so we pin the query to an impossible id.
     *   • Non-empty array — `.in("employee_id", ids)`.
     * `employeeId` (single) always wins when set for backwards
     * compatibility with the single-employee editor route.
     */
    employeeIds?: string[];
  }): Promise<WeekWithMeta[]> => {
    const supabase = await createClient();
    let query = supabase
      .from("timesheet_weeks")
      .select(WEEK_META_SELECT)
      .order("week_start_date", { ascending: false })
      .limit(opts?.limit ?? 100);
    if (opts?.status && opts.status.length > 0) {
      query = query.in("status", opts.status);
    }
    if (opts?.employeeId) {
      query = query.eq("employee_id", opts.employeeId);
    } else if (opts?.employeeIds !== undefined) {
      if (opts.employeeIds.length === 0) {
        query = query.eq("employee_id", "00000000-0000-0000-0000-000000000000");
      } else {
        query = query.in("employee_id", opts.employeeIds);
      }
    }
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as unknown as WeekWithMeta[];
  },
);

/** Weekly packets awaiting PM/Supervisor/HR approval — for the inbox. */
export const listPendingWeeklyTimesheets = cache(
  async (limit = 100): Promise<WeekWithMeta[]> => {
    return listWeeklyTimesheets({ status: ["SUBMITTED"], limit });
  },
);

/** KPI helper. */
export const countPendingWeeklyTimesheets = cache(
  async (): Promise<number> => {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("timesheet_weeks")
      .select("id", { count: "exact", head: true })
      .eq("status", "SUBMITTED");
    if (error) throw error;
    return count ?? 0;
  },
);

/**
 * Fetch a single weekly packet — header, all daily rows, and audit log
 * timeline. Used by the editor + detail views.
 */
export const getWeeklyTimesheet = cache(
  async (id: string): Promise<WeekDetail | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("timesheet_weeks")
      .select(WEEK_META_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const [daysRes, logsRes] = await Promise.all([
      supabase
        .from("timesheets")
        .select(
          `
            *,
            project:projects!timesheets_project_id_fkey(id, code, name)
          `,
        )
        .eq("week_id", id)
        .order("work_date", { ascending: true }),
      supabase
        .from("timesheet_week_approval_logs")
        .select(
          `
            *,
            actor:employees!timesheet_week_approval_logs_actor_employee_id_fkey(id, full_name)
          `,
        )
        .eq("week_id", id)
        .order("created_at", { ascending: true }),
    ]);

    if (daysRes.error) throw daysRes.error;
    if (logsRes.error) throw logsRes.error;

    return {
      ...(data as unknown as WeekWithMeta),
      days: (daysRes.data ?? []) as unknown as WeekDetail["days"],
      logs: (logsRes.data ?? []) as unknown as WeekDetail["logs"],
    };
  },
);

/**
 * Load (or `null`) the week header for a given `(employee, week_start)` pair
 * — used by the editor route to reconcile a URL like
 * `/hr/timesheets/weekly/2026-08-03` against an existing packet.
 */
export const findWeekByEmployeeAndStart = cache(
  async (input: {
    employeeId: string;
    weekStartDate: string;
  }): Promise<WeekDetail | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("timesheet_weeks")
      .select("id")
      .eq("employee_id", input.employeeId)
      .eq("week_start_date", input.weekStartDate)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return getWeeklyTimesheet(data.id);
  },
);
