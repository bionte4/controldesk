import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { ARCHIVE_BUCKET } from "@/lib/retention/config";
import type { SupabaseServiceClient } from "@/lib/retention/archive";

/**
 * ControlDesk — cold-archive verify helper (rules §22).
 *
 * Given a `data_archives` row id, this function:
 *   1. Downloads the gzip'd NDJSON blob at `storage_path` via service_role.
 *   2. Un-gzips → recomputes SHA-256 over the plaintext.
 *   3. Compares the recomputed checksum against `checksum_sha256`.
 *   4. If it matches, stamps `restore_verified_at = now()`.
 *
 * Never mutates the source rows — this is a purely read-side "does the
 * cold copy still match what the registry claimed at write-time?" check.
 * That is exactly the guarantee auditors ask for during a 10-year
 * retention window.
 */

export type VerifyOk = {
  ok: true;
  bytes_read: number;
  recomputed_checksum: string;
  verified_at: string;
};

export type VerifyErr = {
  ok: false;
  code:
    | "NOT_FOUND"
    | "WRONG_STATUS"
    | "DOWNLOAD_FAILED"
    | "CHECKSUM_MISMATCH"
    | "UPDATE_FAILED";
  reason: string;
};

export type VerifyResult = VerifyOk | VerifyErr;

export type ArchiveRegistryRow = {
  id: string;
  tenant_id: string;
  storage_path: string;
  checksum_sha256: string;
  status: string;
  bytes_written: number;
};

/**
 * Recompute the checksum of gzip'd NDJSON bytes. Pure — exported for
 * testing without any Supabase client.
 */
export function checksumOf(bytes: Uint8Array | Buffer): {
  bytes_read: number;
  ndjson_length: number;
  checksum: string;
} {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const plaintext = gunzipSync(buf);
  const checksum = createHash("sha256").update(plaintext).digest("hex");
  return {
    bytes_read: buf.byteLength,
    ndjson_length: plaintext.byteLength,
    checksum,
  };
}

/**
 * Fetch registry row + verify blob. Split from `verifyArchive` so unit
 * tests can call this without a Supabase fake.
 */
export function compareChecksum(
  row: Pick<ArchiveRegistryRow, "checksum_sha256">,
  recomputed: string,
): { match: boolean } {
  return {
    match:
      row.checksum_sha256.length > 0 &&
      row.checksum_sha256.toLowerCase() === recomputed.toLowerCase(),
  };
}

export async function verifyArchive(
  supabase: SupabaseServiceClient,
  input: { registry_id: string; tenant_id: string },
): Promise<VerifyResult> {
  const { data: row, error } = await supabase
    .from("data_archives")
    .select(
      "id, tenant_id, storage_path, checksum_sha256, status, bytes_written",
    )
    .eq("id", input.registry_id)
    .eq("tenant_id", input.tenant_id)
    .maybeSingle();

  if (error || !row) {
    return {
      ok: false,
      code: "NOT_FOUND",
      reason: error?.message ?? "archive not found",
    };
  }
  const registry = row as ArchiveRegistryRow;

  if (registry.status !== "ARCHIVED" && registry.status !== "RESTORED") {
    return {
      ok: false,
      code: "WRONG_STATUS",
      reason: `cannot verify archive in status ${registry.status}`,
    };
  }

  const dl = await supabase.storage
    .from(ARCHIVE_BUCKET)
    .download(registry.storage_path);

  if (dl.error || !dl.data) {
    return {
      ok: false,
      code: "DOWNLOAD_FAILED",
      reason: dl.error?.message ?? "empty download",
    };
  }

  const bytes = new Uint8Array(await dl.data.arrayBuffer());
  const { bytes_read, checksum } = checksumOf(bytes);

  const cmp = compareChecksum(registry, checksum);
  if (!cmp.match) {
    return {
      ok: false,
      code: "CHECKSUM_MISMATCH",
      reason: `recomputed ${checksum} != stored ${registry.checksum_sha256}`,
    };
  }

  const nowIso = new Date().toISOString();
  const upd = await supabase
    .from("data_archives")
    .update({ status: "RESTORED", restore_verified_at: nowIso })
    .eq("id", registry.id)
    .eq("tenant_id", registry.tenant_id);

  if (upd.error) {
    return {
      ok: false,
      code: "UPDATE_FAILED",
      reason: upd.error.message,
    };
  }

  return {
    ok: true,
    bytes_read,
    recomputed_checksum: checksum,
    verified_at: nowIso,
  };
}

/**
 * Create a short-lived signed URL for downloading an archive blob.
 * TTL default 300s per rules §19.
 */
export async function signArchiveDownloadUrl(
  supabase: SupabaseServiceClient,
  input: {
    registry_id: string;
    tenant_id: string;
    ttl_seconds?: number;
  },
): Promise<
  | { ok: true; url: string; expires_in: number; storage_path: string }
  | { ok: false; reason: string }
> {
  const ttl = Math.max(30, Math.min(900, input.ttl_seconds ?? 300));

  const { data: row, error } = await supabase
    .from("data_archives")
    .select("storage_path, tenant_id, status")
    .eq("id", input.registry_id)
    .eq("tenant_id", input.tenant_id)
    .maybeSingle();
  if (error || !row) {
    return { ok: false, reason: error?.message ?? "archive not found" };
  }
  if (row.status === "PURGED") {
    return { ok: false, reason: "archive was purged" };
  }

  const signed = await supabase.storage
    .from(ARCHIVE_BUCKET)
    .createSignedUrl(row.storage_path, ttl);
  if (signed.error || !signed.data?.signedUrl) {
    return { ok: false, reason: signed.error?.message ?? "sign failed" };
  }
  return {
    ok: true,
    url: signed.data.signedUrl,
    expires_in: ttl,
    storage_path: row.storage_path,
  };
}
