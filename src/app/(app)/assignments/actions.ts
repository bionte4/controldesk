"use server";

import { revalidatePath } from "next/cache";

import {
  withSecureAction,
  type ActionResult,
} from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import {
  createAssignmentSchema,
  endAssignmentSchema,
  isPmRole,
  parseAllocationOverCap,
  updateAssignmentSchema,
  type CreateAssignmentInput,
  type EndAssignmentInput,
  type UpdateAssignmentInput,
} from "@/lib/validation/assignment";

type AssignmentResult = { id: string; kind: "pm" | "member" };
type AssignmentEndResult = AssignmentResult & { ended_at: string };

/**
 * Unified Server Actions for the Assignments module (rules §7).
 *
 * Routing logic:
 *   - `role` in {PRIMARY_PM, CO_PM} → `project_pm_assignments`.
 *   - all other roles → `project_employee_assignments`.
 *
 * Guarantees:
 *   - Every mutation goes through `withSecureAction` (PDP + audit).
 *   - Employee-member creations do a PRE-FLIGHT sum-of-active check so we
 *     surface a friendly `ActionResult` reason before hitting the trigger.
 *   - The DB trigger still runs as the last-line guard.
 *   - PM creations check for an existing ACTIVE PRIMARY_PM on the project
 *     to avoid a raw duplicate-key error.
 *   - After every mutation we revalidate `/assignments` and the affected
 *     `/projects/{id}` page.
 */

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

/**
 * The unified `createAssignmentAction` dispatches to one of two wrapped
 * actions based on the role — each with its own PDP resource key so the
 * PDP decision matches the RLS policy on the target table (rules §7).
 */
export async function createAssignmentAction(
  rawInput: unknown,
): Promise<ActionResult<AssignmentResult>> {
  // Peek at role BEFORE full validation — the Zod schema handles bad
  // inputs, but we need the role now to pick the wrapper. Both wrappers
  // also run the schema, so validation errors still surface consistently.
  const role =
    typeof rawInput === "object" && rawInput && "role" in rawInput
      ? (rawInput as { role: string }).role
      : "";
  const pmPath =
    typeof role === "string" &&
    (role === "PRIMARY_PM" || role === "CO_PM");

  return pmPath
    ? createPmAssignmentWrapped(rawInput)
    : createMemberAssignmentWrapped(rawInput);
}

const createPmAssignmentWrapped = withSecureAction<
  typeof createAssignmentSchema,
  AssignmentResult
>({
  schema: createAssignmentSchema,
  resource: "project_pm_assignment",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "project_pm_assignments",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input: CreateAssignmentInput, ctx) => {
    const supabase = await createClient();
    if (!isPmRole(input.role)) {
      throw new Error("Wrong wrapper: expected PM role.");
    }

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, tenant_id, name, code, project_number")
      .eq("id", input.project_id)
      .maybeSingle();
    if (projErr) throw new Error(projErr.message);
    if (!project) throw new Error("Project not found or not accessible.");

    const { data: employee, error: empErr } = await supabase
      .from("employees")
      .select("id, tenant_id, full_name")
      .eq("id", input.employee_id)
      .maybeSingle();
    if (empErr) throw new Error(empErr.message);
    if (!employee) throw new Error("Employee not found or not accessible.");

    const pmRole = input.role;
    if (pmRole === "PRIMARY_PM") {
      const { data: existingPrimary } = await supabase
        .from("project_pm_assignments")
        .select("id, pm_employee_id")
        .eq("project_id", input.project_id)
        .eq("status", "ACTIVE")
        .eq("assignment_role", "PRIMARY_PM")
        .maybeSingle();
      if (existingPrimary) {
        throw new Error(
          "This project already has an active Primary PM. End the current assignment first or add a Co-PM instead.",
        );
      }
    }

    const { data, error } = await supabase
      .from("project_pm_assignments")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id,
        pm_employee_id: input.employee_id,
        assignment_role: pmRole,
        status: "ACTIVE",
        started_at: input.started_at,
        ended_at: input.ended_at ?? null,
        notes: input.notes ?? null,
        created_by: ctx.actor.employeeId,
      })
      .select("id, project_id, pm_employee_id, assignment_role")
      .single();
    if (error || !data) throw new Error(error?.message ?? "PM assignment failed.");

    revalidatePath("/assignments");
    revalidatePath(`/projects/${input.project_id}`);

    void employee;

    return {
      result: { id: data.id, kind: "pm" },
      auditResourceId: data.id,
      auditNewValues: {
        project_id: data.project_id,
        pm_employee_id: data.pm_employee_id,
        assignment_role: data.assignment_role,
        notes: input.notes ?? null,
      },
    };
  },
});

const createMemberAssignmentWrapped = withSecureAction<
  typeof createAssignmentSchema,
  AssignmentResult
>({
  schema: createAssignmentSchema,
  resource: "project_employee_assignment",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "project_employee_assignments",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input: CreateAssignmentInput, ctx) => {
    const supabase = await createClient();
    if (isPmRole(input.role)) {
      throw new Error("Wrong wrapper: PM role should use PM path.");
    }
    const memberRole = input.role;

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id, tenant_id, name")
      .eq("id", input.project_id)
      .maybeSingle();
    if (projErr) throw new Error(projErr.message);
    if (!project) throw new Error("Project not found or not accessible.");

    const { data: employee, error: empErr } = await supabase
      .from("employees")
      .select("id, tenant_id, full_name")
      .eq("id", input.employee_id)
      .maybeSingle();
    if (empErr) throw new Error(empErr.message);
    if (!employee) throw new Error("Employee not found or not accessible.");

    const { data: activeRows, error: activeErr } = await supabase
      .from("project_employee_assignments")
      .select("id, allocation_percentage, role, project_id")
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("employee_id", input.employee_id)
      .eq("status", "ACTIVE");
    if (activeErr) throw new Error(activeErr.message);

    const dupe = activeRows?.find(
      (r) => r.project_id === input.project_id && r.role === memberRole,
    );
    if (dupe) {
      throw new Error(
        "This employee already has an active assignment on this project in the same role. End it first before creating a new one.",
      );
    }

    const currentTotal = (activeRows ?? []).reduce(
      (sum, r) => sum + (r.allocation_percentage ?? 0),
      0,
    );
    if (currentTotal + input.allocation_percentage > 100) {
      const remaining = Math.max(0, 100 - currentTotal);
      throw new Error(
        `Over-allocation: ${employee.full_name} is already at ${currentTotal}%. Only ${remaining}% remaining — reduce the requested allocation or end an existing assignment.`,
      );
    }

    const { data, error } = await supabase
      .from("project_employee_assignments")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id,
        employee_id: input.employee_id,
        role: memberRole,
        allocation_percentage: input.allocation_percentage,
        status: "ACTIVE",
        started_at: input.started_at,
        ended_at: input.ended_at ?? null,
        notes: input.notes ?? null,
        created_by: ctx.actor.employeeId,
      })
      .select("id, project_id, employee_id, role, allocation_percentage")
      .single();

    if (error || !data) {
      const overCap = parseAllocationOverCap(error?.message);
      if (overCap) {
        const remaining = Math.max(0, 100 - overCap.currentTotalPct);
        throw new Error(
          `Over-allocation (trigger): current ${overCap.currentTotalPct}%, only ${remaining}% remaining.`,
        );
      }
      throw new Error(error?.message ?? "Employee assignment failed.");
    }

    revalidatePath("/assignments");
    revalidatePath(`/projects/${input.project_id}`);

    return {
      result: { id: data.id, kind: "member" },
      auditResourceId: data.id,
      auditNewValues: {
        project_id: data.project_id,
        employee_id: data.employee_id,
        role: data.role,
        allocation_percentage: data.allocation_percentage,
        notes: input.notes ?? null,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// UPDATE — only allocation, dates, notes. Role changes require end+create.
// ---------------------------------------------------------------------------

export const updateAssignmentAction = withSecureAction<
  typeof updateAssignmentSchema,
  AssignmentResult
>({
  schema: updateAssignmentSchema,
  resource: "project_employee_assignment",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_employee_assignments",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input: UpdateAssignmentInput, ctx) => {
    const supabase = await createClient();

    if (input.kind === "pm") {
      const { data: current, error: readErr } = await supabase
        .from("project_pm_assignments")
        .select("*")
        .eq("id", input.id)
        .maybeSingle();
      if (readErr) throw new Error(readErr.message);
      if (!current) throw new Error("Assignment not found or not accessible.");

      const patch: {
        started_at?: string;
        ended_at?: string;
        notes?: string | null;
      } = {};
      if (input.started_at !== undefined) patch.started_at = input.started_at;
      if (input.ended_at !== undefined) patch.ended_at = input.ended_at;
      if (input.notes !== undefined) patch.notes = input.notes;

      if (Object.keys(patch).length === 0) throw new Error("Nothing to update.");

      const { data, error } = await supabase
        .from("project_pm_assignments")
        .update(patch)
        .eq("id", input.id)
        .select()
        .single();
      if (error || !data) throw new Error(error?.message ?? "PM update failed.");

      revalidatePath("/assignments");
      revalidatePath(`/projects/${data.project_id}`);
      return {
        result: { id: data.id, kind: "pm" },
        auditResourceId: data.id,
        auditOldValues: current as unknown as Record<string, unknown>,
        auditNewValues: data as unknown as Record<string, unknown>,
      };
    }

    // Non-PM member path
    const { data: current, error: readErr } = await supabase
      .from("project_employee_assignments")
      .select("*")
      .eq("id", input.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!current) throw new Error("Assignment not found or not accessible.");

    if (input.allocation_percentage !== undefined) {
      const { data: others } = await supabase
        .from("project_employee_assignments")
        .select("id, allocation_percentage")
        .eq("tenant_id", ctx.actor.tenantId)
        .eq("employee_id", current.employee_id)
        .eq("status", "ACTIVE")
        .neq("id", input.id);

      const otherTotal = (others ?? []).reduce(
        (sum, r) => sum + (r.allocation_percentage ?? 0),
        0,
      );
      if (otherTotal + input.allocation_percentage > 100) {
        const remaining = Math.max(0, 100 - otherTotal);
        throw new Error(
          `Over-allocation: only ${remaining}% remaining on this employee. Requested ${input.allocation_percentage}%.`,
        );
      }
    }

    const patch: {
      allocation_percentage?: number;
      started_at?: string;
      ended_at?: string;
      notes?: string | null;
    } = {};
    if (input.allocation_percentage !== undefined) {
      patch.allocation_percentage = input.allocation_percentage;
    }
    if (input.started_at !== undefined) patch.started_at = input.started_at;
    if (input.ended_at !== undefined) patch.ended_at = input.ended_at;
    if (input.notes !== undefined) patch.notes = input.notes;

    if (Object.keys(patch).length === 0) throw new Error("Nothing to update.");

    const { data, error } = await supabase
      .from("project_employee_assignments")
      .update(patch)
      .eq("id", input.id)
      .select()
      .single();
    if (error || !data) {
      const overCap = parseAllocationOverCap(error?.message);
      if (overCap) {
        const remaining = Math.max(0, 100 - overCap.currentTotalPct);
        throw new Error(
          `Over-allocation (trigger): current ${overCap.currentTotalPct}%, only ${remaining}% remaining.`,
        );
      }
      throw new Error(error?.message ?? "Assignment update failed.");
    }

    revalidatePath("/assignments");
    revalidatePath(`/projects/${data.project_id}`);
    return {
      result: { id: data.id, kind: "member" },
      auditResourceId: data.id,
      auditOldValues: current as unknown as Record<string, unknown>,
      auditNewValues: data as unknown as Record<string, unknown>,
    };
  },
});

// ---------------------------------------------------------------------------
// END — flip status to ENDED and record `ended_at`.
// ---------------------------------------------------------------------------

export const endAssignmentAction = withSecureAction<
  typeof endAssignmentSchema,
  AssignmentEndResult
>({
  schema: endAssignmentSchema,
  resource: "project_employee_assignment",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_employee_assignments",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input: EndAssignmentInput, ctx) => {
    void ctx;
    const supabase = await createClient();

    const today = new Date().toISOString().slice(0, 10);
    const endedAt = input.ended_at ?? today;

    if (input.kind === "pm") {
      const { data: current, error: readErr } = await supabase
        .from("project_pm_assignments")
        .select("*")
        .eq("id", input.id)
        .maybeSingle();
      if (readErr) throw new Error(readErr.message);
      if (!current) throw new Error("Assignment not found or not accessible.");

      const { data, error } = await supabase
        .from("project_pm_assignments")
        .update({ status: "ENDED", ended_at: endedAt })
        .eq("id", input.id)
        .select()
        .single();
      if (error || !data) throw new Error(error?.message ?? "End PM assignment failed.");

      revalidatePath("/assignments");
      revalidatePath(`/projects/${data.project_id}`);

      return {
        result: { id: data.id, kind: "pm", ended_at: endedAt },
        auditResourceId: data.id,
        auditOldValues: current as unknown as Record<string, unknown>,
        auditNewValues: data as unknown as Record<string, unknown>,
      };
    }

    const { data: current, error: readErr } = await supabase
      .from("project_employee_assignments")
      .select("*")
      .eq("id", input.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!current) throw new Error("Assignment not found or not accessible.");

    const { data, error } = await supabase
      .from("project_employee_assignments")
      .update({ status: "ENDED", ended_at: endedAt })
      .eq("id", input.id)
      .select()
      .single();
    if (error || !data) throw new Error(error?.message ?? "End assignment failed.");

    revalidatePath("/assignments");
    revalidatePath(`/projects/${data.project_id}`);

    return {
      result: { id: data.id, kind: "member", ended_at: endedAt },
      auditResourceId: data.id,
      auditOldValues: current as unknown as Record<string, unknown>,
      auditNewValues: data as unknown as Record<string, unknown>,
    };
  },
});
