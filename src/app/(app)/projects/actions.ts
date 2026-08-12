"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { moneyToDbString } from "@/lib/format/money";
import {
  enqueueMilestoneCalendarEventsBatch,
  enqueueProjectCalendarEvent,
} from "@/lib/integrations/google-calendar/outbox";
import { log } from "@/lib/observability/log";
import { createClient } from "@/lib/supabase/server";
import type { TablesUpdate } from "@/types/database";
import {
  activateProjectSchema,
  createProjectSchema,
  updateProjectSchema,
  upsertProjectBudgetSchema,
  updateProjectBusinessCaseSchema,
  promoteProjectFromBusinessCaseSchema,
  createPmAssignmentSchema,
  createEmployeeAssignmentSchema,
  type CreateProjectInput,
} from "@/lib/validation/project";
import {
  hasApprovedBudget,
  hasActivePmAssignment,
} from "@/lib/data/projects";

/**
 * Create a new project via the wizard (rules §7). PDP: OM+ / TENANT_ADMIN.
 *
 * Atomic write: project row → optional PM assignment → optional milestones.
 * If any step after the project insert fails, the project row is deleted to
 * keep state consistent (Supabase JS has no first-class transaction; we
 * emulate all-or-nothing with a compensating delete).
 *
 * `code` may be omitted — a DB BEFORE-INSERT trigger auto-generates
 * `project_number = PRJ-{YYYY}-{seq:04}` (migration 0036). The `code`
 * column is legacy short-code and stays user-controlled; when omitted we
 * reuse the auto-generated number so both columns tell the same story.
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

    // Contract value stored in numeric(18,2); PostgREST returns it as
    // `number` per generated types, but we serialise via `moneyToDbString`
    // to preserve cents precision. Cast is safe because the DB column is
    // numeric; the wire encoding is opaque to us.
    const contractValueDb =
      input.contract_value_idr !== undefined && input.contract_value_idr !== null
        ? (moneyToDbString(BigInt(input.contract_value_idr)) as unknown as number)
        : null;

    // Placeholder `code` when caller omits it — the DB trigger will
    // populate `project_number` regardless, and we backfill `code` from
    // `project_number` in a follow-up UPDATE below to keep both aligned.
    // The placeholder must be unique per row because `(tenant_id, code)`
    // has a UNIQUE index — concurrent wizard submissions would otherwise
    // race on a fixed sentinel value.
    const providedCode = input.code?.toUpperCase();
    const tempCode = `TMP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    const { data, error } = await supabase
      .from("projects")
      .insert({
        tenant_id: ctx.actor.tenantId,
        client_id: input.client_id,
        contract_id: input.contract_id ?? null,
        code: providedCode ?? tempCode,
        name: input.name,
        description: input.description ?? null,
        status: input.status,
        priority: input.priority,
        project_type: input.project_type,
        location: input.location ?? null,
        contract_value: contractValueDb,
        currency: input.currency,
        notes: input.notes ?? null,
        sync_calendar: input.sync_calendar,
        start_date: input.start_date ?? null,
        end_date: input.end_date ?? null,
        // Business Case fields (migration 0058). Optional — a fresh
        // project can be born in DRAFT with no BC filled and get its
        // BC edited later via `updateProjectBusinessCaseAction`.
        bc_executive_summary: input.bc_executive_summary ?? null,
        bc_target_gm_pct: input.bc_target_gm_pct ?? null,
        bc_sponsor_id: input.bc_sponsor_id ?? null,
      })
      .select("id, code, name, status, project_number")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to create project.");
    }

    // If caller omitted `code`, mirror the auto-generated `project_number`
    // into `code` so the short-code column stays populated for legacy UIs.
    if (!providedCode && data.project_number) {
      await supabase
        .from("projects")
        .update({ code: data.project_number })
        .eq("id", data.id)
        .eq("tenant_id", ctx.actor.tenantId);
    }

    // Collected inside the atomic block so the calendar outbox enqueue
    // below the try/catch knows which milestone rows just landed. Empty
    // when the wizard did not supply milestones.
    let insertedMilestoneIds: string[] = [];

    try {
      // Optional: primary PM assignment straight from wizard step 1.
      if (input.pm_employee_id) {
        const { error: pmErr } = await supabase
          .from("project_pm_assignments")
          .insert({
            tenant_id: ctx.actor.tenantId,
            project_id: data.id,
            pm_employee_id: input.pm_employee_id,
            assignment_role: "PRIMARY_PM",
            status: "ACTIVE",
            created_by: ctx.actor.employeeId,
          });
        if (pmErr) throw new Error(pmErr.message);
      }

      // Optional: batch-insert milestones from wizard step 3.
      if (input.milestones.length > 0) {
        const total = input.milestones.reduce((s, m) => s + m.weight_pct, 0);
        // Fallback to even weighting when all rows are 0.
        const evenWeightBps =
          total === 0
            ? Math.floor(10_000 / input.milestones.length)
            : null;
        const remainderBps =
          total === 0 ? 10_000 - evenWeightBps! * input.milestones.length : 0;

        const rows = input.milestones.map((m, idx) => ({
          tenant_id: ctx.actor.tenantId,
          project_id: data.id,
          seq: idx + 1,
          name: m.name,
          weight_bps:
            evenWeightBps !== null
              ? // Absorb rounding remainder into the first row so sum stays 10_000.
                idx === 0
                ? evenWeightBps + remainderBps
                : evenWeightBps
              : m.weight_pct * 100,
          planned_end_date: m.due_date ?? null,
          status: "PLANNED" as const,
          created_by: ctx.actor.employeeId,
        }));

        const { data: insertedMilestones, error: msErr } = await supabase
          .from("project_milestones")
          .insert(rows)
          .select("id");
        if (msErr) throw new Error(msErr.message);
        insertedMilestoneIds =
          (insertedMilestones ?? []).map((m) => m.id as string) ?? [];
      }
    } catch (postInsertErr) {
      // Compensating delete: keep the projects table consistent when a
      // downstream write fails. RLS + `on delete cascade` on children
      // means we can safely nuke the project row.
      await supabase
        .from("projects")
        .delete()
        .eq("id", data.id)
        .eq("tenant_id", ctx.actor.tenantId);
      throw postInsertErr instanceof Error
        ? postInsertErr
        : new Error("Failed to finalise project creation.");
    }

    // Google Calendar outbox — deliberately outside the compensating-delete
    // try/catch. A failure here is non-fatal: the project + milestones are
    // already durable, and calendar sync is eventually-consistent (the
    // drain cron will retry from PENDING). We still log so an ops sink can
    // pick up systematic failures.
    if (input.sync_calendar) {
      try {
        await enqueueProjectCalendarEvent(supabase, {
          tenantId: ctx.actor.tenantId,
          projectId: data.id,
          kind: "PROJECT_CREATED",
          payload: {
            project_number: data.project_number,
            project_name: data.name,
          },
        });
        await enqueueMilestoneCalendarEventsBatch(
          supabase,
          ctx.actor.tenantId,
          data.id,
          insertedMilestoneIds,
          "MILESTONE_CREATED",
        );
      } catch (calErr) {
        log.warn("calendar outbox enqueue failed (non-fatal)", {
          project_id: data.id,
          tenant_id: ctx.actor.tenantId,
          error: calErr instanceof Error ? calErr.message : String(calErr),
        });
      }
    }

    revalidatePath("/projects");
    revalidatePath(`/clients/${input.client_id}`);

    return {
      result: {
        id: data.id,
        code: data.code,
        name: data.name,
        status: data.status,
        project_number: data.project_number,
      },
      auditResourceId: data.id,
      auditNewValues: {
        code: data.code,
        project_number: data.project_number,
        name: data.name,
        status: data.status,
        priority: input.priority,
        project_type: input.project_type,
        milestone_count: input.milestones.length,
        pm_assigned: Boolean(input.pm_employee_id),
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
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.project_type !== undefined) patch.project_type = input.project_type;
    if (input.location !== undefined) patch.location = input.location ?? null;
    if (input.notes !== undefined) patch.notes = input.notes ?? null;
    if (input.sync_calendar !== undefined)
      patch.sync_calendar = input.sync_calendar;
    if (input.currency !== undefined) patch.currency = input.currency;
    if (input.contract_value_idr !== undefined) {
      patch.contract_value =
        input.contract_value_idr === null
          ? null
          : (moneyToDbString(BigInt(input.contract_value_idr)) as unknown as number);
    }
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
 * Patch the Business Case fields on a DRAFT-stage project. Nothing
 * outside `bc_*` columns is touched — status transitions live in
 * `promoteProjectFromBusinessCaseAction` below. Callers must be
 * OM / ADMIN (enforced by `withSecureAction` + PDP rule).
 */
export const updateProjectBusinessCaseAction = withSecureAction({
  schema: updateProjectBusinessCaseSchema,
  resource: "project",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "projects",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: existing, error: readErr } = await supabase
      .from("projects")
      .select(
        "id, status, bc_executive_summary, bc_target_gm_pct, bc_sponsor_id",
      )
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !existing) throw new Error("Project not found.");

    // BC block is only editable while the project is DRAFT (intake) or
    // PLANNING (still tightening the budget). After ACTIVE the BC is
    // treated as immutable audit context.
    if (!["DRAFT", "PLANNING"].includes(existing.status as string)) {
      throw new Error(
        "Business Case can only be edited while the project is DRAFT or PLANNING.",
      );
    }

    const patch: TablesUpdate<"projects"> = {};
    if (input.bc_executive_summary !== undefined) {
      patch.bc_executive_summary = input.bc_executive_summary ?? null;
    }
    if (input.bc_target_gm_pct !== undefined) {
      patch.bc_target_gm_pct = input.bc_target_gm_pct ?? null;
    }
    if (input.bc_sponsor_id !== undefined) {
      patch.bc_sponsor_id = input.bc_sponsor_id ?? null;
    }

    const { data, error } = await supabase
      .from("projects")
      .update(patch)
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .select("id, bc_executive_summary, bc_target_gm_pct, bc_sponsor_id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "BC update failed.");

    revalidatePath(`/projects/${input.id}`);
    revalidatePath("/projects");
    return {
      result: data,
      auditResourceId: data.id,
      auditOldValues: {
        bc_executive_summary: existing.bc_executive_summary,
        bc_target_gm_pct: existing.bc_target_gm_pct,
        bc_sponsor_id: existing.bc_sponsor_id,
      },
      auditNewValues: patch,
    };
  },
});

/**
 * Promote a project from DRAFT (BC intake) → PLANNING (budget draft
 * phase). Records `bc_approved_by` + `bc_approved_at` so the timeline
 * is auditable. Guards:
 *   - Project must currently be in DRAFT (idempotent-safe: re-running
 *     on PLANNING throws a friendly error).
 *   - `bc_executive_summary` and `bc_sponsor_id` must be non-null —
 *     these are the minimum viable BC. `bc_target_gm_pct` stays
 *     optional (some tenants pitch fixed-fee without margin talk).
 */
export const promoteProjectFromBusinessCaseAction = withSecureAction({
  schema: promoteProjectFromBusinessCaseSchema,
  resource: "project",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "projects",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: existing, error: readErr } = await supabase
      .from("projects")
      .select(
        "id, status, bc_executive_summary, bc_sponsor_id, bc_target_gm_pct",
      )
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !existing) throw new Error("Project not found.");

    if (existing.status !== "DRAFT") {
      throw new Error(
        `Only DRAFT projects can be promoted from Business Case (current status: ${existing.status}).`,
      );
    }
    if (
      !existing.bc_executive_summary ||
      existing.bc_executive_summary.trim().length === 0
    ) {
      throw new Error("Executive summary is required before promoting to Planning.");
    }
    if (!existing.bc_sponsor_id) {
      throw new Error("A sponsor must be assigned before promoting to Planning.");
    }

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("projects")
      .update({
        status: "PLANNING",
        bc_approved_by: ctx.actor.employeeId,
        bc_approved_at: nowIso,
      })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .select("id, status, bc_approved_by, bc_approved_at")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Promotion failed.");

    revalidatePath(`/projects/${input.id}`);
    revalidatePath("/projects");
    return {
      result: data,
      auditResourceId: data.id,
      auditOldValues: { status: existing.status },
      auditNewValues: {
        status: data.status,
        bc_approved_by: data.bc_approved_by,
        bc_approved_at: data.bc_approved_at,
      },
    };
  },
});

/**
 * Activate a PLANNING project (rules §5, §6 lifecycle Fase 2).
 * Validates that (a) the project is currently PLANNING, (b) there is
 * at least one APPROVED budget row, and (c) the caller-picked PM has
 * an eligible role. On success we insert `project_pm_assignments` in
 * PRIMARY_PM slot + flip status to ACTIVE. If either write fails the
 * other is compensated so state stays consistent.
 */
export const activateProjectAction = withSecureAction({
  schema: activateProjectSchema,
  resource: "project",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "projects",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const supabase = await createClient();

    const { data: existing, error: readErr } = await supabase
      .from("projects")
      .select("id, status, name")
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .single();
    if (readErr || !existing) throw new Error("Project not found.");

    if (existing.status !== "PLANNING") {
      throw new Error(
        `Only PLANNING projects can be activated (current: ${existing.status}).`,
      );
    }

    const budgetOk = await hasApprovedBudget(input.id);
    if (!budgetOk) {
      throw new Error(
        "At least one budget must be APPROVED before the project can be activated.",
      );
    }

    // Verify the chosen PM. `project_manager` is the canonical role name in
    // the DB enum. OM + ADMIN can also be assigned as PM for small teams.
    const { data: pm, error: pmErr } = await supabase
      .from("employees")
      .select("id, role, first_name, last_name, full_name")
      .eq("id", input.pm_employee_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (pmErr || !pm) throw new Error("Selected PM employee not found.");
    if (
      !["PROJECT_MANAGER", "OPERATIONS_MANAGER", "HEAD_MANAGER", "TENANT_ADMIN"].includes(
        pm.role as string,
      )
    ) {
      throw new Error(
        "Selected employee does not have a PM-eligible role (PM / OM / HM / Admin).",
      );
    }

    // Was there already an ACTIVE primary PM assignment? Idempotent-
    // safe: re-activating with the same PM just flips the status.
    const alreadyAssigned = await hasActivePmAssignment(input.id);

    // 1. Insert PM assignment (skip if there's already one). We do not
    //    overwrite existing rows — those are historical PM handovers.
    if (!alreadyAssigned) {
      const { error: assignErr } = await supabase
        .from("project_pm_assignments")
        .insert({
          tenant_id: ctx.actor.tenantId,
          project_id: input.id,
          pm_employee_id: input.pm_employee_id,
          assignment_role: "PRIMARY_PM",
          status: "ACTIVE",
          created_by: ctx.actor.employeeId,
        });
      if (assignErr) throw new Error(assignErr.message);
    }

    // 2. Flip status. If this fails, we cannot leave the PM assignment
    //    orphaned — set it back to INACTIVE so the row exists but is
    //    excluded from the "has active PM" check.
    const { data, error: updErr } = await supabase
      .from("projects")
      .update({ status: "ACTIVE" })
      .eq("id", input.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .select("id, status, name")
      .single();
    if (updErr || !data) {
      if (!alreadyAssigned) {
        // Compensating rollback — mark the just-inserted row as ENDED
        // so the "has active PM" check ignores it. The row survives
        // for audit history.
        await supabase
          .from("project_pm_assignments")
          .update({ status: "ENDED" })
          .eq("project_id", input.id)
          .eq("pm_employee_id", input.pm_employee_id)
          .eq("tenant_id", ctx.actor.tenantId);
      }
      throw new Error(updErr?.message ?? "Activation failed.");
    }

    revalidatePath(`/projects/${input.id}`);
    revalidatePath("/projects");
    return {
      result: {
        id: data.id,
        status: data.status,
        name: data.name,
        pm_employee_id: input.pm_employee_id,
      },
      auditResourceId: data.id,
      auditOldValues: { status: existing.status },
      auditNewValues: {
        status: data.status,
        pm_employee_id: input.pm_employee_id,
      },
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
