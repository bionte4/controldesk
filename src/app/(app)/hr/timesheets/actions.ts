"use server";

import { revalidatePath } from "next/cache";

import { assertEmployeeAssignedToProject } from "@/lib/data/assignments";
import { notifyUser } from "@/lib/notifications/service";
import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import { notifyTimesheetSubmission } from "@/lib/timesheets/notify";
import { nextTimesheetStatus } from "@/lib/timesheets/state";
import {
  approveTimesheetSchema,
  rejectTimesheetSchema,
  submitTimesheetSchema,
} from "@/lib/validation/hr-schedule";

// ---------------------------------------------------------------------------
// Submit — create or update a timesheet then move to SUBMITTED.
// ---------------------------------------------------------------------------
export const submitTimesheetAction = withSecureAction({
  schema: submitTimesheetSchema,
  resource: "timesheet",
  action: "submit",
  auditAction: "SUBMIT",
  auditResourceName: "timesheets",
  resolveAttributes: async (input, ctx) => ({
    tenantId: ctx.actor.tenantId,
    ownerEmployeeId: input.employee_id,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    // Guardrail — a timesheet row that carries a `project_id` must
    // map to an ACTIVE assignment (member OR PM) for the target
    // employee, otherwise an employee could self-report hours to a
    // project they aren't assigned to and skew profitability.
    // Internal / unassigned hours (`project_id` null) skip the check.
    if (input.project_id) {
      const err = await assertEmployeeAssignedToProject({
        employeeId: input.employee_id,
        projectId: input.project_id,
      });
      if (err) throw new Error(err);
    }

    const { data: existing } = await supabase
      .from("timesheets")
      .select("id, status")
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("employee_id", input.employee_id)
      .eq("work_date", input.work_date)
      .maybeSingle();

    let timesheetId: string;
    let oldStatus: string | null = null;
    if (existing) {
      // Must be DRAFT or REJECTED to re-submit.
      nextTimesheetStatus({ current: existing.status, action: "SUBMIT" });
      const { data: updated, error } = await supabase
        .from("timesheets")
        .update({
          project_id: input.project_id ?? null,
          roster_id: input.roster_id ?? null,
          hours_worked: input.hours_worked,
          hours_overtime: input.hours_overtime,
          notes: input.notes ?? null,
          status: "SUBMITTED",
          submitted_at: new Date().toISOString(),
          rejection_reason: null,
        })
        .eq("id", existing.id)
        .eq("tenant_id", ctx.actor.tenantId)
        .select("id")
        .single();
      if (error || !updated) throw new Error(error?.message ?? "Update failed.");
      timesheetId = updated.id;
      oldStatus = existing.status;
    } else {
      const { data: inserted, error } = await supabase
        .from("timesheets")
        .insert({
          tenant_id: ctx.actor.tenantId,
          employee_id: input.employee_id,
          project_id: input.project_id ?? null,
          roster_id: input.roster_id ?? null,
          work_date: input.work_date,
          hours_worked: input.hours_worked,
          hours_overtime: input.hours_overtime,
          notes: input.notes ?? null,
          status: "SUBMITTED",
          submitted_at: new Date().toISOString(),
          created_by: ctx.actor.employeeId,
        })
        .select("id")
        .single();
      if (error || !inserted) {
        throw new Error(error?.message ?? "Failed to submit timesheet.");
      }
      timesheetId = inserted.id;
    }

    // Fan out TIMESHEET_SUBMITTED to the submitter's direct supervisor
    // (falling back to tenant-wide PM/Supervisor/Admin roles if the
    // reports-to chain isn't wired). Fire-and-forget — a failed
    // notification must never fail the submit.
    void notifyTimesheetSubmission({
      tenantId: ctx.actor.tenantId,
      submitterEmployeeId: input.employee_id,
      title: "Timesheet menunggu approval",
      body: `Timesheet ${input.work_date} (${input.hours_worked} jam) menunggu review.`,
      actionUrl: `/hr/timesheets/${timesheetId}`,
      payload: {
        timesheet_id: timesheetId,
        work_date: input.work_date,
        hours_worked: input.hours_worked,
      },
    });

    revalidatePath("/hr/timesheets");
    return {
      result: { id: timesheetId, updated: existing !== null },
      auditResourceId: timesheetId,
      auditOldValues: oldStatus ? { status: oldStatus } : null,
      auditNewValues: {
        status: "SUBMITTED",
        hours_worked: input.hours_worked,
        hours_overtime: input.hours_overtime,
        project_id: input.project_id ?? null,
        ...(existing ? {} : { work_date: input.work_date }),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------
export const approveTimesheetAction = withSecureAction({
  schema: approveTimesheetSchema,
  resource: "timesheet",
  action: "approve",
  auditAction: "APPROVE",
  auditResourceName: "timesheets",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("timesheets")
      .select("id, status, employee_id, work_date")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!current) throw new Error("Timesheet not found.");

    const next = nextTimesheetStatus({
      current: current.status,
      action: "APPROVE",
    });

    const { error } = await supabase
      .from("timesheets")
      .update({
        status: next,
        approved_at: new Date().toISOString(),
        approved_by: ctx.actor.employeeId,
      })
      .eq("id", current.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    // Notify the submitter so they know their timesheet was accepted.
    // `notifyUser()` fans out to in-app + Telegram + WhatsApp based on
    // the recipient's per-category preferences. Best-effort — a failed
    // notification must never roll back a successful approval.
    const { data: submitter } = await supabase
      .from("employees")
      .select("id, user_id")
      .eq("id", current.employee_id)
      .maybeSingle();
    if (submitter?.user_id) {
      void notifyUser({
        recipient: { userId: submitter.user_id, employeeId: submitter.id },
        kind: "TIMESHEET_APPROVED",
        title: "Timesheet disetujui",
        body:
          input.comment && input.comment.trim().length > 0
            ? `Timesheet ${current.work_date} disetujui. Catatan approver: ${input.comment.trim()}`
            : `Timesheet ${current.work_date} disetujui.`,
        actionUrl: `/hr/timesheets/${current.id}`,
        payload: { timesheet_id: current.id, work_date: current.work_date },
        tenantId: ctx.actor.tenantId,
      });
    }

    revalidatePath("/hr/timesheets");
    return {
      result: { id: current.id, status: next },
      auditResourceId: current.id,
      auditOldValues: { status: current.status },
      auditNewValues: { status: next, comment: input.comment ?? null },
    };
  },
});

// ---------------------------------------------------------------------------
// Reject
// ---------------------------------------------------------------------------
export const rejectTimesheetAction = withSecureAction({
  schema: rejectTimesheetSchema,
  resource: "timesheet",
  action: "reject",
  auditAction: "REJECT",
  auditResourceName: "timesheets",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("timesheets")
      .select("id, status, employee_id, work_date")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!current) throw new Error("Timesheet not found.");

    const next = nextTimesheetStatus({
      current: current.status,
      action: "REJECT",
    });

    const { error } = await supabase
      .from("timesheets")
      .update({
        status: next,
        rejection_reason: input.reason,
      })
      .eq("id", current.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    // Notify the submitter that changes are needed so the timesheet
    // doesn't sit in REJECTED indefinitely (submitter can `SUBMIT`
    // again after fixing). Same fan-out semantics as APPROVE.
    const { data: submitter } = await supabase
      .from("employees")
      .select("id, user_id")
      .eq("id", current.employee_id)
      .maybeSingle();
    if (submitter?.user_id) {
      void notifyUser({
        recipient: { userId: submitter.user_id, employeeId: submitter.id },
        kind: "TIMESHEET_REJECTED",
        title: "Timesheet perlu revisi",
        body: `Timesheet ${current.work_date} dikembalikan. Alasan: ${input.reason}`,
        actionUrl: `/hr/timesheets/${current.id}`,
        payload: {
          timesheet_id: current.id,
          work_date: current.work_date,
          rejection_reason: input.reason,
        },
        tenantId: ctx.actor.tenantId,
      });
    }

    revalidatePath("/hr/timesheets");
    return {
      result: { id: current.id, status: next },
      auditResourceId: current.id,
      auditOldValues: { status: current.status },
      auditNewValues: { status: next, reason: input.reason },
    };
  },
});
