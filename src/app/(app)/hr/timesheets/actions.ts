"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
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

    const { data: existing } = await supabase
      .from("timesheets")
      .select("id, status")
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("employee_id", input.employee_id)
      .eq("work_date", input.work_date)
      .maybeSingle();

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

      revalidatePath("/hr/timesheets");
      return {
        result: { id: updated.id, updated: true },
        auditResourceId: updated.id,
        auditOldValues: { status: existing.status },
        auditNewValues: {
          status: "SUBMITTED",
          hours_worked: input.hours_worked,
          hours_overtime: input.hours_overtime,
          project_id: input.project_id ?? null,
        },
      };
    }

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

    revalidatePath("/hr/timesheets");
    return {
      result: { id: inserted.id, updated: false },
      auditResourceId: inserted.id,
      auditNewValues: {
        status: "SUBMITTED",
        hours_worked: input.hours_worked,
        hours_overtime: input.hours_overtime,
        project_id: input.project_id ?? null,
        work_date: input.work_date,
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
      .select("id, status, employee_id")
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
      .select("id, status")
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

    revalidatePath("/hr/timesheets");
    return {
      result: { id: current.id, status: next },
      auditResourceId: current.id,
      auditOldValues: { status: current.status },
      auditNewValues: { status: next, reason: input.reason },
    };
  },
});
