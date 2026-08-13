import { NextResponse } from "next/server";

import { notifyUser } from "@/lib/notifications/service";
import { log } from "@/lib/observability/log";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Approval idle nudge cron (rules §20 companion to the daily digest).
 *
 * Runs every hour. Digest fires once at 08:00 WIB, so items that
 * submit at 09:00 stay unseen for ~23h before the first email lands
 * — this cron bridges that gap by nudging approvers as soon as an
 * item crosses the 24h idle threshold.
 *
 * Design:
 *   1. Count PENDING items across project_expenses / cash_advances /
 *      hr_requests where `created_at < now - 24h`, per tenant.
 *   2. If the total is 0, skip the tenant entirely.
 *   3. Otherwise, find every ACTIVE employee whose role can approve
 *      (SUPERVISOR / PROJECT_MANAGER / OPERATIONS_MANAGER / LEAD_FINANCE
 *      / GENERAL_MANAGER / TENANT_ADMIN plus their canonical aliases)
 *      and enqueue an APPROVAL_IDLE_24H notification — one per
 *      approver per day (dedup via existing `notifications` rows).
 *
 * Why aggregate instead of per-item: this cron is the "wake up and
 * look at your queue" nudge, not the "here is item X" reminder.
 * Per-item nudges live in the settlement-reminders cron for CA/expense
 * SLAs. Sending one aggregate row also keeps the notifications bell
 * uncluttered — approvers who ignore 20 idle expenses shouldn't get
 * 20 unread bells.
 *
 * Deduplication: the enqueue check uses `notifications.created_at`
 * on the same UTC day + same recipient + same kind. So an approver
 * gets AT MOST one nudge per day even if the cron runs 24 times.
 * They can silence the APPROVALS category in Preferences if it
 * becomes noise.
 *
 * Auth: standard `Authorization: Bearer $CRON_SECRET` or
 * `x-vercel-cron-signature`. Falls open in dev when CRON_SECRET is
 * unset (consistent with sibling crons).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDLE_HOURS = 24;

const APPROVER_ROLES = [
  "SUPERVISOR",
  "PROJECT_MANAGER",
  "OPERATIONS_MANAGER",
  "LEAD_FINANCE",
  "GENERAL_MANAGER",
  "TENANT_ADMIN",
  // Canonical alias set — the schema currently ships legacy names above
  // but new tenants may seed canonical roles per rules §6.
  "PM",
  "OM",
  "FINANCE",
  "DIRECTOR",
  "ADMIN",
] as const;

async function isAuthorized(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const vercelHeader = request.headers.get("x-vercel-cron-signature");
  return !!vercelHeader && vercelHeader === secret;
}

type PendingCount = {
  expenses: number;
  cash_advances: number;
  hr_requests: number;
};

async function countPendingIdle(
  supabase: ReturnType<typeof createServiceRoleClient>,
  tenantId: string,
  cutoffIso: string,
): Promise<PendingCount> {
  const [expRes, caRes, hrRes] = await Promise.all([
    supabase
      .from("project_expenses")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .like("status", "PENDING_%")
      .lt("created_at", cutoffIso),
    supabase
      .from("cash_advances")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .like("status", "PENDING_%")
      .lt("created_at", cutoffIso),
    supabase
      .from("hr_requests")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .like("status", "PENDING_%")
      .lt("created_at", cutoffIso),
  ]);
  return {
    expenses: expRes.count ?? 0,
    cash_advances: caRes.count ?? 0,
    hr_requests: hrRes.count ?? 0,
  };
}

async function loadApprovers(
  supabase: ReturnType<typeof createServiceRoleClient>,
  tenantId: string,
): Promise<Array<{ id: string; user_id: string; full_name: string }>> {
  const { data, error } = await supabase
    .from("employees")
    .select("id, user_id, full_name, is_active")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("role", [...APPROVER_ROLES]);
  if (error) {
    log.warn("approval-idle-nudge: loadApprovers failed", {
      tenant_id: tenantId,
      error: error.message,
    });
    return [];
  }
  // Narrow `user_id` from `string | null` to `string` by filtering
  // out unlinked employee rows, and drop the `is_active` field the
  // caller never uses.
  const rows = data ?? [];
  const out: Array<{ id: string; user_id: string; full_name: string }> = [];
  for (const r of rows) {
    if (!r.id || !r.user_id) continue;
    out.push({ id: r.id, user_id: r.user_id, full_name: r.full_name });
  }
  return out;
}

async function hasNudgeToday(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  utcDayStartIso: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", "APPROVAL_IDLE_24H")
    .gte("created_at", utcDayStartIso);
  if (error) {
    // Fail-open — if we can't verify, better to skip than double-send.
    log.warn("approval-idle-nudge: hasNudgeToday query failed", {
      user_id: userId,
      error: error.message,
    });
    return true;
  }
  return (count ?? 0) > 0;
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    log.warn("approval-idle-nudge: unauthorized invocation");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "true";
  const supabase = createServiceRoleClient();

  const cutoff = new Date(
    startedAt.getTime() - IDLE_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const utcDayStart = new Date(
    Date.UTC(
      startedAt.getUTCFullYear(),
      startedAt.getUTCMonth(),
      startedAt.getUTCDate(),
    ),
  ).toISOString();

  const { data: runInsert } = await supabase
    .from("cron_run_log")
    .insert({
      job_name: "approval_idle_nudge",
      status: "RUNNING",
      dry_run: dryRun,
    })
    .select("id")
    .single();
  const runId = runInsert?.id ?? null;

  const stats = {
    tenants_processed: 0,
    tenants_skipped_no_idle: 0,
    notified: 0,
    skipped_already_nudged_today: 0,
  };

  try {
    const { data: tenants, error: tenantErr } = await supabase
      .from("tenants")
      .select("id, name, status")
      .in("status", ["active", "suspended"])
      .limit(500);
    if (tenantErr) throw new Error(tenantErr.message);

    for (const tenant of tenants ?? []) {
      const counts = await countPendingIdle(supabase, tenant.id, cutoff);
      const total = counts.expenses + counts.cash_advances + counts.hr_requests;
      if (total === 0) {
        stats.tenants_skipped_no_idle += 1;
        continue;
      }

      const approvers = await loadApprovers(supabase, tenant.id);
      for (const approver of approvers) {
        if (await hasNudgeToday(supabase, approver.user_id, utcDayStart)) {
          stats.skipped_already_nudged_today += 1;
          continue;
        }
        if (!dryRun) {
          void notifyUser({
            recipient: {
              userId: approver.user_id,
              employeeId: approver.id,
            },
            kind: "APPROVAL_IDLE_24H",
            title: `${total} approval menunggu > 24 jam`,
            body: renderBody(counts),
            actionUrl: "/approvals",
            payload: {
              tenant_id: tenant.id,
              total,
              breakdown: counts,
              cutoff_at: cutoff,
            },
            tenantId: tenant.id,
          });
        }
        stats.notified += 1;
      }
      stats.tenants_processed += 1;
    }

    if (runId) {
      await supabase
        .from("cron_run_log")
        .update({
          status: "SUCCESS",
          finished_at: new Date().toISOString(),
          rows_processed: stats.notified,
          details: { ...stats, cutoff, utc_day_start: utcDayStart },
        })
        .eq("id", runId);
    }

    log.info("approval-idle-nudge finished", { dry_run: dryRun, ...stats });
    return NextResponse.json(
      {
        status: "success",
        dry_run: dryRun,
        started_at: startedAt.toISOString(),
        stats,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("approval-idle-nudge failed", { error: errorMsg });
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

function renderBody(counts: PendingCount): string {
  const parts: string[] = [];
  if (counts.expenses > 0) parts.push(`${counts.expenses} biaya`);
  if (counts.cash_advances > 0)
    parts.push(`${counts.cash_advances} cash advance`);
  if (counts.hr_requests > 0)
    parts.push(`${counts.hr_requests} permintaan HR`);
  return `Ada ${parts.join(", ")} sudah menunggu approval lebih dari 24 jam. Buka /approvals untuk memproses.`;
}
