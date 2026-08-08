import { NextResponse } from "next/server";

import { log } from "@/lib/observability/log";
import {
  ESCALATION_COOLDOWN_MINUTES,
  decideIssueEscalation,
  newEmptyOutcome,
  type EscalationDecision,
  type IssueEscalationRow,
  type SweepOutcome,
} from "@/lib/issues/escalation";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";
import type { Json, TablesUpdate } from "@/types/database";

/**
 * Project Issues SLA sweeper (rules §26).
 *
 * `POST /api/cron/issues-sla-sweeper`
 * `POST /api/cron/issues-sla-sweeper?dry_run=true`
 *
 * For every active (`OPEN|IN_PROGRESS|REOPENED`) issue in every tenant, we:
 *   1. Compute the business-hours SLA snapshot (`issueSlaSnapshot`).
 *   2. If breached & outside cooldown & not yet at level 3:
 *      - Climb one rung of the Supervisor → PM → OM → Director ladder
 *        (`decideIssueEscalation`).
 *      - Resolve the next assignee from `project_assignments` (level 1 = PM,
 *        2 = OM) or from tenant-wide Director roles (level 3).
 *      - Update `project_issues` (assignee_employee_id, escalation_level,
 *        last_escalated_at).
 *      - Insert an `ESCALATED` event (and `SLA_BREACHED` on first breach).
 *      - Notify the new assignee (+ reporter on first breach) via
 *        `SLA_BREACH_WARNING`.
 *   3. If already at level 3 and first breach → emit `SLA_BREACHED` only,
 *      stamp `last_escalated_at` to keep this row idempotent on later sweeps.
 *
 * The route uses the service-role client so RLS never gets in the way —
 * this is what lets a single Vercel cron process every tenant in one pass.
 *
 * Wire-up:
 *   `vercel.json` cron: `{ "path": "/api/cron/issues-sla-sweeper", "schedule": "*\/15 * * * *" }`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SupabaseClient = ReturnType<typeof createServiceRoleClient>;

async function isAuthorized(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const vercelHeader = request.headers.get("x-vercel-cron-signature");
  return !!vercelHeader && vercelHeader === secret;
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    log.warn("issues-sla-sweeper: unauthorized invocation");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "true";
  const supabase = createServiceRoleClient();

  const { data: runInsert } = await supabase
    .from("cron_run_log")
    .insert({
      job_name: "issues_sla_sweeper",
      status: "RUNNING",
      dry_run: dryRun,
    })
    .select("id")
    .single();
  const runId = runInsert?.id ?? null;

  try {
    const outcome = newEmptyOutcome();
    const now = startedAt;

    // We limit each sweep to a large-but-bounded page so a runaway tenant
    // can't monopolise the job window. 500 active issues × 15-min cadence
    // is 2000/hour which is well above any realistic load.
    const { data, error } = await supabase
      .from("project_issues")
      .select(
        "id, tenant_id, project_id, reporter_employee_id, assignee_employee_id, status, severity, sla_due_at, escalation_level, last_escalated_at, title",
      )
      .in("status", ["OPEN", "IN_PROGRESS", "REOPENED"])
      .order("sla_due_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as IssueEscalationRow[];
    outcome.processed = rows.length;

    for (const row of rows) {
      const decision = decideIssueEscalation({ row, now });
      await applyDecision({
        supabase,
        row,
        decision,
        now,
        outcome,
        dryRun,
      });
    }

    if (runId) {
      await supabase
        .from("cron_run_log")
        .update({
          status: "SUCCESS",
          finished_at: new Date().toISOString(),
          rows_processed: outcome.processed,
          details: outcome as unknown as Json,
        })
        .eq("id", runId);
    }

    log.info("issues-sla-sweeper finished", {
      dry_run: dryRun,
      processed: outcome.processed,
      escalated: outcome.escalated,
      breach_only: outcome.breachEventsOnly,
      skipped: outcome.skipped,
    });

    return NextResponse.json(
      {
        status: "success",
        dry_run: dryRun,
        started_at: startedAt.toISOString(),
        cooldown_minutes: ESCALATION_COOLDOWN_MINUTES,
        outcome,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("issues-sla-sweeper failed", { error: errorMsg });
    if (runId) {
      await supabase
        .from("cron_run_log")
        .update({
          status: "FAILED",
          finished_at: new Date().toISOString(),
          error_message: errorMsg,
        })
        .eq("id", runId);
    }
    return NextResponse.json(
      { status: "failed", error: errorMsg },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Per-row apply.
// ---------------------------------------------------------------------------

async function applyDecision(args: {
  supabase: SupabaseClient;
  row: IssueEscalationRow;
  decision: EscalationDecision;
  now: Date;
  outcome: SweepOutcome;
  dryRun: boolean;
}) {
  const { supabase, row, decision, now, outcome, dryRun } = args;

  if (decision.kind === "SKIP") {
    outcome.skipped += 1;
    outcome.skippedByReason[decision.reason] += 1;
    return;
  }

  if (dryRun) {
    if (decision.kind === "ESCALATE") outcome.escalated += 1;
    else outcome.breachEventsOnly += 1;
    return;
  }

  if (decision.kind === "BREACH_ONLY") {
    await insertEvent(supabase, {
      tenantId: row.tenant_id,
      issueId: row.id,
      kind: "SLA_BREACHED",
      comment: "Auto-flagged by SLA sweeper at maximum escalation level.",
      metadata: {
        severity: row.severity,
        escalation_level: row.escalation_level,
      },
    });
    await stampLastEscalated(supabase, row.id, row.tenant_id, now);
    outcome.breachEventsOnly += 1;
    return;
  }

  // ESCALATE
  const nextAssigneeId = await findNextAssignee({
    supabase,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    targetRole: decision.nextRole,
  });

  const patch: TablesUpdate<"project_issues"> = {
    escalation_level: decision.nextLevel,
    last_escalated_at: now.toISOString(),
  };
  if (nextAssigneeId) {
    patch.assignee_employee_id = nextAssigneeId;
  }

  const { error: updateErr } = await supabase
    .from("project_issues")
    .update(patch)
    .eq("id", row.id)
    .eq("tenant_id", row.tenant_id);
  if (updateErr) throw new Error(updateErr.message);

  if (decision.firstBreach) {
    await insertEvent(supabase, {
      tenantId: row.tenant_id,
      issueId: row.id,
      kind: "SLA_BREACHED",
      comment: `SLA breached at severity ${row.severity}.`,
      metadata: {
        severity: row.severity,
        prior_level: row.escalation_level,
      },
    });
  }

  await insertEvent(supabase, {
    tenantId: row.tenant_id,
    issueId: row.id,
    kind: "ESCALATED",
    fromAssignee: row.assignee_employee_id,
    toAssignee: nextAssigneeId ?? null,
    comment: nextAssigneeId
      ? `Escalated to ${decision.nextRole}.`
      : `Escalated to ${decision.nextRole} (no assignee available in project).`,
    metadata: {
      to_level: decision.nextLevel,
      target_role: decision.nextRole,
      assignee_found: !!nextAssigneeId,
    },
  });

  await sendEscalationNotifications({
    supabase,
    row,
    nextAssigneeId,
    nextRole: decision.nextRole,
    firstBreach: decision.firstBreach,
  });

  outcome.escalated += 1;
}

// ---------------------------------------------------------------------------
// Next-assignee resolution.
// ---------------------------------------------------------------------------

async function findNextAssignee(args: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  targetRole: "PM" | "OM" | "DIRECTOR";
}): Promise<string | null> {
  const { supabase, tenantId, projectId, targetRole } = args;

  if (targetRole === "PM" || targetRole === "OM") {
    const { data } = await supabase
      .from("project_assignments")
      .select("employee_id, is_primary")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("role", targetRole)
      .eq("status", "ACTIVE")
      .order("is_primary", { ascending: false })
      .order("started_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    return data?.employee_id ?? null;
  }

  // DIRECTOR — tenant-wide fallback. Accept any of the equivalent DB roles
  // that fold to canonical DIRECTOR (GM, HM, DIRECTOR).
  const directorRoles: readonly AnyDbEmployeeRole[] = [
    "DIRECTOR",
    "GENERAL_MANAGER",
    "HEAD_MANAGER",
  ];
  const { data } = await supabase
    .from("employees")
    .select("id, role")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("role", directorRoles as AnyDbEmployeeRole[])
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

// ---------------------------------------------------------------------------
// DB helpers — event + notification + stamp.
// ---------------------------------------------------------------------------

async function insertEvent(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    issueId: string;
    kind: "ESCALATED" | "SLA_BREACHED";
    fromAssignee?: string | null;
    toAssignee?: string | null;
    comment?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await supabase.from("project_issue_events").insert({
    tenant_id: input.tenantId,
    issue_id: input.issueId,
    actor_employee_id: null,
    kind: input.kind,
    from_assignee: input.fromAssignee ?? null,
    to_assignee: input.toAssignee ?? null,
    comment: input.comment ?? null,
    metadata: (input.metadata ?? null) as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

async function stampLastEscalated(
  supabase: SupabaseClient,
  issueId: string,
  tenantId: string,
  now: Date,
) {
  const { error } = await supabase
    .from("project_issues")
    .update({ last_escalated_at: now.toISOString() })
    .eq("id", issueId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
}

async function sendEscalationNotifications(args: {
  supabase: SupabaseClient;
  row: IssueEscalationRow;
  nextAssigneeId: string | null;
  nextRole: "PM" | "OM" | "DIRECTOR";
  firstBreach: boolean;
}) {
  const { supabase, row, nextAssigneeId, nextRole, firstBreach } = args;

  const recipientEmployeeIds = new Set<string>();
  if (nextAssigneeId) recipientEmployeeIds.add(nextAssigneeId);
  if (firstBreach && row.reporter_employee_id) {
    recipientEmployeeIds.add(row.reporter_employee_id);
  }
  if (recipientEmployeeIds.size === 0) return;

  const { data: employees } = await supabase
    .from("employees")
    .select("id, user_id")
    .in("id", Array.from(recipientEmployeeIds));
  if (!employees) return;

  const rows = employees.flatMap((e) => {
    if (!e.user_id) return [];
    return [
      {
        tenant_id: row.tenant_id,
        user_id: e.user_id,
        employee_id: e.id,
        kind: "SLA_BREACH_WARNING" as const,
        title: firstBreach
          ? `SLA breached: ${row.title}`
          : `Issue escalated to ${nextRole}`,
        body: `Severity ${row.severity}. Escalation now at ${nextRole}.`,
        action_url: `/projects/${row.project_id}#issue-${row.id}`,
        payload: {
          issue_id: row.id,
          project_id: row.project_id,
          severity: row.severity,
          escalation_role: nextRole,
        } as unknown as Json,
      },
    ];
  });

  if (rows.length > 0) {
    const { error } = await supabase.from("notifications").insert(rows);
    if (error) {
      log.warn("issues-sla-sweeper: notify insert failed", {
        issue_id: row.id,
        error: error.message,
      });
    }
  }
}
