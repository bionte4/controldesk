import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { log } from "@/lib/observability/log";
import {
  ARCHIVE_BUCKET,
  ARCHIVE_TARGETS,
  buildArchivePath,
  yearBatchRange,
  type ArchiveTarget,
} from "@/lib/retention/config";
import type { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * ControlDesk — cold-storage archive engine (rules §22).
 *
 * Contract:
 *   • Fetch source rows within a calendar-year batch.
 *   • Serialize deterministically to NDJSON (one JSON object per line).
 *   • Gzip and upload to `tenant-archives` at a deterministic path.
 *   • Insert a `data_archives` row with row_count, bytes, and SHA-256 checksum.
 *   • Mark status ARCHIVED (source rows remain — retention worker purges later).
 *
 * All functions in this file are safe to unit-test with in-memory fakes.
 * The only I/O is via the injected Supabase-like client (service_role in prod).
 */

export type SupabaseServiceClient = ReturnType<typeof createServiceRoleClient>;

export type ArchiveJobInput = {
  target: ArchiveTarget;
  year: number;
  tenant_ids?: string[]; // optional restrict; default: all tenants with rows
  dry_run: boolean;
};

export type ArchiveJobOutput = {
  target: ArchiveTarget;
  year: number;
  batches: ArchiveBatchResult[];
  total_rows: number;
  total_bytes: number;
};

export type ArchiveBatchResult = {
  tenant_id: string;
  target: ArchiveTarget;
  year: number;
  row_count: number;
  bytes_written: number;
  storage_path: string;
  checksum_sha256: string;
  registry_id: string | null;
  dry_run: boolean;
  skipped_reason?: string;
};

/**
 * Deterministic NDJSON serializer. Sorts object keys recursively so the
 * checksum is stable regardless of PostgREST column ordering.
 */
export function serializeNDJSON(rows: readonly Record<string, unknown>[]): {
  ndjson: string;
  checksum: string;
} {
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(canonicalJson(row));
  }
  const ndjson = lines.join("\n");
  const checksum = createHash("sha256").update(ndjson, "utf8").digest("hex");
  return { ndjson, checksum };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
    .join(",")}}`;
}

/**
 * Compress + return raw bytes ready for upload.
 */
export function packArchive(ndjson: string): {
  bytes: Uint8Array;
  bytes_written: number;
} {
  const gzipped = gzipSync(Buffer.from(ndjson, "utf8"));
  return { bytes: new Uint8Array(gzipped), bytes_written: gzipped.byteLength };
}

/**
 * Fetch rows for a batch. Pages through PostgREST 1k at a time to avoid
 * hitting single-row-set limits on high-volume tables like audit logs.
 */
export async function fetchBatchRows(
  supabase: SupabaseServiceClient,
  input: {
    tenant_id: string;
    target: ArchiveTarget;
    year: number;
  },
): Promise<Record<string, unknown>[]> {
  const cfg = ARCHIVE_TARGETS[input.target];
  const { start_iso, end_iso } = yearBatchRange(input.year);
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase
      .from(cfg.source_table)
      .select("*")
      .eq("tenant_id", input.tenant_id)
      .gte(cfg.time_column, start_iso)
      .lt(cfg.time_column, end_iso)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`fetch ${input.target}: ${error.message}`);
    const chunk = (data ?? []) as Record<string, unknown>[];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

/**
 * Discover the set of tenants that have any rows in the source table for
 * the target year. Skips tenants with zero rows so we don't spin up empty
 * artifacts.
 */
export async function discoverTenantsWithRows(
  supabase: SupabaseServiceClient,
  input: { target: ArchiveTarget; year: number },
): Promise<string[]> {
  const cfg = ARCHIVE_TARGETS[input.target];
  const { start_iso, end_iso } = yearBatchRange(input.year);
  const { data, error } = await supabase
    .from(cfg.source_table)
    .select("tenant_id")
    .gte(cfg.time_column, start_iso)
    .lt(cfg.time_column, end_iso);
  if (error) throw new Error(`discover ${input.target}: ${error.message}`);
  const seen = new Set<string>();
  for (const row of (data ?? []) as Array<{ tenant_id: string | null }>) {
    if (row.tenant_id) seen.add(row.tenant_id);
  }
  return Array.from(seen).sort();
}

/**
 * Upload artifact + register batch. Idempotent per (tenant, target, year):
 * if a row already exists with status ARCHIVED / PURGED / RESTORED we skip.
 */
export async function archiveBatch(
  supabase: SupabaseServiceClient,
  input: {
    tenant_id: string;
    target: ArchiveTarget;
    year: number;
    dry_run: boolean;
  },
): Promise<ArchiveBatchResult> {
  const { start_iso, end_iso } = yearBatchRange(input.year);
  const storagePath = buildArchivePath({
    tenant_id: input.tenant_id,
    source_table: input.target,
    year: input.year,
  });

  const { data: existing } = await supabase
    .from("data_archives")
    .select("id,status,row_count,bytes_written,checksum_sha256")
    .eq("tenant_id", input.tenant_id)
    .eq("source_table", input.target)
    .eq("batch_start", start_iso)
    .eq("batch_end", end_iso)
    .maybeSingle();

  if (existing && existing.status !== "FAILED") {
    return {
      tenant_id: input.tenant_id,
      target: input.target,
      year: input.year,
      row_count: existing.row_count,
      bytes_written: existing.bytes_written,
      storage_path: storagePath,
      checksum_sha256: existing.checksum_sha256,
      registry_id: existing.id,
      dry_run: input.dry_run,
      skipped_reason: `already ${existing.status}`,
    };
  }

  const rows = await fetchBatchRows(supabase, {
    tenant_id: input.tenant_id,
    target: input.target,
    year: input.year,
  });

  if (rows.length === 0) {
    return {
      tenant_id: input.tenant_id,
      target: input.target,
      year: input.year,
      row_count: 0,
      bytes_written: 0,
      storage_path: storagePath,
      checksum_sha256: "",
      registry_id: null,
      dry_run: input.dry_run,
      skipped_reason: "empty batch",
    };
  }

  const { ndjson, checksum } = serializeNDJSON(rows);
  const { bytes, bytes_written } = packArchive(ndjson);

  if (input.dry_run) {
    return {
      tenant_id: input.tenant_id,
      target: input.target,
      year: input.year,
      row_count: rows.length,
      bytes_written,
      storage_path: storagePath,
      checksum_sha256: checksum,
      registry_id: null,
      dry_run: true,
    };
  }

  const uploadRes = await supabase.storage
    .from(ARCHIVE_BUCKET)
    .upload(storagePath, bytes, {
      contentType: "application/gzip",
      upsert: true,
    });
  if (uploadRes.error) {
    throw new Error(`upload ${storagePath}: ${uploadRes.error.message}`);
  }

  const insertRes = await supabase
    .from("data_archives")
    .upsert(
      {
        tenant_id: input.tenant_id,
        source_table: input.target,
        batch_start: start_iso,
        batch_end: end_iso,
        row_count: rows.length,
        bytes_written,
        storage_path: storagePath,
        checksum_sha256: checksum,
        status: "ARCHIVED",
      },
      { onConflict: "tenant_id,source_table,batch_start,batch_end" },
    )
    .select("id")
    .single();
  if (insertRes.error) {
    throw new Error(`registry insert: ${insertRes.error.message}`);
  }

  return {
    tenant_id: input.tenant_id,
    target: input.target,
    year: input.year,
    row_count: rows.length,
    bytes_written,
    storage_path: storagePath,
    checksum_sha256: checksum,
    registry_id: insertRes.data?.id ?? null,
    dry_run: false,
  };
}

/**
 * Run archives for one target across all eligible tenants for a given year.
 */
export async function runArchiveJob(
  supabase: SupabaseServiceClient,
  input: ArchiveJobInput,
): Promise<ArchiveJobOutput> {
  const tenants =
    input.tenant_ids ??
    (await discoverTenantsWithRows(supabase, {
      target: input.target,
      year: input.year,
    }));

  const batches: ArchiveBatchResult[] = [];
  let totalRows = 0;
  let totalBytes = 0;

  for (const tenant_id of tenants) {
    try {
      const res = await archiveBatch(supabase, {
        tenant_id,
        target: input.target,
        year: input.year,
        dry_run: input.dry_run,
      });
      batches.push(res);
      totalRows += res.row_count;
      totalBytes += res.bytes_written;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error("archive batch failed", {
        tenant_id,
        target: input.target,
        year: input.year,
        error: errorMsg,
      });
      batches.push({
        tenant_id,
        target: input.target,
        year: input.year,
        row_count: 0,
        bytes_written: 0,
        storage_path: buildArchivePath({
          tenant_id,
          source_table: input.target,
          year: input.year,
        }),
        checksum_sha256: "",
        registry_id: null,
        dry_run: input.dry_run,
        skipped_reason: `error: ${errorMsg}`,
      });

      if (!input.dry_run) {
        const { start_iso, end_iso } = yearBatchRange(input.year);
        await supabase
          .from("data_archives")
          .upsert(
            {
              tenant_id,
              source_table: input.target,
              batch_start: start_iso,
              batch_end: end_iso,
              row_count: 0,
              bytes_written: 0,
              storage_path: buildArchivePath({
                tenant_id,
                source_table: input.target,
                year: input.year,
              }),
              checksum_sha256: "",
              status: "FAILED",
              error_message: errorMsg,
            },
            { onConflict: "tenant_id,source_table,batch_start,batch_end" },
          );
      }
    }
  }

  return {
    target: input.target,
    year: input.year,
    batches,
    total_rows: totalRows,
    total_bytes: totalBytes,
  };
}

/**
 * Deterministically pick the *default* archive year: two calendar years
 * before the current UTC year. This matches
 * `RETENTION_POLICIES.*.archive_after_days = 365 * 2`.
 */
export function defaultArchiveYear(now: Date): number {
  return now.getUTCFullYear() - 2;
}
