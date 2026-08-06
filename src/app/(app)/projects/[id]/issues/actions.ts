"use server";

/**
 * ControlDesk — Project Issues Server Actions (Fase 2, rules §26).
 *
 * All mutations flow through `withCanonicalSecureAction`:
 *   1. Auth (active employee).
 *   2. Zod validation.
 *   3. Canonical PDP (`project_issue`).
 *   4. Handler → DB write + event row.
 *   5. Audit log.
 *
 * The state machine is enforced by `canTransitionIssue()` at handler time;
 * the DB CHECK constraints backstop pair-consistency (resolved_at ↔ resolved_by
 * etc.).
 */

import { revalidatePath } from "next/cache";

import {
  ISSUE_ESCALATION_ROLE,
  canTransitionIssue,
} from "@/lib/issues/state";
import { computeIssueSlaDueAt } from "@/lib/issues/sla";
import { notifyRoles, notifyUser } from "@/lib/notifications/service";
import { withCanonicalSecureAction } from "@/lib/security/action-wrapper";
import { createClient } from "@/lib/supabase/server";
import {
  assignIssueSchema,
  closeIssueSchema,
  commentIssueSchema,
  createIssueSchema,
  transitionIssueSchema,
  updateIssueSchema,
} from "@/lib/validation/issue";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";
import type {
  ProjectIssueEventKind,
  ProjectIssueSeverity,
  ProjectIssueStatus,
  TablesUpdate,
} from "@/types/database";

// ---------------------------------------------------------------------------
// Shared helpers.
// ---------------------------------------------------------------------------

const ADMIN_DB_ROLES: readonly AnyDbEmployeeRole[] = ["TENANT_ADMIN", "ADMIN"];

/**
 * Map an escalation level to the DB roles that should receive notifications
 * (mirrors the notify pattern used by Cash Advance canonical actions).
 */
function rolesForEscalationLevel(
  level: 0 | 1 | 2 | 3,
): readonly AnyDbEmployeeRole[] {
  const canonical = ISSUE_ESCALATION_ROLE[level];
  switch (canonical) {
    case "SUPERVISOR":
      return ["SUPERVISOR", ...ADMIN_DB_ROLES];
    case "PM":
      return ["PROJECT_MANAGER", "PM", ...ADMIN_DB_ROLES];
    case "OM":
      return ["OPERATIONS_MANAGER", "OM", ...ADMIN_DB_ROLES];
    case "DIRECTOR":
      return [
        "HEAD_MANAGER",
        "GENERAL_MANAGER",
        "DIRECTOR",
        ...ADMIN_DB_ROLES,
      ];
  }
}

async function loadIssue(
  issueId: string,
  tenantId: string,
): Promise<{
  id: string;
  tenant_id: string;
  project_id: string;
  reporter_employee_id: string;
  assignee_employee_id: string | null;
  status: ProjectIssueStatus;
  severity: ProjectIssueSeverity;
  title: string;
  sla_due_at: string;
  escalation_level: number;
} | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_issues")
    .select(
      "id, tenant_id, project_id, reporter_employee_id, assignee_employee_id, status, severity, title, sla_due_at, escalation_level",
    )
    .eq("id", issueId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function appendIssueEvent(input: {
  tenantId: string;
  issueId: string;
  actorEmployeeId: string;
  kind: ProjectIssueEventKind;
  fromStatus?: ProjectIssueStatus | null;
  toStatus?: ProjectIssueStatus | null;
  fromAssignee?: string | null;
  toAssignee?: string | null;
  comment?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const supabase = await createClient();
  const { error } = await supabase.from("project_issue_events").insert({
    tenant_id: input.tenantId,
    issue_id: input.issueId,
    actor_employee_id: input.actorEmployeeId,
    kind: input.kind,
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    from_assignee: input.fromAssignee ?? null,
    to_assignee: input.toAssignee ?? null,
    comment: input.comment ?? null,
    metadata: input.metadata ? (input.metadata as never) : null,
  });
  if (error) throw new Error(error.message);
}

function revalidateIssuePaths(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/issues`);
  revalidatePath("/issues");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

export const createIssueAction = withCanonicalSecureAction({
  schema: createIssueSchema,
  resource: "project_issue",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "project_issues",
  resolveAttributes: async (input, ctx) => {
    const supabase = await createClient();
    const { data: assigned } = await supabase.rpc("is_assigned_to_project", {
      p_project_id: input.project_id,
    });
    return {
      tenantId: ctx.actor.tenantId,
      projectId: input.project_id,
      isActiveAssignment: Boolean(assigned),
      ownerEmployeeId: ctx.actor.employeeId,
    };
  },
  handler: async (input, ctx) => {
    const supabase = await createClient();
    const now = new Date();
    const slaDueAt = computeIssueSlaDueAt(now, input.severity);

    const { data: inserted, error: insertErr } = await supabase
      .from("project_issues")
      .insert({
        tenant_id: ctx.actor.tenantId,
        project_id: input.project_id,
        reporter_employee_id: ctx.actor.employeeId,
        assignee_employee_id: input.assignee_employee_id ?? null,
        title: input.title,
        description: input.description,
        severity: input.severity,
        status: "OPEN",
        sla_due_at: slaDueAt.toISOString(),
        escalation_level: 0,
      })
      .select("id, project_id, severity, sla_due_at")
      .single();
    if (insertErr || !inserted) {
      throw new Error(insertErr?.message ?? "Failed to create issue.");
    }

    await appendIssueEvent({
      tenantId: ctx.actor.tenantId,
      issueId: inserted.id,
      actorEmployeeId: ctx.actor.employeeId,
      kind: "CREATED",
      toStatus: "OPEN",
      toAssignee: input.assignee_employee_id ?? null,
      metadata: {
        severity: input.severity,
        sla_due_at: inserted.sla_due_at,
      },
    });

    // Notify triage owner + explicit assignee (if any).
    await notifyRoles({
      tenantId: ctx.actor.tenantId,
      roles: rolesForEscalationLevel(0),
      kind: "SLA_BREACH_WARNING",
      title: `[${input.severity}] ${input.title}`,
      body: input.description.slice(0, 200),
      actionUrl: `/projects/${input.project_id}#issue-${inserted.id}`,
      payload: { issue_id: inserted.id, severity: input.severity },
    });

    if (input.assignee_employee_id) {
      const { data: assignee } = await supabase
        .from("employees")
        .select("user_id")
        .eq("id", input.assignee_employee_id)
        .maybeSingle();
      if (assignee?.user_id) {
        await notifyUser({
          recipient: { userId: assignee.user_id },
          kind: "SLA_BREACH_WARNING",
          title: `Issue assigned to you: ${input.title}`,
          body: `Severity ${input.severity} · SLA ${new Date(inserted.sla_due_at).toISOString()}`,
          actionUrl: `/projects/${input.project_id}#issue-${inserted.id}`,
          payload: { issue_id: inserted.id },
        });
      }
    }

    revalidateIssuePaths(input.project_id);

    return {
      result: {
        id: inserted.id,
        project_id: inserted.project_id,
        severity: inserted.severity as ProjectIssueSeverity,
        sla_due_at: inserted.sla_due_at,
      },
      auditResourceId: inserted.id,
      auditNewValues: {
        project_id: input.project_id,
        title: input.title,
        severity: input.severity,
        sla_due_at: inserted.sla_due_at,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// UPDATE — mutable fields only. Transitions go through a dedicated action.
// ---------------------------------------------------------------------------

export const updateIssueAction = withCanonicalSecureAction({
  schema: updateIssueSchema,
  resource: "project_issue",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_issues",
  resolveAttributes: async (input, ctx) => {
    const row = await loadIssue(input.issue_id, ctx.actor.tenantId);
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status,
      ownerEmployeeId: row?.reporter_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const row = await loadIssue(input.issue_id, ctx.actor.tenantId);
    if (!row) throw new Error("Issue not found.");

    const patch: TablesUpdate<"project_issues"> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.severity !== undefined) {
      patch.severity = input.severity;
      // Re-stamp SLA when severity changes.
      patch.sla_due_at = computeIssueSlaDueAt(new Date(), input.severity).toISOString();
    }
    if (input.assignee_employee_id !== undefined) {
      patch.assignee_employee_id = input.assignee_employee_id;
    }

    const supabase = await createClient();
    const { error: updateErr } = await supabase
      .from("project_issues")
      .update(patch)
      .eq("id", input.issue_id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    await appendIssueEvent({
      tenantId: ctx.actor.tenantId,
      issueId: input.issue_id,
      actorEmployeeId: ctx.actor.employeeId,
      kind:
        input.assignee_employee_id !== undefined &&
        input.title === undefined &&
        input.description === undefined &&
        input.severity === undefined
          ? "ASSIGNED"
          : "UPDATED",
      fromAssignee: row.assignee_employee_id,
      toAssignee:
        input.assignee_employee_id !== undefined
          ? input.assignee_employee_id
          : row.assignee_employee_id,
      metadata: {
        changed: Object.keys(patch),
        previous: {
          title: row.title,
          severity: row.severity,
          assignee_employee_id: row.assignee_employee_id,
          sla_due_at: row.sla_due_at,
        },
      },
    });

    revalidateIssuePaths(row.project_id);

    return {
      result: { id: input.issue_id },
      auditResourceId: input.issue_id,
      auditOldValues: {
        title: row.title,
        severity: row.severity,
        assignee_employee_id: row.assignee_employee_id,
      },
      auditNewValues: patch as Record<string, unknown>,
    };
  },
});

// ---------------------------------------------------------------------------
// TRANSITION — lifecycle move (OPEN → IN_PROGRESS → RESOLVED → CLOSED, etc.)
// ---------------------------------------------------------------------------

export const transitionIssueAction = withCanonicalSecureAction({
  schema: transitionIssueSchema,
  resource: "project_issue",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_issues",
  resolveAttributes: async (input, ctx) => {
    const row = await loadIssue(input.issue_id, ctx.actor.tenantId);
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status,
      ownerEmployeeId: row?.reporter_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const row = await loadIssue(input.issue_id, ctx.actor.tenantId);
    if (!row) throw new Error("Issue not found.");
    if (!canTransitionIssue(row.status, input.to_status as ProjectIssueStatus)) {
      throw new Error(
        `Illegal transition ${row.status} → ${input.to_status}.`,
      );
    }

    const nowIso = new Date().toISOString();
    const patch: TablesUpdate<"project_issues"> = {
      status: input.to_status as ProjectIssueStatus,
    };
    if (input.to_status === "RESOLVED") {
      patch.resolved_at = nowIso;
      patch.resolved_by = ctx.actor.employeeId;
    }
    if (input.to_status === "CLOSED") {
      patch.closed_at = nowIso;
      patch.closed_by = ctx.actor.employeeId;
      // If we skipped RESOLVED (e.g. duplicate/won't-fix close), still stamp
      // the resolve pair for audit clarity.
      if (!row.status.startsWith("RES")) {
        patch.resolved_at = nowIso;
        patch.resolved_by = ctx.actor.employeeId;
      }
    }
    if (input.to_status === "REOPENED") {
      patch.reopened_at = nowIso;
      patch.reopened_by = ctx.actor.employeeId;
      patch.resolved_at = null;
      patch.resolved_by = null;
      patch.closed_at = null;
      patch.closed_by = null;
      // Re-stamp SLA from now — the clock restarts on reopen (rules §26).
      patch.sla_due_at = computeIssueSlaDueAt(
        new Date(),
        row.severity,
      ).toISOString();
    }

    const supabase = await createClient();
    const { error: updateErr } = await supabase
      .from("project_issues")
      .update(patch)
      .eq("id", input.issue_id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    const kind: ProjectIssueEventKind =
      input.to_status === "CLOSED"
        ? "CLOSED"
        : input.to_status === "REOPENED"
          ? "REOPENED"
          : "STATUS_CHANGED";

    await appendIssueEvent({
      tenantId: ctx.actor.tenantId,
      issueId: input.issue_id,
      actorEmployeeId: ctx.actor.employeeId,
      kind,
      fromStatus: row.status,
      toStatus: input.to_status as ProjectIssueStatus,
      comment: input.comment ?? null,
    });

    // Notify reporter + current assignee on any transition.
    const recipients = new Set<string>();
    if (row.reporter_employee_id) recipients.add(row.reporter_employee_id);
    if (row.assignee_employee_id) recipients.add(row.assignee_employee_id);
    recipients.delete(ctx.actor.employeeId);
    if (recipients.size > 0) {
      const { data: employees } = await supabase
        .from("employees")
        .select("id, user_id")
        .in("id", Array.from(recipients));
      for (const emp of employees ?? []) {
        await notifyUser({
          recipient: { userId: emp.user_id, employeeId: emp.id },
          kind:
            input.to_status === "CLOSED"
              ? "APPROVAL_APPROVED"
              : input.to_status === "RESOLVED"
                ? "APPROVAL_APPROVED"
                : "SLA_BREACH_WARNING",
          title: `Issue ${input.to_status.toLowerCase()}: ${row.title}`,
          body: input.comment ?? undefined,
          actionUrl: `/projects/${row.project_id}#issue-${input.issue_id}`,
          payload: {
            issue_id: input.issue_id,
            from_status: row.status,
            to_status: input.to_status,
          },
        });
      }
    }

    revalidateIssuePaths(row.project_id);

    return {
      result: { id: input.issue_id, to_status: input.to_status },
      auditResourceId: input.issue_id,
      auditOldValues: { status: row.status },
      auditNewValues: patch as Record<string, unknown>,
    };
  },
});

// ---------------------------------------------------------------------------
// COMMENT — timeline entry only, no state change.
// ---------------------------------------------------------------------------

export const commentOnIssueAction = withCanonicalSecureAction({
  schema: commentIssueSchema,
  resource: "project_issue",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_issues",
  resolveAttributes: async (input, ctx) => {
    const row = await loadIssue(input.issue_id, ctx.actor.tenantId);
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status,
      ownerEmployeeId: row?.reporter_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const row = await loadIssue(input.issue_id, ctx.actor.tenantId);
    if (!row) throw new Error("Issue not found.");

    await appendIssueEvent({
      tenantId: ctx.actor.tenantId,
      issueId: input.issue_id,
      actorEmployeeId: ctx.actor.employeeId,
      kind: "COMMENTED",
      comment: input.comment,
    });

    revalidateIssuePaths(row.project_id);

    return {
      result: { id: input.issue_id },
      auditResourceId: input.issue_id,
      auditMetadata: { comment_preview: input.comment.slice(0, 200) },
    };
  },
});

// ---------------------------------------------------------------------------
// ASSIGN — dedicated action for assignment changes. Uses the ASSIGNED event
// so the timeline reads cleanly.
// ---------------------------------------------------------------------------

export const assignIssueAction = withCanonicalSecureAction({
  schema: assignIssueSchema,
  resource: "project_issue",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_issues",
  resolveAttributes: async (input, ctx) => {
    const row = await loadIssue(input.issue_id, ctx.actor.tenantId);
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status,
      ownerEmployeeId: row?.reporter_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const row = await loadIssue(input.issue_id, ctx.actor.tenantId);
    if (!row) throw new Error("Issue not found.");
    if (row.assignee_employee_id === input.assignee_employee_id) {
      return {
        result: { id: input.issue_id },
        auditResourceId: input.issue_id,
        auditMetadata: { noop: true },
      };
    }

    const supabase = await createClient();
    const { error: updateErr } = await supabase
      .from("project_issues")
      .update({ assignee_employee_id: input.assignee_employee_id })
      .eq("id", input.issue_id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    await appendIssueEvent({
      tenantId: ctx.actor.tenantId,
      issueId: input.issue_id,
      actorEmployeeId: ctx.actor.employeeId,
      kind: "ASSIGNED",
      fromAssignee: row.assignee_employee_id,
      toAssignee: input.assignee_employee_id,
    });

    if (input.assignee_employee_id) {
      const { data: assignee } = await supabase
        .from("employees")
        .select("user_id")
        .eq("id", input.assignee_employee_id)
        .maybeSingle();
      if (assignee?.user_id) {
        await notifyUser({
          recipient: { userId: assignee.user_id },
          kind: "SLA_BREACH_WARNING",
          title: `Issue assigned to you: ${row.title}`,
          actionUrl: `/projects/${row.project_id}#issue-${input.issue_id}`,
          payload: { issue_id: input.issue_id },
        });
      }
    }

    revalidateIssuePaths(row.project_id);

    return {
      result: { id: input.issue_id },
      auditResourceId: input.issue_id,
      auditOldValues: { assignee_employee_id: row.assignee_employee_id },
      auditNewValues: { assignee_employee_id: input.assignee_employee_id },
    };
  },
});

// ---------------------------------------------------------------------------
// CLOSE — convenience shortcut (mirrors legacy tickets' "Close" button).
// ---------------------------------------------------------------------------

export const closeIssueAction = withCanonicalSecureAction({
  schema: closeIssueSchema,
  resource: "project_issue",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_issues",
  resolveAttributes: async (input, ctx) => {
    const row = await loadIssue(input.issue_id, ctx.actor.tenantId);
    return {
      tenantId: ctx.actor.tenantId,
      projectId: row?.project_id,
      status: row?.status,
      ownerEmployeeId: row?.reporter_employee_id ?? undefined,
    };
  },
  handler: async (input, ctx) => {
    const row = await loadIssue(input.issue_id, ctx.actor.tenantId);
    if (!row) throw new Error("Issue not found.");
    if (!canTransitionIssue(row.status, "CLOSED")) {
      throw new Error(`Cannot close from status ${row.status}.`);
    }

    const supabase = await createClient();
    const nowIso = new Date().toISOString();
    const patch: TablesUpdate<"project_issues"> = {
      status: "CLOSED",
      closed_at: nowIso,
      closed_by: ctx.actor.employeeId,
    };
    if (!row.status.startsWith("RES")) {
      patch.resolved_at = nowIso;
      patch.resolved_by = ctx.actor.employeeId;
    }

    const { error: updateErr } = await supabase
      .from("project_issues")
      .update(patch)
      .eq("id", input.issue_id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updateErr) throw new Error(updateErr.message);

    await appendIssueEvent({
      tenantId: ctx.actor.tenantId,
      issueId: input.issue_id,
      actorEmployeeId: ctx.actor.employeeId,
      kind: "CLOSED",
      fromStatus: row.status,
      toStatus: "CLOSED",
      comment: input.comment ?? null,
    });

    revalidateIssuePaths(row.project_id);

    return {
      result: { id: input.issue_id },
      auditResourceId: input.issue_id,
      auditOldValues: { status: row.status },
      auditNewValues: patch as Record<string, unknown>,
    };
  },
});
