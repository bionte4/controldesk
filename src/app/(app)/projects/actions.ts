"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { moneyToDbString } from "@/lib/format/money";
import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/types/database";
import {
  createProjectSchema,
  updateProjectSchema,
  upsertProjectBudgetSchema,
  createPmAssignmentSchema,
  createEmployeeAssignmentSchema,
  type CreateProjectInput,
} from "@/lib/validation/project";

/**
 * Create a new project (rules §7). PDP: OM+ / TENANT_ADMIN.
 *
 * If `budget_amount_idr` is passed via `?_budget` extension in a future
 * revision, this could upsert budgets in the same transaction. v1 keeps
 * budgets as a separate action for auditability.
 */
export const createProjectAction = withSecureAction({
  schema: createProjectSchema,
  resource: "project",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "projects",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input: CreateProjectInput, ctx) => {
    const supabase = await createClient();

    // Validate the target client belongs to the same tenant. RLS already
    // guards this — this SELECT surfaces a friendlier error than a raw
    // 42501 exception.
    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id")
      .eq("id", input.client_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (clientErr || !client) {
      throw new Error("Selected client is invalid for this tenant.");
    }

    const { data, error } = await supabase
      .from("projects")
      .insert({
        tenant_id: ctx.actor.tenantId,
        client_id: input.client_id,
        contract_id: input.contract_id ?? null,
        code: input.code.toUpperCase(),
        name: input.name,
        description: input.description ?? null,
        status: input.status,
        start_date: input.start_date ?? null,
        end_date: input.end_date ?? null,
      })
      .select("id, code, name, status")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to create project.");
    }

    revalidatePath("/projects");
    revalidatePath(`/clients/${input.client_id}`);

    return {
      result: {
        id: data.id,
        code: data.code,
        name: data.name,
        status: data.status,
      },
      auditResourceId: data.id,
      auditNewValues: {
        code: data.code,
        name: data.name,
        status: data.status,
      },
    };
  },
});

/**
 * Update an existing project (rules §7).
 */
export const updateProjectAction = withSecureAction({
  schema: updateProjectSchema,
  resource: "project",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "projects",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: existing, error: readErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !existing) throw new Error("Project not found.");

    const patch: TablesUpdate<"projects"> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined)
      patch.description = input.description ?? null;
    if (input.status !== undefined) patch.status = input.status;
    if (input.start_date !== undefined)
      patch.start_date = input.start_date ?? null;
    if (input.end_date !== undefined) patch.end_date = input.end_date ?? null;

    const { data, error } = await supabase
      .from("projects")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .select("id, code, name, status")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Update failed.");

    revalidatePath("/projects");
    revalidatePath(`/projects/${data.id}`);

    return {
      result: { id: data.id, code: data.code, name: data.name, status: data.status },
      auditResourceId: data.id,
      auditOldValues: {
        name: existing.name,
        status: existing.status,
      },
      auditNewValues: {
        name: data.name,
        status: data.status,
      },
    };
  },
});

/**
 * Upsert a project budget (rules §7 / §9). Amount stored as bigint (rupiah).
 */
export const upsertProjectBudgetAction = withSecureAction({
  schema: upsertProjectBudgetSchema,
  resource: "project_budget",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_budgets",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const dbAmount = moneyToDbString(BigInt(input.budget_amount_idr));

    const { data, error } = await supabase
      .from("project_budgets")
      .upsert(
        {
          tenant_id: ctx.actor.tenantId,
          project_id: input.project_id,
          // Supabase types generator now maps `numeric(18,2)` to `number`;
          // we pass the fixed-point string so we do not truncate cents.
          budget_amount: dbAmount as unknown as number,
        },
        { onConflict: "project_id" },
      )
      .select("project_id, budget_amount, spent_amount")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Budget upsert failed.");

    revalidatePath(`/projects/${input.project_id}`);
    revalidatePath("/projects");

    return {
      result: data,
      auditResourceId: input.project_id,
      auditNewValues: { budget_amount: data.budget_amount },
    };
  },
});

/**
 * Assign a PM to a project (rules §5).
 */
export const createPmAssignmentAction = withSecureAction({
  schema: createPmAssignmentSchema,
  resource: "project_pm_assignment",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "project_pm_assignments",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_pm_assignments")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id,
        pm_employee_id: input.pm_employee_id,
        assignment_role: input.assignment_role,
        status: "ACTIVE",
        created_by: ctx.actor.employeeId,
      })
      .select("id, project_id, pm_employee_id, assignment_role")
      .single();
    if (error || !data)
      throw new Error(error?.message ?? "PM assignment failed.");

    revalidatePath(`/projects/${input.project_id}`);
    return {
      result: data,
      auditResourceId: data.id,
      auditNewValues: data,
    };
  },
});

/**
 * Assign an employee to a project (rules §5). DB trigger enforces the
 * 100% total-allocation ceiling.
 */
export const createEmployeeAssignmentAction = withSecureAction({
  schema: createEmployeeAssignmentSchema,
  resource: "project_employee_assignment",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "project_employee_assignments",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_employee_assignments")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id,
        employee_id: input.employee_id,
        allocation_percentage: input.allocation_percentage,
        status: "ACTIVE",
        created_by: ctx.actor.employeeId,
      })
      .select("id, project_id, employee_id, allocation_percentage")
      .single();
    if (error || !data) {
      // The DB trigger's exception message is friendly enough to surface.
      throw new Error(error?.message ?? "Employee assignment failed.");
    }
    revalidatePath(`/projects/${input.project_id}`);
    return {
      result: data,
      auditResourceId: data.id,
      auditNewValues: data,
    };
  },
});
