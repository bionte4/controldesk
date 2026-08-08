import "server-only";

import { randomUUID } from "node:crypto";

import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

import {
  ALLOWED_MIME_TYPES,
  BUCKET_ID,
  DEFAULT_MAX_BYTES,
  SIGNED_URL_TTL_SECONDS,
  isAllowedMime,
  type AllowedMime,
} from "./constants";

export {
  ALLOWED_MIME_TYPES,
  BUCKET_ID,
  DEFAULT_MAX_BYTES,
  SIGNED_URL_TTL_SECONDS,
  isAllowedMime,
  type AllowedMime,
};

/**
 * Attachments helper (rules §19).
 *
 * Storage layout: private bucket `tenant-attachments`, path convention
 *   `{tenant_id}/{resource_type}/{resource_id}/{filename_uuid.ext}`
 *
 * MIME allowlist enforced at DB + storage bucket level:
 *   image/jpeg, image/png, image/webp, application/pdf
 *
 * Max file size: 10 MB (bucket-level). Contract PDFs may override in the
 * app layer via `MAX_BYTES_CONTRACT` if we ever add a dedicated path.
 *
 * Never expose public URLs — always issue short-lived signed URLs (TTL 300s).
 */

export type AttachmentResourceType =
  | "project_expense"
  | "cash_advance"
  | "cash_advance_settlement"
  | "petty_cash_voucher"
  | "petty_cash_replenishment"
  | "project_issue"
  | "hr_request"
  | "bpo_contract"
  | "employee_avatar"
  | "monthly_report";

export type AttachmentRow = Tables<"attachments">;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function extensionForMime(mime: AllowedMime, fallbackName: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    default: {
      // Compile-time exhaustiveness fallback; also derive from filename.
      const idx = fallbackName.lastIndexOf(".");
      return idx > -1 ? fallbackName.slice(idx + 1).toLowerCase() : "bin";
    }
  }
}

/**
 * Build the canonical storage path for a new file (rules §19).
 * The path is deterministic per (tenant, resource, resource_id) but the
 * final segment is randomised so the same original filename uploaded twice
 * lands as two distinct objects.
 */
export function buildStoragePath(input: {
  tenantId: string;
  resourceType: AttachmentResourceType;
  resourceId: string;
  originalName: string;
  mime: AllowedMime;
}): string {
  const uuid = randomUUID();
  const ext = extensionForMime(input.mime, input.originalName);
  return `${input.tenantId}/${input.resourceType}/${input.resourceId}/${uuid}.${ext}`;
}

// ---------------------------------------------------------------------------
// Upload — accepts a File / Blob from a Server Action FormData.
// Runs entirely server-side via the RLS-scoped client, so tenant isolation
// is guaranteed by the storage RLS policies (see 0007_storage_buckets.sql).
// ---------------------------------------------------------------------------

export type UploadResult = {
  attachment: AttachmentRow;
  storagePath: string;
};

export async function uploadAttachment(input: {
  tenantId: string;
  uploaderEmployeeId: string;
  resourceType: AttachmentResourceType;
  resourceId: string;
  file: File;
  maxBytes?: number;
}): Promise<UploadResult> {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;

  if (!isAllowedMime(input.file.type)) {
    throw new Error(
      `Unsupported file type "${input.file.type}". Allowed: ${ALLOWED_MIME_TYPES.join(", ")}.`,
    );
  }
  if (input.file.size > maxBytes) {
    throw new Error(
      `File too large: ${(input.file.size / 1024 / 1024).toFixed(1)} MB (max ${maxBytes / 1024 / 1024} MB).`,
    );
  }

  const storagePath = buildStoragePath({
    tenantId: input.tenantId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    originalName: input.file.name,
    mime: input.file.type as AllowedMime,
  });

  const supabase = await createClient();

  // 1. Upload to storage. `upsert: false` — path is unique per uuid.
  const arrayBuffer = await input.file.arrayBuffer();
  const { error: upErr } = await supabase.storage
    .from(BUCKET_ID)
    .upload(storagePath, arrayBuffer, {
      contentType: input.file.type,
      upsert: false,
    });
  if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

  // 2. Register in `attachments`. On failure we roll back the storage
  // upload to avoid orphaned files.
  const { data: attachment, error: dbErr } = await supabase
    .from("attachments")
    .insert({
      tenant_id: input.tenantId,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      storage_path: storagePath,
      filename: input.file.name,
      mime_type: input.file.type,
      size_bytes: input.file.size,
      uploaded_by: input.uploaderEmployeeId,
    })
    .select()
    .single();

  if (dbErr || !attachment) {
    await supabase.storage.from(BUCKET_ID).remove([storagePath]).catch(() => {
      // best-effort cleanup — the object is orphaned but signed URL TTL is
      // short so exposure risk is bounded.
    });
    throw new Error(dbErr?.message ?? "Attachment registry insert failed.");
  }

  return { attachment, storagePath };
}

// ---------------------------------------------------------------------------
// List attachments for a resource.
// ---------------------------------------------------------------------------

export async function listAttachments(
  resourceType: AttachmentResourceType,
  resourceId: string,
): Promise<AttachmentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attachments")
    .select("*")
    .eq("resource_type", resourceType)
    .eq("resource_id", resourceId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Signed URL — for display / download in the UI.
// ---------------------------------------------------------------------------

export type SignedAttachment = AttachmentRow & { signed_url: string };

export async function attachmentsWithSignedUrls(
  attachments: AttachmentRow[],
): Promise<SignedAttachment[]> {
  if (attachments.length === 0) return [];
  const supabase = await createClient();
  const paths = attachments.map((a) => a.storage_path);
  const { data, error } = await supabase.storage
    .from(BUCKET_ID)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(error.message);

  const urlByPath = new Map<string, string>();
  (data ?? []).forEach((entry, i) => {
    if (entry.signedUrl) urlByPath.set(paths[i], entry.signedUrl);
  });

  return attachments.map((a) => ({
    ...a,
    signed_url: urlByPath.get(a.storage_path) ?? "",
  }));
}

/** Convenience: list + sign in one call. */
export async function listAttachmentsSigned(
  resourceType: AttachmentResourceType,
  resourceId: string,
): Promise<SignedAttachment[]> {
  const rows = await listAttachments(resourceType, resourceId);
  return attachmentsWithSignedUrls(rows);
}

// ---------------------------------------------------------------------------
// Delete — removes both the storage object and the registry row.
// The RLS policies enforce that only uploader/admin can delete.
// ---------------------------------------------------------------------------

export async function deleteAttachment(id: string): Promise<void> {
  const supabase = await createClient();

  const { data: row, error: readErr } = await supabase
    .from("attachments")
    .select("id, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!row) throw new Error("Attachment not found or not accessible.");

  // Delete registry row first — RLS decides authorisation. Only if the
  // DB delete succeeds do we prune the storage object.
  const { error: delErr } = await supabase
    .from("attachments")
    .delete()
    .eq("id", id);
  if (delErr) throw new Error(delErr.message);

  const { error: rmErr } = await supabase.storage
    .from(BUCKET_ID)
    .remove([row.storage_path]);
  if (rmErr) {
    // Registry gone but storage object remains — log for cleanup cron. The
    // UI treats missing objects gracefully via the signed-URL 404 path.
    console.warn(
      `[attachments] Orphan storage object at ${row.storage_path}: ${rmErr.message}`,
    );
  }
}
