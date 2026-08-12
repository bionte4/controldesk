"use server";

import { revalidatePath } from "next/cache";

import { withCanonicalSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import {
  createTaskSchema,
  deleteTaskSchema,
  reorderTaskSchema,
  setTaskProgressSchema,
  setTaskStatusSchema,
  updateTaskSchema,
} from "@/lib/validation/task";
import type { TablesUpdate, TaskStatus } from "@/types/database";

// ---------------------------------------------------------------------------
// Helper — resolve the max sort_order among siblings so a new task is
// appended (client can also pass explicit `sort_order` to insert in-between).
// ---------------------------------------------------------------------------
async function nextSortOrder(
  projectId: string,
  tenantId: string,
  parentTaskId: string | null,
): Promise<number> {
  const supabase = await createClient();
  let query = supabase
    .from("project_tasks")
    .select("sort_order")
    .eq("project_id", projectId)
    .eq("tenant_id", tenantId);
  query = parentTaskId
    ? query.eq("parent_task_id", parentTaskId)
    : query.is("parent_task_id", null);
  const { data } = await query.order("sort_order", { ascending: false }).limit(1);
  const max = data?.[0]?.sort_order ?? -1;
  return max + 1;
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------
export const createTaskAction = withCanonicalSecureAction({
  schema: createTaskSchema,
  resource: "project_task",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "project_tasks",
  resolveAttributes: (input, ctx) => ({
    tenantId: ctx.actor.tenantId,
    projectId: input.project_id,
  }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const parentId = input.parent_task_id ?? null;
    const sortOrder =
      input.sort_order ??
      (await nextSortOrder(input.project_id, ctx.actor.tenantId, parentId));

    const { data: inserted, error } = await supabase
      .from("project_tasks")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id,
        parent_task_id: parentId,
        milestone_id: input.milestone_id ?? null,
        depends_on_task_id: input.depends_on_task_id ?? null,
        sort_order: sortOrder,
        name: input.name,
        description: input.description ?? null,
        status: input.status ?? "TODO",
        progress_pct: input.progress_pct ?? 0,
        weight_pct: input.weight_pct ?? 0,
        planned_start_date: input.planned_start_date ?? null,
        planned_end_date: input.planned_end_date ?? null,
        owner_employee_id: input.owner_employee_id ?? null,
        budget_amount: input.budget_amount ?? null,
        created_by: ctx.actor.employeeId,
      })
      .select("id, name, sort_order, parent_task_id, milestone_id")
      .single();

    if (error || !inserted) {
      throw new Error(error?.message ?? "Failed to create task.");
    }

    revalidatePath(`/projects/${input.project_id}`);

    return {
      result: {
        id: inserted.id,
        name: inserted.name,
        sort_order: inserted.sort_order,
      },
      auditResourceId: inserted.id,
      auditNewValues: {
        project_id: input.project_id,
        parent_task_id: inserted.parent_task_id,
        milestone_id: inserted.milestone_id,
        name: inserted.name,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------
export const updateTaskAction = withCanonicalSecureAction({
  schema: updateTaskSchema,
  resource: "project_task",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_tasks",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("project_tasks")
      .select("project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return { tenantId: ctx.actor.tenantId, projectId: data?.project_id };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("project_tasks")
      .select("*")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Task not found.");

    const patch: TablesUpdate<"project_tasks"> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined)
      patch.description = input.description ?? null;
    if (input.milestone_id !== undefined)
      patch.milestone_id = input.milestone_id ?? null;
    if (input.depends_on_task_id !== undefined)
      patch.depends_on_task_id = input.depends_on_task_id ?? null;
    if (input.progress_pct !== undefined) patch.progress_pct = input.progress_pct;
    if (input.weight_pct !== undefined) patch.weight_pct = input.weight_pct;
    if (input.planned_start_date !== undefined)
      patch.planned_start_date = input.planned_start_date;
    if (input.planned_end_date !== undefined)
      patch.planned_end_date = input.planned_end_date;
    if (input.actual_start_date !== undefined)
      patch.actual_start_date = input.actual_start_date;
    if (input.actual_end_date !== undefined)
      patch.actual_end_date = input.actual_end_date;
    if (input.owner_employee_id !== undefined)
      patch.owner_employee_id = input.owner_employee_id ?? null;
    if (input.budget_amount !== undefined)
      patch.budget_amount = input.budget_amount ?? null;

    const { error: updErr } = await supabase
      .from("project_tasks")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updErr) throw new Error(updErr.message);

    revalidatePath(`/projects/${current.project_id}`);

    return {
      result: { id: input.id },
      auditResourceId: input.id,
      auditOldValues: {
        name: current.name,
        progress_pct: current.progress_pct,
        status: current.status,
      },
      auditNewValues: patch as Record<string, unknown>,
    };
  },
});

// ---------------------------------------------------------------------------
// SET STATUS — auto-stamps actual_start_date on entering IN_PROGRESS and
// actual_end_date on entering DONE (if not already set).
// ---------------------------------------------------------------------------
export const setTaskStatusAction = withCanonicalSecureAction({
  schema: setTaskStatusSchema,
  resource: "project_task",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_tasks",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("project_tasks")
      .select("project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return { tenantId: ctx.actor.tenantId, projectId: data?.project_id };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("project_tasks")
      .select(
        "id, project_id, status, actual_start_date, actual_end_date, progress_pct",
      )
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Task not found.");

    const today = new Date().toISOString().slice(0, 10);
    const patch: TablesUpdate<"project_tasks"> = {
      status: input.status as TaskStatus,
    };

    if (input.status === "IN_PROGRESS" && !current.actual_start_date) {
      patch.actual_start_date = today;
    }
    if (input.status === "DONE") {
      if (!current.actual_end_date) patch.actual_end_date = today;
      if (!current.actual_start_date && !patch.actual_start_date) {
        patch.actual_start_date = today;
      }
      // Full completion — set progress to 100 unless caller has been managing it.
      if (current.progress_pct < 100) patch.progress_pct = 100;
    }

    const { error: updErr } = await supabase
      .from("project_tasks")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updErr) throw new Error(updErr.message);

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
// SET PROGRESS — quick slider. Auto-transitions status:
//   0 → >0        : TODO → IN_PROGRESS
//   any → 100     : → DONE
// ---------------------------------------------------------------------------
export const setTaskProgressAction = withCanonicalSecureAction({
  schema: setTaskProgressSchema,
  resource: "project_task",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_tasks",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("project_tasks")
      .select("project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return { tenantId: ctx.actor.tenantId, projectId: data?.project_id };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readErr } = await supabase
      .from("project_tasks")
      .select("id, project_id, status, progress_pct, actual_start_date, actual_end_date")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Task not found.");

    const today = new Date().toISOString().slice(0, 10);
    const patch: TablesUpdate<"project_tasks"> = {
      progress_pct: input.progress_pct,
    };

    if (input.progress_pct === 100 && current.status !== "DONE") {
      patch.status = "DONE";
      if (!current.actual_end_date) patch.actual_end_date = today;
      if (!current.actual_start_date) patch.actual_start_date = today;
    } else if (
      input.progress_pct > 0 &&
      current.progress_pct === 0 &&
      current.status === "TODO"
    ) {
      patch.status = "IN_PROGRESS";
      if (!current.actual_start_date) patch.actual_start_date = today;
    }

    const { error: updErr } = await supabase
      .from("project_tasks")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updErr) throw new Error(updErr.message);

    revalidatePath(`/projects/${current.project_id}`);

    return {
      result: { id: input.id, progress_pct: input.progress_pct },
      auditResourceId: input.id,
      auditOldValues: {
        progress_pct: current.progress_pct,
        status: current.status,
      },
      auditNewValues: patch as Record<string, unknown>,
    };
  },
});

// ---------------------------------------------------------------------------
// REORDER — move to a new parent + sort_order, densifying siblings on both
// sides so we don't accumulate holes.
// ---------------------------------------------------------------------------
export const reorderTaskAction = withCanonicalSecureAction({
  schema: reorderTaskSchema,
  resource: "project_task",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_tasks",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("project_tasks")
      .select("project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return { tenantId: ctx.actor.tenantId, projectId: data?.project_id };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("project_tasks")
      .select("id, project_id, parent_task_id, sort_order")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Task not found.");

    const targetParent =
      input.new_parent_task_id === undefined
        ? current.parent_task_id
        : input.new_parent_task_id;

    // Guard against making the node its own descendant.
    if (targetParent) {
      // Walk the ancestor chain of `targetParent`; if we hit `input.id`,
      // this would create a cycle.
      let cursor: string | null = targetParent;
      const guard = new Set<string>();
      while (cursor && !guard.has(cursor)) {
        guard.add(cursor);
        if (cursor === input.id) {
          throw new Error("Cannot move a task under its own descendant.");
        }
        const cursorId: string = cursor;
        const parentQ = await supabase
          .from("project_tasks")
          .select("parent_task_id")
          .eq("id", cursorId)
          .eq("tenant_id", ctx.actor.tenantId)
          .maybeSingle();
        cursor = parentQ.data?.parent_task_id ?? null;
      }
    }

    // Load target siblings (excluding the moving row) and reinsert dense.
    let siblingsQ = supabase
      .from("project_tasks")
      .select("id, sort_order")
      .eq("project_id", current.project_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .neq("id", input.id);
    siblingsQ = targetParent
      ? siblingsQ.eq("parent_task_id", targetParent)
      : siblingsQ.is("parent_task_id", null);
    const { data: siblings } = await siblingsQ.order("sort_order", {
      ascending: true,
    });

    const ordered = (siblings ?? []).slice();
    const insertAt = Math.max(
      0,
      Math.min(input.new_sort_order, ordered.length),
    );
    ordered.splice(insertAt, 0, { id: input.id, sort_order: -1 });

    // Densify sort_order using a single UPDATE per row (small trees).
    for (let idx = 0; idx < ordered.length; idx++) {
      const row = ordered[idx];
      const patch: TablesUpdate<"project_tasks"> = { sort_order: idx };
      if (row.id === input.id) patch.parent_task_id = targetParent;
      const { error } = await supabase
        .from("project_tasks")
        .update(patch)
        .eq("id", row.id)
        .eq("tenant_id", ctx.actor.tenantId);
      if (error) throw new Error(error.message);
    }

    revalidatePath(`/projects/${current.project_id}`);

    return {
      result: { id: input.id },
      auditResourceId: input.id,
      auditOldValues: {
        parent_task_id: current.parent_task_id,
        sort_order: current.sort_order,
      },
      auditNewValues: {
        parent_task_id: targetParent,
        sort_order: insertAt,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// DELETE — cascade via FK ON DELETE CASCADE, so children go with the parent.
// ---------------------------------------------------------------------------
export const deleteTaskAction = withCanonicalSecureAction({
  schema: deleteTaskSchema,
  resource: "project_task",
  action: "delete",
  auditAction: "DELETE",
  auditResourceName: "project_tasks",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("project_tasks")
      .select("project_id")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    return { tenantId: ctx.actor.tenantId, projectId: data?.project_id };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: current, error: readErr } = await supabase
      .from("project_tasks")
      .select("id, project_id, name, parent_task_id, milestone_id, status")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !current) throw new Error("Task not found.");

    const { error } = await supabase
      .from("project_tasks")
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
        parent_task_id: current.parent_task_id,
        milestone_id: current.milestone_id,
        name: current.name,
        status: current.status,
      },
    };
  },
});
