import { NextResponse } from "next/server";

import { drainCalendarOutbox } from "@/lib/integrations/google-calendar/drain";
import { getCalendarPublisher } from "@/lib/integrations/google-calendar";
import { log } from "@/lib/observability/log";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Google Calendar drain (rules §7 + §18).
 *
 * `POST /api/cron/google-calendar-drain`
 * `POST /api/cron/google-calendar-drain?dry_run=true`
 *
 * Reads PENDING (or retry-eligible FAILED) rows from
 * `project_calendar_events`, hydrates the current project / milestone
 * state, resolves per-tenant Google credentials via
 * `get_google_credential_refresh_token`, and dispatches each event
 * through the active `CalendarPublisher`.
 *
 * Outcomes:
 *   * SENT     → status='SENT', sent_at=now(), google_event_id populated
 *   * SKIPPED  → status='SKIPPED', last_error='<reason>'
 *   * FAILED   → attempts++, last_error populated; row stays queryable by
 *                the next drain when it falls back into scheduled_at
 *                window (exponential backoff = 2^attempts minutes, capped
 *                at 6 hours).
 *
 * Wire-up: `vercel.json` runs this every 10 minutes.
 * Auth: standard `Bearer $CRON_SECRET` / `x-vercel-cron-signature`.
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
    log.warn("google-calendar-drain: unauthorized invocation");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "true";
  const supabase = createServiceRoleClient();
  const publisher = getCalendarPublisher();

  const { data: runInsert } = await supabase
    .from("cron_run_log")
    .insert({
      job_name: "google_calendar_drain",
      status: "RUNNING",
      dry_run: dryRun,
    })
    .select("id")
    .single();
  const runId = runInsert?.id ?? null;

  try {
    const result = await drainCalendarOutbox({
      supabase,
      publisher,
      dryRun,
      startedAt,
      // Small batch — we run every 10 minutes so latency > throughput.
      batchSize: 50,
    });

    if (runId) {
      await supabase
        .from("cron_run_log")
        .update({
          status: "SUCCESS",
          finished_at: new Date().toISOString(),
          rows_processed: result.total,
          details: {
            sent: result.sent,
            failed: result.failed,
            skipped: result.skipped,
            publisher: publisher.name,
          },
        })
        .eq("id", runId);
    }

    log.info("google-calendar-drain finished", {
      dry_run: dryRun,
      publisher: publisher.name,
      ...result,
    });

    return NextResponse.json(
      {
        status: "success",
        dry_run: dryRun,
        started_at: startedAt.toISOString(),
        publisher: publisher.name,
        ...result,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("google-calendar-drain failed", { error: errorMsg });
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
