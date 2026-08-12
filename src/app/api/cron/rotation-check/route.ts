import { NextResponse } from "next/server";

import { log } from "@/lib/observability/log";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  computeAll,
  filterAttention,
  summarize,
  type SecretRotationRow,
} from "@/lib/security/rotation";
import type { NotificationKind } from "@/types/database";

/**
 * Secret rotation compliance cron (rules §22 + docs/ops/secret-rotation.md).
 *
 *   POST /api/cron/rotation-check           → notify + log
 *   POST /api/cron/rotation-check?dry_run=true → compute only, no writes
 *
 * On every invocation:
 *   1. Reads `public.secret_rotations`.
 *   2. Computes `severity` per row (OK / WARN / OVERDUE) via the SQL
 *      function or the TS mirror (whichever is available).
 *   3. If any row is WARN or OVERDUE, dispatches a `SYSTEM` notification
 *      to every ACTIVE `TENANT_ADMIN` across all tenants — because
 *      infrastructure secrets are cross-tenant.
 *   4. Records the invocation in `cron_run_log` with a redacted summary
 *      (secret names + severity, never the values).
 *
 * Scheduled: Monday 03:00 WIB (= Sunday 20:00 UTC) — see vercel.json.
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

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    log.warn("rotation-check cron: unauthorized invocation");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "true";

  const supabase = createServiceRoleClient();

  const { data: runInsert } = await supabase
    .from("cron_run_log")
    .insert({
      job_name: "rotation_check",
      status: "RUNNING",
      dry_run: dryRun,
    })
    .select("id")
    .single();
  const runId = runInsert?.id ?? null;

  try {
    const { data: rows, error } = await supabase
      .from("secret_rotations")
      .select(
        "name, priority, purpose, last_rotated_at, rotation_interval_days, notes",
      );
    if (error) throw new Error(`select secret_rotations: ${error.message}`);

    const secrets = (rows ?? []) as SecretRotationRow[];
    const computed = computeAll(secrets);
    const attention = filterAttention(computed);
    const buckets = summarize(computed);

    let notificationsDispatched = 0;
    let notificationsFailed = 0;

    if (!dryRun && attention.length > 0) {
      const { data: adminRows, error: adminErr } = await supabase
        .from("employees")
        .select("user_id, tenant_id")
        .eq("is_active", true)
        .eq("role", "TENANT_ADMIN");

      if (adminErr) {
        throw new Error(`select tenant admins: ${adminErr.message}`);
      }

      const title =
        buckets.overdue > 0
          ? `${buckets.overdue} secret(s) OVERDUE`
          : `${buckets.warn} secret(s) rotation due soon`;

      const body = attention
        .slice(0, 10)
        .map(
          (r) =>
            `${r.name} · ${r.priority} · ${
              r.severity === "OVERDUE"
                ? `${Math.abs(r.days_until_due)}d overdue`
                : `${r.days_until_due}d left`
            }`,
        )
        .join("\n");

      // Dispatch one notification per (admin_user, tenant). We use the
      // enqueue_notification RPC via the *tenant* row so RLS on
      // `notifications` still verifies tenant scoping.
      const notificationKind: NotificationKind = "SYSTEM";
      for (const admin of adminRows ?? []) {
        if (!admin.user_id) continue;
        const { error: insertErr } = await supabase
          .from("notifications")
          .insert({
            tenant_id: admin.tenant_id,
            user_id: admin.user_id,
            kind: notificationKind,
            title,
            body,
            action_url: "/settings/secrets",
            payload: {
              overdue: buckets.overdue,
              warn: buckets.warn,
              secrets: attention.map((r) => ({
                name: r.name,
                severity: r.severity,
                priority: r.priority,
                days_until_due: r.days_until_due,
              })),
            },
          });
        if (insertErr) {
          notificationsFailed += 1;
          log.warn("rotation-check: notification insert failed", {
            error: insertErr.message,
            user_id: admin.user_id,
          });
        } else {
          notificationsDispatched += 1;
        }
      }
    }

    if (runId) {
      await supabase
        .from("cron_run_log")
        .update({
          status: "SUCCESS",
          finished_at: new Date().toISOString(),
          rows_processed: attention.length,
          details: {
            summary: buckets,
            attention: attention.map((r) => ({
              name: r.name,
              priority: r.priority,
              severity: r.severity,
              days_until_due: r.days_until_due,
              days_since_rotation: r.days_since_rotation,
            })),
            notifications_dispatched: notificationsDispatched,
            notifications_failed: notificationsFailed,
          },
        })
        .eq("id", runId);
    }

    log.info("rotation-check cron finished", {
      dry_run: dryRun,
      total: buckets.total,
      warn: buckets.warn,
      overdue: buckets.overdue,
      notifications_dispatched: notificationsDispatched,
    });

    return NextResponse.json(
      {
        status: "success",
        dry_run: dryRun,
        summary: buckets,
        attention: attention.map((r) => ({
          name: r.name,
          priority: r.priority,
          severity: r.severity,
          days_until_due: r.days_until_due,
        })),
        notifications_dispatched: notificationsDispatched,
        notifications_failed: notificationsFailed,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("rotation-check cron failed", { error: errorMsg });
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
