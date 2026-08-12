import { NextResponse } from "next/server";

import { log } from "@/lib/observability/log";
import {
  ARCHIVE_TARGETS,
  type ArchiveTarget,
} from "@/lib/retention/config";
import {
  defaultArchiveYear,
  runArchiveJob,
  type ArchiveBatchResult,
} from "@/lib/retention/archive";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Cold-storage archive cron endpoint (rules §22).
 *
 *   POST /api/cron/archive                           → run against all targets, default year
 *   POST /api/cron/archive?year=2024                 → override batch year
 *   POST /api/cron/archive?target=security_audit_logs → single target
 *   POST /api/cron/archive?dry_run=true              → serialize + checksum only
 *
 * Every batch:
 *   1. Serializes rows into deterministic NDJSON (sorted keys, `\n` delimited).
 *   2. Gzips + uploads to `tenant-archives/{tenant}/{table}/{year}.ndjson.gz`.
 *   3. Registers a `data_archives` row with row_count, bytes, SHA-256.
 *
 * The retention worker never hard-purges financial rows unless there is a
 * matching ARCHIVED registry row.
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

function parseYear(url: URL): number {
  const raw = url.searchParams.get("year");
  if (!raw) return defaultArchiveYear(new Date());
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 2000 || parsed > 2999) {
    throw new Error(`invalid year: ${raw}`);
  }
  return parsed;
}

function parseTargets(url: URL): ArchiveTarget[] {
  const raw = url.searchParams.get("target");
  if (!raw) return Object.keys(ARCHIVE_TARGETS) as ArchiveTarget[];
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as ArchiveTarget[];
  const allowed = Object.keys(ARCHIVE_TARGETS) as ArchiveTarget[];
  for (const p of parts) {
    if (!allowed.includes(p)) throw new Error(`unknown target: ${p}`);
  }
  return parts;
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    log.warn("archive cron: unauthorized invocation");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "true";
  let year: number;
  let targets: ArchiveTarget[];
  try {
    year = parseYear(url);
    targets = parseTargets(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: "failed", error: msg },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();
  const { data: runInsert } = await supabase
    .from("cron_run_log")
    .insert({
      job_name: "archive",
      status: "RUNNING",
      dry_run: dryRun,
      details: { year, targets },
    })
    .select("id")
    .single();
  const runId = runInsert?.id ?? null;

  try {
    const results = [];
    let grandRows = 0;
    let grandBytes = 0;
    const allBatches: ArchiveBatchResult[] = [];

    for (const target of targets) {
      const out = await runArchiveJob(supabase, {
        target,
        year,
        dry_run: dryRun,
      });
      results.push({
        target,
        year,
        total_rows: out.total_rows,
        total_bytes: out.total_bytes,
        batch_count: out.batches.length,
      });
      grandRows += out.total_rows;
      grandBytes += out.total_bytes;
      allBatches.push(...out.batches);
    }

    if (runId) {
      await supabase
        .from("cron_run_log")
        .update({
          status: "SUCCESS",
          finished_at: new Date().toISOString(),
          rows_processed: grandRows,
          details: {
            year,
            targets,
            total_bytes: grandBytes,
            results,
            batches: allBatches,
          },
        })
        .eq("id", runId);
    }

    log.info("archive cron finished", {
      year,
      dry_run: dryRun,
      total_rows: grandRows,
      total_bytes: grandBytes,
    });

    return NextResponse.json(
      {
        status: "success",
        dry_run: dryRun,
        year,
        targets,
        rows_processed: grandRows,
        bytes_written: grandBytes,
        results,
        batches: allBatches,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error("archive cron failed", { error: errorMsg });
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
