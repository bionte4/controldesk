import { NextResponse } from "next/server";

import { log } from "@/lib/observability/log";
import {
  RETENTION_POLICIES,
  type RetentionPolicy,
  type RetentionTarget,
} from "@/lib/retention/config";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Retention cron endpoint (rules §22).
 *
 * `POST /api/cron/retention`
 * `POST /api/cron/retention?dry_run=true`
 *
 * Actions performed:
 *   1. Hard-purge `notifications`, `ai_insights`, and `employee_rosters`
 *      that are past their `hard_purge_after_days` window.
 *   2. Anonymise employees whose `terminated_at` is more than 5 years ago
 *      by calling the SQL `anonymize_terminated_employee` function.
 *
 * Financial tables (`project_expenses`, `cash_advances`, `petty_cash_*`)
 * are kept 10 years — the job flags them for archive at year 2 but never
 * hard-purges until the retention deadline (§22). Rows past 10 years are
 * hard-deleted here.
 *
 * Wire-up:
 *   `vercel.json` cron: `{ "path": "/api/cron/retention", "schedule": "0 3 * * *" }`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TaskResult = {
  target: RetentionTarget | "hr_termination_anonymisation";
  action: "hard_purge" | "anonymise";
  cutoff_iso: string;
  rows_processed: number;
  dry_run: boolean;
  note?: string;
};

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
    log.warn("retention cron: unauthorized invocation");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date();
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "true";
  const supabase = createServiceRoleClient();

  const { data: runInsert } = await supabase
    .from("cron_run_log")
    .insert({
      job_name: "retention",
      status: "RUNNING",
      dry_run: dryRun,
    })
    .select("id")
    .single();
  const runId = runInsert?.id ?? null;

  try {
    const results: TaskResult[] = [];

    // --- Hard-purge tasks per config. ---
    for (const target of Object.keys(RETENTION_POLICIES) as RetentionTarget[]) {
      const policy: RetentionPolicy = RETENTION_POLICIES[target];
      if (policy.hard_purge_after_days === null) continue;
      const cutoff = cutoffIso(startedAt, policy.hard_purge_after_days);
      const purged = await purgeTarget(supabase, target, cutoff, dryRun);
      results.push({
        target,
        action: "hard_purge",
        cutoff_iso: cutoff,
        rows_processed: purged,
        dry_run: dryRun,
        note: policy.note,
      });
    }

    // --- HR anonymisation task. ---
    const hrCutoff = cutoffIso(startedAt, 365 * 5); // 5 years post-termination
    const anonymised = await anonymiseTerminatedEmployees(
      supabase,
      hrCutoff,
      dryRun,
    );
    results.push({
      target: "hr_termination_anonymisation",
      action: "anonymise",
      cutoff_iso: hrCutoff,
      rows_processed: anonymised,
      dry_run: dryRun,
      note: "Anonymise PII of employees terminated >5 years ago (rules §22).",
    });

    const totalRows = results.reduce((acc, r) => acc + r.rows_processed, 0);

    if (runId) {
      await supabase
        .from("cron_run_log")
        .update({
          status: "SUCCESS",
          finished_at: new Date().toISOString(),
          rows_processed: totalRows,
          details: { tasks: results },
        })
        .eq("id", runId);
    }

    log.info("retention cron finished", {
      dry_run: dryRun,
      total_rows: totalRows,
    });

    return NextResponse.json(
      {
        status: "success",
        dry_run: dryRun,
        started_at: startedAt.toISOString(),
        rows_processed: totalRows,
        tasks: results,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("retention cron failed", { error: errorMsg });
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
// Task implementations
// ---------------------------------------------------------------------------
type SupabaseClient = ReturnType<typeof createServiceRoleClient>;

async function purgeTarget(
  supabase: SupabaseClient,
  target: RetentionTarget,
  cutoffIsoStr: string,
  dryRun: boolean,
): Promise<number> {
  // Only wire up targets whose business tables actually exist today.
  switch (target) {
    case "notifications": {
      const q = supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .lt("created_at", cutoffIsoStr);
      const countRes = await q;
      const count = countRes.count ?? 0;
      if (dryRun || count === 0) return count;
      const del = await supabase
        .from("notifications")
        .delete()
        .lt("created_at", cutoffIsoStr);
      if (del.error) throw new Error(del.error.message);
      return count;
    }
    case "ai_insights": {
      const q = supabase
        .from("ai_insights")
        .select("id", { count: "exact", head: true })
        .lt("created_at", cutoffIsoStr);
      const countRes = await q;
      const count = countRes.count ?? 0;
      if (dryRun || count === 0) return count;
      const del = await supabase
        .from("ai_insights")
        .delete()
        .lt("created_at", cutoffIsoStr);
      if (del.error) throw new Error(del.error.message);
      return count;
    }
    case "hr_requests": {
      const q = supabase
        .from("hr_requests")
        .select("id", { count: "exact", head: true })
        .in("status", ["APPROVED", "REJECTED", "CANCELLED"])
        .lt("created_at", cutoffIsoStr);
      const countRes = await q;
      const count = countRes.count ?? 0;
      if (dryRun || count === 0) return count;
      const del = await supabase
        .from("hr_requests")
        .delete()
        .in("status", ["APPROVED", "REJECTED", "CANCELLED"])
        .lt("created_at", cutoffIsoStr);
      if (del.error) throw new Error(del.error.message);
      return count;
    }
    case "employee_rosters": {
      const q = supabase
        .from("employee_rosters")
        .select("id", { count: "exact", head: true })
        .lt("work_date", cutoffIsoStr.slice(0, 10));
      const countRes = await q;
      const count = countRes.count ?? 0;
      if (dryRun || count === 0) return count;
      const del = await supabase
        .from("employee_rosters")
        .delete()
        .lt("work_date", cutoffIsoStr.slice(0, 10));
      if (del.error) throw new Error(del.error.message);
      return count;
    }
    case "security_audit_logs":
      return purgeArchivedRows(supabase, {
        source: "security_audit_logs",
        cutoffIso: cutoffIsoStr,
        dryRun,
      });
    case "cash_advances":
      return purgeArchivedRows(supabase, {
        source: "cash_advances",
        cutoffIso: cutoffIsoStr,
        dryRun,
      });
    case "project_expenses":
      return purgeArchivedRows(supabase, {
        source: "project_expenses",
        cutoffIso: cutoffIsoStr,
        dryRun,
      });
    case "cash_advance_settlements_receipts":
    case "petty_cash_vouchers_receipts": {
      // Purge policy for receipts is tied to the parent (`cash_advances` /
      // `petty_cash_vouchers`) via FK cascade — leave to those cases.
      return 0;
    }
    default:
      return 0;
  }
}

/**
 * Purge rows only when a matching `data_archives` row with status ARCHIVED
 * exists that covers the row's created_at (rules §22). This is the guard
 * that keeps the retention worker safe: no cold copy → no purge.
 */
async function purgeArchivedRows(
  supabase: SupabaseClient,
  input: {
    source:
      | "security_audit_logs"
      | "cash_advances"
      | "project_expenses"
      | "petty_cash_vouchers";
    cutoffIso: string;
    dryRun: boolean;
  },
): Promise<number> {
  const { data: archives, error } = await supabase
    .from("data_archives")
    .select("id,tenant_id,batch_start,batch_end,row_count")
    .eq("source_table", input.source)
    .eq("status", "ARCHIVED")
    .lte("batch_end", input.cutoffIso)
    .limit(200);
  if (error) throw new Error(error.message);
  if (!archives || archives.length === 0) return 0;

  let totalPurged = 0;
  for (const batch of archives) {
    const timeColumn = "created_at";
    const q = supabase
      .from(input.source)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", batch.tenant_id)
      .gte(timeColumn, batch.batch_start)
      .lt(timeColumn, batch.batch_end);
    const countRes = await q;
    const count = countRes.count ?? 0;

    if (count === 0) {
      if (!input.dryRun) {
        await supabase
          .from("data_archives")
          .update({
            status: "PURGED",
            purged_at: new Date().toISOString(),
            purged_row_count: 0,
          })
          .eq("id", batch.id);
      }
      continue;
    }

    if (input.dryRun) {
      totalPurged += count;
      continue;
    }

    if (input.source === "security_audit_logs") {
      // Bypass the append-only trigger via SECURITY DEFINER RPC.
      const { data: rpcCount, error: rpcErr } = await supabase.rpc(
        "purge_archived_audit_logs",
        {
          p_tenant_id: batch.tenant_id,
          p_batch_start: batch.batch_start,
          p_batch_end: batch.batch_end,
        },
      );
      if (rpcErr) throw new Error(rpcErr.message);
      totalPurged += typeof rpcCount === "number" ? rpcCount : count;
      continue;
    }

    const del = await supabase
      .from(input.source)
      .delete()
      .eq("tenant_id", batch.tenant_id)
      .gte(timeColumn, batch.batch_start)
      .lt(timeColumn, batch.batch_end);
    if (del.error) throw new Error(del.error.message);

    await supabase
      .from("data_archives")
      .update({
        status: "PURGED",
        purged_at: new Date().toISOString(),
        purged_row_count: count,
      })
      .eq("id", batch.id);
    totalPurged += count;
  }
  return totalPurged;
}

async function anonymiseTerminatedEmployees(
  supabase: SupabaseClient,
  cutoffIsoStr: string,
  dryRun: boolean,
): Promise<number> {
  const { data, error } = await supabase
    .from("employees")
    .select("id")
    .not("terminated_at", "is", null)
    .is("pii_anonymized_at", null)
    .lt("terminated_at", cutoffIsoStr);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (dryRun) return rows.length;

  let processed = 0;
  for (const row of rows) {
    const { error: fnErr } = await supabase.rpc(
      "anonymize_terminated_employee",
      { p_employee_id: row.id },
    );
    if (fnErr) {
      log.warn("retention: anonymise employee failed", {
        employee_id: row.id,
        error: fnErr.message,
      });
      continue;
    }
    processed += 1;
  }
  return processed;
}
