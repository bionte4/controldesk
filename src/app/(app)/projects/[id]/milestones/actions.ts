"use server";

import { revalidatePath } from "next/cache";

import { withCanonicalSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import {
  remainingWeightBps,
  weightFitsBudget,
} from "@/lib/milestones/state";
import {
  createMilestoneSchema,
  deleteMilestoneSchema,
  setMilestoneStatusSchema,
  updateMilestoneSchema,
} from "@/lib/validation/milestone";
import type { MilestoneStatus, TablesUpdate } from "@/types/database";

// ---------------------------------------------------------------------------
// Shared helper — load current milestone weight totals for a project so we
// can validate the weight budget (Σ weight_bps ≤ 10 000) in-app before the
// DB check constraint runs.
// ---------------------------------------------------------------------------
async function loadProjectMilestoneWeights(
  projectId: string,
  tenantId: string,
  excludeId?: string,
): Promise<{ weight_bps: number }[]> {
  const supabase = await createClient();
  let query = supabase
    .from("project_milestones")
    .select("id, weight_bps")
    .eq("project_id", projectId)
    .eq("tenant_id", tenantId);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query;
  return (data ?? []).map((row) => ({ weight_bps: row.weight_bps }));
}

// ---------------------------------------------------------------------------
// CREATE — add a new milestone to a project.
// ---------------------------------------------------------------------------
export const createMilestoneAction = withCanonicalSecureAction({
  schema: createMilestoneSchema,
  resource: "project_milestone",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "project_milestones",
  resolveAttributes: (input, ctx) => ({
    tenantId: ctx.actor.tenantId,
    projectId: input.project_id,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const existing = await loadProjectMilestoneWeights(
      input.project_id,
      ctx.actor.tenantId,
    );
    if (!weightFitsBudget(existing, input.weight_bps)) {
      const remaining = remainingWeightBps(existing, 0);
      throw new Error(
        `Weight budget exceeded. Remaining capacity: ${remaining} bps (${(
          remaining / 100
        ).toFixed(2)}%).`,
      );
    }

    const { data: inserted, error } = await supabase
      .from("project_milestones")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id,
        seq: input.seq,
        name: input.name,
        description: input.description ?? null,
        weight_bps: input.weight_bps,
        planned_start_date: input.planned_start_date ?? null,
        planned_end_date: input.planned_end_date ?? null,
        owner_employee_id: input.owner_employee_id ?? null,
        status: "PLANNED",
        created_by: ctx.actor.employeeId,
      })
      .select("id, seq, name, weight_bps")
      .single();
    if (error || !inserted) {
      throw new Error(error?.message ?? "Failed to create milestone.");
    }

    revalidatePath(`/projects/${input.project_id}`);

    return {
      result: {
        id: inserted.id,
        seq: inserted.seq,
        weight_bps: inserted.weight_bps,
      },
      auditResourceId: inserted.id,
      auditNewValues: {
        project_id: input.project_id,
        seq: inserted.seq,
        name: inserted.name,
        weight_bps: inserted.weight_bps,
        status: "PLANNED",
      },
    };
  },
});

// ---------------------------------------------------------------------------
// UPDATE — partial. Weight edits re-check the budget (excluding self).
// ---------------------------------------------------------------------------
export const updateMilestoneAction = withCanonicalSecureAction({
  schema: updateMilestoneSchema,
  resource: "project_milestone",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_milestones",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("project_milestones")
      .select("project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: data?.project_id,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("project_milestones")
      .select("*")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Milestone not found.");

    if (input.weight_bps !== undefined && input.weight_bps !== current.weight_bps) {
      const existing = await loadProjectMilestoneWeights(
        current.project_id,
        ctx.actor.tenantId,
        input.id,
      );
      if (!weightFitsBudget(existing, input.weight_bps)) {
        const remaining = remainingWeightBps(existing, 0);
        throw new Error(
          `Weight budget exceeded. Remaining capacity: ${remaining} bps (${(
            remaining / 100
          ).toFixed(2)}%).`,
        );
      }
    }

    const patch: TablesUpdate<"project_milestones"> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined)
      patch.description = input.description ?? null;
    if (input.weight_bps !== undefined) patch.weight_bps = input.weight_bps;
    if (input.planned_start_date !== undefined)
      patch.planned_start_date = input.planned_start_date;
    if (input.planned_end_date !== undefined)
      patch.planned_end_date = input.planned_end_date;
    if (input.owner_employee_id !== undefined)
      patch.owner_employee_id = input.owner_employee_id;
    if (input.seq !== undefined) patch.seq = input.seq;

    const { error: updateErr } = await supabase
      .from("project_milestones")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    revalidatePath(`/projects/${current.project_id}`);

    return {
      result: { id: input.id },
      auditResourceId: input.id,
      auditOldValues: {
        name: current.name,
        weight_bps: current.weight_bps,
        seq: current.seq,
        status: current.status,
      },
      auditNewValues: patch as Record<string, unknown>,
    };
  },
});

// ---------------------------------------------------------------------------
// SET STATUS — quick status transition (dashboard "mark done" button etc.).
// Stamps `actual_start_date` when moving into IN_PROGRESS if not set, and
// `actual_end_date` on DONE if not provided.
// ---------------------------------------------------------------------------
export const setMilestoneStatusAction = withCanonicalSecureAction({
  schema: setMilestoneStatusSchema,
  resource: "project_milestone",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_milestones",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("project_milestones")
      .select("project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: data?.project_id,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("project_milestones")
      .select(
        "id, project_id, status, actual_start_date, actual_end_date",
      )
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Milestone not found.");

    const patch: TablesUpdate<"project_milestones"> = {
      status: input.status as MilestoneStatus,
    };

    const today = new Date().toISOString().slice(0, 10);
    if (
      input.status === "IN_PROGRESS" &&
      !current.actual_start_date &&
      !input.actual_start_date
    ) {
      patch.actual_start_date = today;
    }
    if (input.actual_start_date !== undefined) {
      patch.actual_start_date = input.actual_start_date;
    }
    if (
      input.status === "DONE" &&
      !current.actual_end_date &&
      !input.actual_end_date
    ) {
      patch.actual_end_date = today;
      if (!current.actual_start_date && !patch.actual_start_date) {
        // If a milestone jumps straight to DONE we still need a start date
        // for the reporting duration to make sense.
        patch.actual_start_date = today;
      }
    }
    if (input.actual_end_date !== undefined) {
      patch.actual_end_date = input.actual_end_date;
    }

    const { error: updateErr } = await supabase
      .from("project_milestones")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    revalidatePath(`/projects/${current.project_id}`);

    return {
      result: { id: input.id, status: input.status },
      auditResourceId: input.id,
      auditOldValues: { status: current.status },
      auditNewValues: patch as Record<string, unknown>,
    };
  },
});

// ---------------------------------------------------------------------------
// DELETE — remove a milestone. Progress rollup trigger fires automatically.
// ---------------------------------------------------------------------------
export const deleteMilestoneAction = withCanonicalSecureAction({
  schema: deleteMilestoneSchema,
  resource: "project_milestone",
  action: "delete",
  auditAction: "DELETE",
  auditResourceName: "project_milestones",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("project_milestones")
      .select("project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return {
      tenantId: ctx.actor.tenantId,
      projectId: data?.project_id,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("project_milestones")
      .select("id, project_id, seq, name, weight_bps, status")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Milestone not found.");

    const { error } = await supabase
      .from("project_milestones")
      .delete()
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    revalidatePath(`/projects/${current.project_id}`);

    return {
      result: { id: input.id },
      auditResourceId: input.id,
      auditOldValues: {
        project_id: current.project_id,
        seq: current.seq,
        name: current.name,
        weight_bps: current.weight_bps,
        status: current.status,
      },
    };
  },
});
