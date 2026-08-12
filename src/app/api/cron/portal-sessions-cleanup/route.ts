import { NextResponse } from "next/server";

import { log } from "@/lib/observability/log";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Portal sessions cleanup cron (rules §28 B.4 admin).
 *
 * `POST /api/cron/portal-sessions-cleanup`
 * `POST /api/cron/portal-sessions-cleanup?dry_run=true`
 *
 * Purges rows from `client_user_sessions` that are irrelevant for audit:
 *   1. **Expired sessions** — `expires_at < now() - 30 days`.
 *      (Cookie already stops working the moment `expires_at` is reached; we
 *      keep 30 days of tail data for forensics before hard-deleting.)
 *   2. **Revoked sessions** — `revoked_at < now() - 30 days`.
 *      Same forensic tail rationale.
 *
 * Login events (`portal_login_events`) are NOT touched — they're audit
 * records with a 7-year retention (rules §22, mirrors `security_audit_logs`).
 *
 * Wire-up:
 *   `vercel.json` cron entry:
 *     `{ "path": "/api/cron/portal-sessions-cleanup", "schedule": "0 4 * * *" }`
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` (or Vercel Cron signature).
 * Falls open in non-production when `CRON_SECRET` is unset — mirrors the
 * `retention` route for symmetric dev ergonomics.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TAIL_DAYS = 30;

async function isAuthorized(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  const vercelHeader = request.headers.get("x-vercel-cron-signature");
  return !!vercelHeader && vercelHeader === secret;
}

function cutoffIso(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    log.warn("portal-sessions-cleanup: unauthorized invocation");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "true";
  const supabase = createServiceRoleClient();

  const { data: runInsert } = await supabase
    .from("cron_run_log")
    .insert({
      job_name: "portal_sessions_cleanup",
      status: "RUNNING",
      dry_run: dryRun,
    })
    .select("id")
    .single();
  const runId = runInsert?.id ?? null;

  try {
    const expiredCutoff = cutoffIso(startedAt, TAIL_DAYS);

    // --- 1. Count + purge expired sessions (never revoked, past TTL). ---
    const { count: expiredCount, error: expiredCountErr } = await supabase
      .from("client_user_sessions")
      .select("id", { count: "exact", head: true })
      .lt("expires_at", expiredCutoff)
      .is("revoked_at", null);
    if (expiredCountErr) throw new Error(expiredCountErr.message);
    let expiredPurged = expiredCount ?? 0;
    if (!dryRun && expiredPurged > 0) {
      const { error: expiredDelErr } = await supabase
        .from("client_user_sessions")
        .delete()
        .lt("expires_at", expiredCutoff)
        .is("revoked_at", null);
      if (expiredDelErr) throw new Error(expiredDelErr.message);
    } else if (dryRun) {
      // Keep the count for the dry-run response; nothing else to do.
    } else {
      expiredPurged = 0;
    }

    // --- 2. Count + purge revoked sessions past the tail. ---
    const { count: revokedCount, error: revokedCountErr } = await supabase
      .from("client_user_sessions")
      .select("id", { count: "exact", head: true })
      .lt("revoked_at", expiredCutoff);
    if (revokedCountErr) throw new Error(revokedCountErr.message);
    let revokedPurged = revokedCount ?? 0;
    if (!dryRun && revokedPurged > 0) {
      const { error: revokedDelErr } = await supabase
        .from("client_user_sessions")
        .delete()
        .lt("revoked_at", expiredCutoff);
      if (revokedDelErr) throw new Error(revokedDelErr.message);
    } else if (dryRun) {
      // Keep the count for the dry-run response.
    } else {
      revokedPurged = 0;
    }

    const totalRows = expiredPurged + revokedPurged;

    if (runId) {
      await supabase
        .from("cron_run_log")
        .update({
          status: "SUCCESS",
          finished_at: new Date().toISOString(),
          rows_processed: totalRows,
          details: {
            cutoff_iso: expiredCutoff,
            expired_purged: expiredPurged,
            revoked_purged: revokedPurged,
          },
        })
        .eq("id", runId);
    }

    log.info("portal-sessions-cleanup finished", {
      dry_run: dryRun,
      expired: expiredPurged,
      revoked: revokedPurged,
      total: totalRows,
    });

    return NextResponse.json(
      {
        status: "success",
        dry_run: dryRun,
        started_at: startedAt.toISOString(),
        cutoff_iso: expiredCutoff,
        expired_purged: expiredPurged,
        revoked_purged: revokedPurged,
        rows_processed: totalRows,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("portal-sessions-cleanup failed", { error: errorMsg });
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

