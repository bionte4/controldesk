"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import {
  createWorkShiftSchema,
  deleteRosterEntrySchema,
  upsertRosterEntrySchema,
} from "@/lib/validation/hr-schedule";

// ---------------------------------------------------------------------------
// Shifts — HR / management create / edit shift definitions.
// ---------------------------------------------------------------------------
export const createWorkShiftAction = withSecureAction({
  schema: createWorkShiftSchema,
  resource: "work_shift",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "work_shifts",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const durationInterval = `${input.duration_hours} hours`;

    const { data: inserted, error } = await supabase
      .from("work_shifts")
      .insert({
        tenant_id: ctx.actor.tenantId,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        start_time: `${input.start_time}:00`,
        end_time: `${input.end_time}:00`,
        duration: durationInterval,
        shift_allowance: input.shift_allowance_idr,
        is_night: input.is_night,
      })
      .select("id, code")
      .single();
    if (error || !inserted) {
      throw new Error(error?.message ?? "Failed to create shift.");
    }

    revalidatePath("/hr/roster");
    return {
      result: { id: inserted.id, code: inserted.code },
      auditResourceId: inserted.id,
      auditNewValues: {
        code: inserted.code,
        duration_hours: input.duration_hours,
        shift_allowance_idr: input.shift_allowance_idr,
        is_night: input.is_night,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Rosters — upsert a single (employee, date) entry.
// ---------------------------------------------------------------------------
export const upsertRosterEntryAction = withSecureAction({
  schema: upsertRosterEntrySchema,
  resource: "roster_entry",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "employee_rosters",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    // Try to update first; if no row exists we insert.
    const { data: existing } = await supabase
      .from("employee_rosters")
      .select("id")
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("employee_id", input.employee_id)
      .eq("work_date", input.work_date)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("employee_rosters")
        .update({
          shift_id: input.shift_id,
          project_id: input.project_id ?? null,
          status: input.status,
          notes: input.notes ?? null,
        })
        .eq("id", existing.id)
        .eq("tenant_id", ctx.actor.tenantId);
      if (error) throw new Error(error.message);

      revalidatePath("/hr/roster");
      return {
        result: { id: existing.id, updated: true },
        auditResourceId: existing.id,
        auditNewValues: {
          employee_id: input.employee_id,
          shift_id: input.shift_id,
          work_date: input.work_date,
          status: input.status,
        },
      };
    }

    const { data: inserted, error } = await supabase
      .from("employee_rosters")
      .insert({
        tenant_id: ctx.actor.tenantId,
        employee_id: input.employee_id,
        shift_id: input.shift_id,
        project_id: input.project_id ?? null,
        work_date: input.work_date,
        status: input.status,
        notes: input.notes ?? null,
        created_by: ctx.actor.employeeId,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      throw new Error(error?.message ?? "Failed to upsert roster entry.");
    }

    revalidatePath("/hr/roster");
    return {
      result: { id: inserted.id, updated: false },
      auditResourceId: inserted.id,
      auditNewValues: {
        employee_id: input.employee_id,
        shift_id: input.shift_id,
        work_date: input.work_date,
        status: input.status,
      },
    };
  },
});

export const deleteRosterEntryAction = withSecureAction({
  schema: deleteRosterEntrySchema,
  resource: "roster_entry",
  action: "delete",
  auditAction: "DELETE",
  auditResourceName: "employee_rosters",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { error } = await supabase
      .from("employee_rosters")
      .delete()
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    revalidatePath("/hr/roster");
    return {
      result: { id: input.id },
      auditResourceId: input.id,
    };
  },
});
