"use server";

import { revalidatePath } from "next/cache";

import { notifyUser } from "@/lib/notifications/service";
import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import { toLegacyDbRole, type AnyDbEmployeeRole } from "@/lib/rbac/roles";
import { canApproveWeek, nextWeekStatus } from "@/lib/timesheets/week-state";
import {
  approveWeeklyTimesheetSchema,
  rejectWeeklyTimesheetSchema,
  submitWeeklyTimesheetSchema,
  type SubmitWeeklyTimesheetInput,
} from "@/lib/validation/timesheet-week";
import { weekStartFromDate } from "@/lib/timesheets/week-state";
import type { TimesheetStatus } from "@/types/database";

// ---------------------------------------------------------------------------
// Submit — create or upsert the whole week + all 7 daily rows + move to
// SUBMITTED. Idempotent: re-submitting an existing packet (DRAFT/REJECTED)
// updates daily rows and moves the packet back to SUBMITTED.
// ---------------------------------------------------------------------------
export const submitWeeklyTimesheetAction = withSecureAction({
  schema: submitWeeklyTimesheetSchema,
  resource: "timesheet",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "timesheet_weeks",
  resolveAttributes: async (input, ctx) => ({
    tenantId: ctx.actor.tenantId,
    ownerEmployeeId: input.employee_id,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    // Defence-in-depth: re-normalise week_start_date to an ISO Monday. If the
    // client somehow submitted a non-Monday date, snap forward — Zod would
    // usually catch this but the DB has no such constraint.
    const normalisedWeekStart = weekStartFromDate(input.week_start_date);
    if (normalisedWeekStart !== input.week_start_date) {
      throw new Error(
        `week_start_date must be ISO Monday (got ${input.week_start_date}).`,
      );
    }

    // 1. Load existing header (if any).
    const { data: existing } = await supabase
      .from("timesheet_weeks")
      .select("id, status")
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("employee_id", input.employee_id)
      .eq("week_start_date", input.week_start_date)
      .maybeSingle();

    const fromStatus: TimesheetStatus = existing?.status ?? "DRAFT";
    // Guard-rail — throws if illegal transition.
    nextWeekStatus({ current: fromStatus, action: "SUBMIT" });

    const totals = sumHours(input);
    const submittedAt = new Date().toISOString();

    // 2. Upsert the packet header.
    let weekId: string;
    if (existing) {
      const { data: updated, error } = await supabase
        .from("timesheet_weeks")
        .update({
          status: "SUBMITTED",
          submitted_at: submittedAt,
          notes: input.notes ?? null,
          total_hours: totals.totalHours,
          total_overtime: totals.totalOvertime,
          rejection_reason: null,
          rejected_at: null,
          rejected_by: null,
          approved_at: null,
          approved_by: null,
        })
        .eq("id", existing.id)
        .eq("tenant_id", ctx.actor.tenantId)
        .select("id")
        .single();
      if (error || !updated) {
        throw new Error(error?.message ?? "Failed to update weekly packet.");
      }
      weekId = updated.id;
    } else {
      const { data: inserted, error } = await supabase
        .from("timesheet_weeks")
        .insert({
          tenant_id: ctx.actor.tenantId,
          employee_id: input.employee_id,
          week_start_date: input.week_start_date,
          status: "SUBMITTED",
          submitted_at: submittedAt,
          notes: input.notes ?? null,
          total_hours: totals.totalHours,
          total_overtime: totals.totalOvertime,
          created_by: ctx.actor.employeeId,
        })
        .select("id")
        .single();
      if (error || !inserted) {
        throw new Error(error?.message ?? "Failed to create weekly packet.");
      }
      weekId = inserted.id;
    }

    // 3. Upsert each daily row. Existing (employee, work_date) rows are
    //    updated in place; new dates are inserted. We tag every row with the
    //    packet's `week_id` and set status to SUBMITTED so per-day views and
    //    per-week views stay consistent.
    await upsertDailyRows({
      tenantId: ctx.actor.tenantId,
      employeeId: input.employee_id,
      createdBy: ctx.actor.employeeId,
      weekId,
      submittedAt,
      days: input.days,
    });

    // 4. Audit log.
    await supabase.from("timesheet_week_approval_logs").insert({
      tenant_id: ctx.actor.tenantId,
      week_id: weekId,
      actor_employee_id: ctx.actor.employeeId,
      actor_role: toLegacyDbRole(ctx.canonicalRole) as AnyDbEmployeeRole,
      action: "SUBMIT",
      from_status: fromStatus,
      to_status: "SUBMITTED",
      comment: input.notes ?? null,
    });

    revalidatePath("/hr/timesheets");
    revalidatePath("/hr/timesheets/weekly");
    revalidatePath(`/hr/timesheets/weekly/${input.week_start_date}`);
    revalidatePath("/approvals");

    return {
      result: {
        id: weekId,
        status: "SUBMITTED" as TimesheetStatus,
        week_start_date: input.week_start_date,
      },
      auditResourceId: weekId,
      auditOldValues: existing ? { status: fromStatus } : null,
      auditNewValues: {
        status: "SUBMITTED",
        total_hours: totals.totalHours,
        total_overtime: totals.totalOvertime,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Approve — move packet to APPROVED and cascade to all daily rows.
// ---------------------------------------------------------------------------
export const approveWeeklyTimesheetAction = withSecureAction({
  schema: approveWeeklyTimesheetSchema,
  resource: "timesheet",
  action: "approve",
  auditAction: "APPROVE",
  auditResourceName: "timesheet_weeks",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("timesheet_weeks")
      .select("id, status, employee_id, week_start_date")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!current) throw new Error("Weekly timesheet not found.");

    // Role gate — mirrors PDP but with the richer week-approver matrix.
    if (!canApproveWeek(ctx.actor.role, current.status)) {
      throw new Error(
        `Role ${ctx.actor.role} may not approve at status ${current.status}.`,
      );
    }

    const next = nextWeekStatus({
      current: current.status,
      action: "APPROVE",
    });
    const approvedAt = new Date().toISOString();

    const { error } = await supabase
      .from("timesheet_weeks")
      .update({
        status: next,
        approved_at: approvedAt,
        approved_by: ctx.actor.employeeId,
      })
      .eq("id", current.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    // Cascade to daily rows attached to this week.
    const dayCascade = await supabase
      .from("timesheets")
      .update({
        status: "APPROVED",
        approved_at: approvedAt,
        approved_by: ctx.actor.employeeId,
      })
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("week_id", current.id);
    if (dayCascade.error) throw new Error(dayCascade.error.message);

    // Audit log.
    await supabase.from("timesheet_week_approval_logs").insert({
      tenant_id: ctx.actor.tenantId,
      week_id: current.id,
      actor_employee_id: ctx.actor.employeeId,
      actor_role: toLegacyDbRole(ctx.canonicalRole) as AnyDbEmployeeRole,
      action: "APPROVE",
      from_status: current.status,
      to_status: next,
      comment: input.comment ?? null,
    });

    // Only ping the submitter on the terminal APPROVED state, not on
    // interim states like PENDING_LEAD → PENDING_HR. This matches the
    // in-app UX: users hear back once their week is fully approved.
    if (next === "APPROVED") {
      const { data: submitter } = await supabase
        .from("employees")
        .select("id, user_id")
        .eq("id", current.employee_id)
        .maybeSingle();
      if (submitter?.user_id) {
        void notifyUser({
          recipient: { userId: submitter.user_id, employeeId: submitter.id },
          kind: "TIMESHEET_APPROVED",
          title: "Timesheet mingguan disetujui",
          body:
            input.comment && input.comment.trim().length > 0
              ? `Minggu mulai ${current.week_start_date} disetujui. Catatan: ${input.comment.trim()}`
              : `Minggu mulai ${current.week_start_date} disetujui.`,
          actionUrl: `/hr/timesheets/weekly/${current.week_start_date}`,
          payload: {
            timesheet_week_id: current.id,
            week_start_date: current.week_start_date,
          },
          tenantId: ctx.actor.tenantId,
        });
      }
    }

    revalidatePath("/hr/timesheets");
    revalidatePath("/hr/timesheets/weekly");
    revalidatePath(`/hr/timesheets/weekly/${current.week_start_date}`);
    revalidatePath("/approvals");

    return {
      result: { id: current.id, status: next },
      auditResourceId: current.id,
      auditOldValues: { status: current.status },
      auditNewValues: { status: next, comment: input.comment ?? null },
    };
  },
});

// ---------------------------------------------------------------------------
// Reject — move packet to REJECTED and mark daily rows the same, so the
// employee can edit and resubmit.
// ---------------------------------------------------------------------------
export const rejectWeeklyTimesheetAction = withSecureAction({
  schema: rejectWeeklyTimesheetSchema,
  resource: "timesheet",
  action: "reject",
  auditAction: "REJECT",
  auditResourceName: "timesheet_weeks",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("timesheet_weeks")
      .select("id, status, employee_id, week_start_date")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!current) throw new Error("Weekly timesheet not found.");

    if (!canApproveWeek(ctx.actor.role, current.status)) {
      throw new Error(
        `Role ${ctx.actor.role} may not reject at status ${current.status}.`,
      );
    }

    const next = nextWeekStatus({
      current: current.status,
      action: "REJECT",
    });
    const rejectedAt = new Date().toISOString();

    const { error } = await supabase
      .from("timesheet_weeks")
      .update({
        status: next,
        rejection_reason: input.reason,
        rejected_at: rejectedAt,
        rejected_by: ctx.actor.employeeId,
      })
      .eq("id", current.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    const dayCascade = await supabase
      .from("timesheets")
      .update({
        status: "REJECTED",
        rejection_reason: input.reason,
      })
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("week_id", current.id);
    if (dayCascade.error) throw new Error(dayCascade.error.message);

    // Notify the submitter so they can act on the feedback quickly.
    // Reject fires from any status, so no `next === "REJECTED"` guard
    // is needed here — the state machine can only land on REJECTED.
    const { data: submitter } = await supabase
      .from("employees")
      .select("id, user_id")
      .eq("id", current.employee_id)
      .maybeSingle();
    if (submitter?.user_id) {
      void notifyUser({
        recipient: { userId: submitter.user_id, employeeId: submitter.id },
        kind: "TIMESHEET_REJECTED",
        title: "Timesheet mingguan perlu revisi",
        body: `Minggu mulai ${current.week_start_date} dikembalikan. Alasan: ${input.reason}`,
        actionUrl: `/hr/timesheets/weekly/${current.week_start_date}`,
        payload: {
          timesheet_week_id: current.id,
          week_start_date: current.week_start_date,
          rejection_reason: input.reason,
        },
        tenantId: ctx.actor.tenantId,
      });
    }

    await supabase.from("timesheet_week_approval_logs").insert({
      tenant_id: ctx.actor.tenantId,
      week_id: current.id,
      actor_employee_id: ctx.actor.employeeId,
      actor_role: toLegacyDbRole(ctx.canonicalRole) as AnyDbEmployeeRole,
      action: "REJECT",
      from_status: current.status,
      to_status: next,
      comment: input.reason,
    });

    revalidatePath("/hr/timesheets");
    revalidatePath("/hr/timesheets/weekly");
    revalidatePath(`/hr/timesheets/weekly/${current.week_start_date}`);
    revalidatePath("/approvals");

    return {
      result: { id: current.id, status: next },
      auditResourceId: current.id,
      auditOldValues: { status: current.status },
      auditNewValues: { status: next, reason: input.reason },
    };
  },
});

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

function sumHours(input: SubmitWeeklyTimesheetInput): {
  totalHours: number;
  totalOvertime: number;
} {
  let totalHours = 0;
  let totalOvertime = 0;
  for (const d of input.days) {
    totalHours += d.hours_worked;
    totalOvertime += d.hours_overtime;
  }
  return {
    totalHours: Number(totalHours.toFixed(2)),
    totalOvertime: Number(totalOvertime.toFixed(2)),
  };
}

/**
 * Upsert each daily row and (re-)attach it to the packet. We can't rely on
 * PostgREST `upsert()` here because the app-level unique key is
 * `(tenant_id, employee_id, work_date)` and we want to preserve auxiliary
 * columns (`created_by`, `clock_in`, `clock_out`) if the row already exists.
 */
async function upsertDailyRows(input: {
  tenantId: string;
  employeeId: string;
  createdBy: string;
  weekId: string;
  submittedAt: string;
  days: SubmitWeeklyTimesheetInput["days"];
}) {
  const supabase = await createClient();

  const { data: existingRows } = await supabase
    .from("timesheets")
    .select("id, work_date")
    .eq("tenant_id", input.tenantId)
    .eq("employee_id", input.employeeId)
    .in(
      "work_date",
      input.days.map((d) => d.work_date),
    );
  const byDate = new Map<string, string>();
  for (const row of existingRows ?? []) {
    byDate.set(row.work_date, row.id);
  }

  for (const day of input.days) {
    const existingId = byDate.get(day.work_date);
    if (existingId) {
      const { error } = await supabase
        .from("timesheets")
        .update({
          project_id: day.project_id ?? null,
          hours_worked: day.hours_worked,
          hours_overtime: day.hours_overtime,
          notes: day.notes ?? null,
          status: "SUBMITTED",
          submitted_at: input.submittedAt,
          rejection_reason: null,
          approved_at: null,
          approved_by: null,
          week_id: input.weekId,
        })
        .eq("id", existingId)
        .eq("tenant_id", input.tenantId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("timesheets").insert({
        tenant_id: input.tenantId,
        employee_id: input.employeeId,
        project_id: day.project_id ?? null,
        work_date: day.work_date,
        hours_worked: day.hours_worked,
        hours_overtime: day.hours_overtime,
        notes: day.notes ?? null,
        status: "SUBMITTED",
        submitted_at: input.submittedAt,
        created_by: input.createdBy,
        week_id: input.weekId,
      });
      if (error) throw new Error(error.message);
    }
  }
}
