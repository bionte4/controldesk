"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import type { EmployeeRoleEnum } from "@/types/database";
import {
  createWorkShiftSchema,
  deleteWorkShiftSchema,
  updateWorkShiftSchema,
} from "@/lib/validation/hr-schedule";

// Mirror of `SHIFT_BASE_WRITERS` in `pdp.ts` — kept private to this
// module because it only informs *pre-mutation shaping* (stripping
// `shift_allowance` for PM/SPV). PDP + DB trigger enforce actual
// authorization.
const HR_OM_ROLES: readonly EmployeeRoleEnum[] = [
  "HR_ADMIN",
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
  "HEAD_MANAGER",
  "OPERATIONS_MANAGER",
] as const;

async function resolveAssignmentAttribute(
  projectId: string | null | undefined,
): Promise<boolean> {
  if (!projectId) return false;
  const supabase = await createClient();
  const { data } = await supabase.rpc("is_assigned_to_project", {
    p_project_id: projectId,
  });
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// CREATE — insert a new base or project-scoped shift.
// ---------------------------------------------------------------------------
export const createWorkShiftAction = withSecureAction({
  schema: createWorkShiftSchema,
  resource: "work_shift",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "work_shifts",
  resolveAttributes: async (input, ctx) => ({
    tenantId: ctx.actor.tenantId,
    projectId: input.project_id ?? undefined,
    isActiveAssignment: await resolveAssignmentAttribute(input.project_id),
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const durationInterval = `${input.duration_hours} hours`;

    // PM/SPV are not allowed to set `shift_allowance` — force to 0 and
    // let the DB trigger `work_shifts_guard_allowance` inherit from
    // the base row (if any). HR/OM keep whatever they sent.
    const isHrOm = HR_OM_ROLES.includes(ctx.actor.role);
    const allowance = isHrOm ? (input.shift_allowance_idr ?? 0) : 0;

    const { data: inserted, error } = await supabase
      .from("work_shifts")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id ?? null,
        code: input.code,
        name: input.name.trim(),
        start_time: `${input.start_time}:00`,
        end_time: `${input.end_time}:00`,
        duration: durationInterval,
        shift_allowance: allowance,
        is_night: input.is_night,
      })
      .select("id, code, project_id, shift_allowance")
      .single();
    if (error || !inserted) {
      throw new Error(error?.message ?? "Failed to create shift.");
    }

    revalidatePath("/hr/shifts");
    revalidatePath("/hr/roster");
    if (inserted.project_id) {
      revalidatePath(`/projects/${inserted.project_id}`);
    }
    return {
      result: {
        id: inserted.id,
        code: inserted.code,
        projectId: inserted.project_id,
      },
      auditResourceId: inserted.id,
      auditNewValues: {
        code: inserted.code,
        project_id: inserted.project_id,
        duration_hours: input.duration_hours,
        shift_allowance_idr: Number(inserted.shift_allowance ?? 0),
        is_night: input.is_night,
        is_base_catalog: inserted.project_id === null,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// UPDATE — mutate an existing shift. `project_id` cannot be moved
// between scopes (a base row stays base, a project row stays in the
// same project). Attempts to relocate raise a validation error.
// ---------------------------------------------------------------------------
export const updateWorkShiftAction = withSecureAction({
  schema: updateWorkShiftSchema,
  resource: "work_shift",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "work_shifts",
  resolveAttributes: async (input, ctx) => {
    // Look up existing row to derive projectId + assignment attribute.
    // We use the ADMIN client would be overkill — the current
    // authenticated client already sees the row via SELECT policy
    // `work_shifts_tenant_read`.
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("work_shifts")
      .select("project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    const projectId = row?.project_id ?? input.project_id ?? null;
    return {
      tenantId: ctx.actor.tenantId,
      projectId: projectId ?? undefined,
      isActiveAssignment: await resolveAssignmentAttribute(projectId),
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: existing, error: readErr } = await supabase
      .from("work_shifts")
      .select("id, project_id, code, name, shift_allowance, is_night")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (readErr || !existing) {
      throw new Error("Shift not found.");
    }

    // Prevent scope migration between base ⇄ project. A project's
    // custom "DAY" cannot be promoted into the tenant base catalog
    // via `update` — that would circumvent HR ownership.
    const incomingProject = input.project_id ?? null;
    if ((existing.project_id ?? null) !== incomingProject) {
      throw new Error(
        "Cannot change a shift's scope. Delete and recreate instead.",
      );
    }

    const durationInterval = `${input.duration_hours} hours`;
    const isHrOm = HR_OM_ROLES.includes(ctx.actor.role);
    // Keep existing allowance when a non-HR editor updates — trigger
    // will re-inherit from base if base allowance changes later.
    const allowance = isHrOm
      ? (input.shift_allowance_idr ?? 0)
      : Number(existing.shift_allowance ?? 0);

    const { data: updated, error } = await supabase
      .from("work_shifts")
      .update({
        code: input.code,
        name: input.name.trim(),
        start_time: `${input.start_time}:00`,
        end_time: `${input.end_time}:00`,
        duration: durationInterval,
        shift_allowance: allowance,
        is_night: input.is_night,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .select("id, code, project_id, shift_allowance")
      .single();
    if (error || !updated) {
      throw new Error(error?.message ?? "Failed to update shift.");
    }

    revalidatePath("/hr/shifts");
    revalidatePath("/hr/roster");
    if (updated.project_id) {
      revalidatePath(`/projects/${updated.project_id}`);
    }
    return {
      result: {
        id: updated.id,
        code: updated.code,
        projectId: updated.project_id,
      },
      auditResourceId: updated.id,
      auditOldValues: {
        code: existing.code,
        name: existing.name,
        shift_allowance_idr: Number(existing.shift_allowance ?? 0),
        is_night: existing.is_night,
      },
      auditNewValues: {
        code: updated.code,
        name: input.name.trim(),
        shift_allowance_idr: Number(updated.shift_allowance ?? 0),
        is_night: input.is_night,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// DELETE — remove a shift. Blocked automatically at the DB level if any
// roster / timesheet references it (FK `on delete restrict`). We wrap
// the error into a friendlier message for the UI.
// ---------------------------------------------------------------------------
export const deleteWorkShiftAction = withSecureAction({
  schema: deleteWorkShiftSchema,
  resource: "work_shift",
  action: "delete",
  auditAction: "DELETE",
  auditResourceName: "work_shifts",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: row } = await supabase
      .from("work_shifts")
      .select("project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    const projectId = row?.project_id ?? null;
    return {
      tenantId: ctx.actor.tenantId,
      projectId: projectId ?? undefined,
      isActiveAssignment: await resolveAssignmentAttribute(projectId),
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("work_shifts")
      .select("id, code, project_id, name")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (!existing) throw new Error("Shift not found.");

    const { error } = await supabase
      .from("work_shifts")
      .delete()
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) {
      // Foreign key violation — shift still in use.
      if (
        error.code === "23503" ||
        /foreign key/iu.test(error.message)
      ) {
        throw new Error(
          "This shift is still in use by a roster or timesheet. Deactivate it instead.",
        );
      }
      throw new Error(error.message);
    }

    revalidatePath("/hr/shifts");
    revalidatePath("/hr/roster");
    if (existing.project_id) {
      revalidatePath(`/projects/${existing.project_id}`);
    }
    return {
      result: { id: existing.id },
      auditResourceId: existing.id,
      auditOldValues: {
        code: existing.code,
        name: existing.name,
        project_id: existing.project_id,
      },
    };
  },
});
