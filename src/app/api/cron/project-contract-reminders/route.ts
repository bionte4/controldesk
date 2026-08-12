import { NextResponse } from "next/server";

import { log } from "@/lib/observability/log";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  PROJECT_CONTRACT_EXPIRY_THRESHOLDS_DAYS,
  PROJECT_STATUSES_ELIGIBLE_FOR_EXPIRY_REMINDER,
  formatProjectExpiryReminder,
} from "@/lib/projects/reminders";

/**
 * Project contract-expiry reminders (rules §7 + §20).
 *
 * `POST /api/cron/project-contract-reminders`
 * `POST /api/cron/project-contract-reminders?dry_run=true`
 *
 * Scans every tenant for projects whose `end_date` falls in one of the
 * configured horizons (30 / 14 / 7 / 3 days) and enqueues an in-app
 * notification for:
 *   * the PRIMARY_PM assigned to the project (via
 *     `project_pm_assignments` where `status = 'ACTIVE'`), and
 *   * every Head Manager / GM / Tenant Admin in the same tenant (fallback
 *     when no PM is assigned, and always for HM/GM oversight per rules §6).
 *
 * Skips:
 *   * Projects whose status is COMPLETED / ARCHIVED (already wound down).
 *   * Rows with `end_date IS NULL` (open-ended engagement).
 *   * Already-expired projects (past `end_date`) — those are handled by
 *     a separate ops backlog, not by this reminder cron.
 *
 * Idempotency: same shape as the employee variant. We look up
 *   `notifications.payload->>project_id`
 * + `payload->>threshold_days` created in the last 26 hours and skip when
 * a matching row already exists. Prevents daily double-firing without
 * requiring a dedicated dedupe table.
 *
 * Wire-up: entry in `vercel.json` at 08:15 WIB every day (staggered from
 * the employee reminder to spread service-role DB load).
 *   { "path": "/api/cron/project-contract-reminders", "schedule": "15 1 * * *" }
 *   (01:15 UTC = 08:15 Asia/Jakarta.)
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` or `x-vercel-cron-signature`
 * header. Falls open in local dev when `CRON_SECRET` is unset (matches
 * every other cron in this app).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function isAuthorized(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const vercelHeader = request.headers.get("x-vercel-cron-signature");
  return !!vercelHeader && vercelHeader === secret;
}

function isoDatePlusDays(from: Date, days: number): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

type ExpiringProject = {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  project_number: string | null;
  status: string;
  end_date: string;
};

type PmAssignment = {
  project_id: string;
  pm_employee_id: string;
};

type Manager = {
  id: string;
  user_id: string | null;
  tenant_id: string;
};

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    log.warn("project-contract-reminders: unauthorized invocation");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "true";
  const supabase = createServiceRoleClient();

  const { data: runInsert } = await supabase
    .from("cron_run_log")
    .insert({
      job_name: "project_contract_reminders",
      status: "RUNNING",
      dry_run: dryRun,
    })
    .select("id")
    .single();
  const runId = runInsert?.id ?? null;

  try {
    let totalEnqueued = 0;
    const perThreshold: Record<number, number> = {};

    for (const days of PROJECT_CONTRACT_EXPIRY_THRESHOLDS_DAYS) {
      const targetIso = isoDatePlusDays(startedAt, days);

      // 1. Find every eligible project whose end_date == the horizon.
      //    Equality (not a range) keeps the daily fan-out crisp and prevents
      //    a project from receiving reminders on every day inside a window.
      const { data: expiring, error: expiringErr } = await supabase
        .from("projects")
        .select("id, tenant_id, name, code, project_number, status, end_date")
        .in("status", [...PROJECT_STATUSES_ELIGIBLE_FOR_EXPIRY_REMINDER])
        .eq("end_date", targetIso);
      if (expiringErr) throw new Error(expiringErr.message);
      const projects = (expiring ?? []) as ExpiringProject[];
      if (projects.length === 0) continue;

      // 2. Look up ACTIVE PRIMARY_PM per project (may be zero — projects can
      //    exist without an assigned PM in DRAFT / PLANNING).
      const projectIds = projects.map((p) => p.id);
      const { data: pmRows, error: pmErr } = await supabase
        .from("project_pm_assignments")
        .select("project_id, pm_employee_id")
        .in("project_id", projectIds)
        .eq("assignment_role", "PRIMARY_PM")
        .eq("status", "ACTIVE");
      if (pmErr) throw new Error(pmErr.message);
      const pmByProject = new Map<string, PmAssignment[]>();
      for (const row of (pmRows ?? []) as PmAssignment[]) {
        const list = pmByProject.get(row.project_id) ?? [];
        list.push(row);
        pmByProject.set(row.project_id, list);
      }

      // 3. Look up oversight roles per tenant. HM / GM / Tenant Admin are
      //    always CC'd so leadership sees expiring contracts even when the
      //    PM has left / been reassigned.
      const tenantIds = Array.from(new Set(projects.map((p) => p.tenant_id)));
      const { data: managerRows, error: mgrErr } = await supabase
        .from("employees")
        .select("id, user_id, tenant_id")
        .in("tenant_id", tenantIds)
        .in("role", ["TENANT_ADMIN", "GENERAL_MANAGER", "HEAD_MANAGER"])
        .eq("is_active", true);
      if (mgrErr) throw new Error(mgrErr.message);
      const managersByTenant = new Map<string, Manager[]>();
      for (const m of (managerRows ?? []) as Manager[]) {
        const list = managersByTenant.get(m.tenant_id) ?? [];
        list.push(m);
        managersByTenant.set(m.tenant_id, list);
      }

      // 4. Also look up user_id for each PM employee so we can address the
      //    notification to a login-capable user (Bell/inbox is keyed on
      //    user_id, not employee_id).
      const pmEmployeeIds = Array.from(
        new Set((pmRows ?? []).map((r) => (r as PmAssignment).pm_employee_id)),
      );
      const pmEmployeeToUser = new Map<string, string | null>();
      if (pmEmployeeIds.length > 0) {
        const { data: pmEmployees, error: pmEmpErr } = await supabase
          .from("employees")
          .select("id, user_id")
          .in("id", pmEmployeeIds);
        if (pmEmpErr) throw new Error(pmEmpErr.message);
        for (const e of pmEmployees ?? []) {
          pmEmployeeToUser.set(
            (e as { id: string }).id,
            (e as { user_id: string | null }).user_id,
          );
        }
      }

      // 5. Fan out with idempotency guard per (project, threshold).
      for (const project of projects) {
        const since = new Date(startedAt.getTime() - 26 * 3_600_000).toISOString();
        const { count: existingCount, error: existsErr } = await supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", project.tenant_id)
          .eq("kind", "PROJECT_CONTRACT_EXPIRING")
          .contains("payload", {
            project_id: project.id,
            threshold_days: days,
          })
          .gte("created_at", since);
        if (existsErr) throw new Error(existsErr.message);
        if ((existingCount ?? 0) > 0) continue;

        const { title, body } = formatProjectExpiryReminder({
          projectName: project.name,
          projectCode: project.project_number ?? project.code,
          daysUntilExpiry: days,
          endDateIso: project.end_date,
        });

        // Recipients: PMs of this project + oversight managers of this
        // tenant, deduped on (user_id, employee_id) so a manager who
        // happens to also be the PM only gets one notification.
        const recipients = new Map<
          string,
          { user_id: string; employee_id: string }
        >();

        for (const pm of pmByProject.get(project.id) ?? []) {
          const userId = pmEmployeeToUser.get(pm.pm_employee_id);
          if (userId) {
            recipients.set(`${userId}:${pm.pm_employee_id}`, {
              user_id: userId,
              employee_id: pm.pm_employee_id,
            });
          }
        }
        for (const mgr of managersByTenant.get(project.tenant_id) ?? []) {
          if (mgr.user_id) {
            recipients.set(`${mgr.user_id}:${mgr.id}`, {
              user_id: mgr.user_id,
              employee_id: mgr.id,
            });
          }
        }

        if (recipients.size === 0) continue;

        const rows = Array.from(recipients.values()).map((r) => ({
          tenant_id: project.tenant_id,
          user_id: r.user_id,
          employee_id: r.employee_id,
          kind: "PROJECT_CONTRACT_EXPIRING" as const,
          title,
          body,
          action_url: `/projects/${project.id}`,
          payload: {
            project_id: project.id,
            project_code: project.project_number ?? project.code,
            project_status: project.status,
            end_date: project.end_date,
            threshold_days: days,
          },
        }));

        if (!dryRun) {
          const { error: insertErr } = await supabase
            .from("notifications")
            .insert(rows);
          if (insertErr) {
            log.warn("project-contract-reminders: notify insert failed", {
              project_id: project.id,
              error: insertErr.message,
            });
            continue;
          }
        }
        totalEnqueued += rows.length;
        perThreshold[days] = (perThreshold[days] ?? 0) + rows.length;
      }
    }

    if (runId) {
      await supabase
        .from("cron_run_log")
        .update({
          status: "SUCCESS",
          finished_at: new Date().toISOString(),
          rows_processed: totalEnqueued,
          details: {
            per_threshold: perThreshold,
            thresholds: [...PROJECT_CONTRACT_EXPIRY_THRESHOLDS_DAYS],
          },
        })
        .eq("id", runId);
    }

    log.info("project-contract-reminders finished", {
      dry_run: dryRun,
      enqueued: totalEnqueued,
      per_threshold: perThreshold,
    });

    return NextResponse.json(
      {
        status: "success",
        dry_run: dryRun,
        started_at: startedAt.toISOString(),
        enqueued: totalEnqueued,
        per_threshold: perThreshold,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("project-contract-reminders failed", { error: errorMsg });
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
