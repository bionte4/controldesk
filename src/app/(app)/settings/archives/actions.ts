"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { archiveIdSchema } from "@/lib/validation/archive";
import { signArchiveDownloadUrl, verifyArchive } from "@/lib/retention/verify";

/**
 * Ops-only actions on the `data_archives` registry (rules §22).
 *
 * `signArchiveUrlAction`  — TTL-bounded (300s) signed URL for downloading
 *                           the cold-storage blob. PDP `export` verb —
 *                           TENANT_ADMIN + GENERAL_MANAGER.
 * `verifyArchiveAction`   — Re-downloads the blob, recomputes SHA-256,
 *                           updates `restore_verified_at` on match. PDP
 *                           `update` verb — TENANT_ADMIN only.
 *
 * Both use the service_role client because the `tenant-archives` bucket
 * RLS is scoped by path prefix and the anon-key client cannot list its
 * contents. The wrapper still enforces PDP + tenant isolation, so a call
 * from an unauthorised role is rejected before we ever touch storage.
 */

export const signArchiveUrlAction = withSecureAction({
  schema: archiveIdSchema,
  resource: "data_archive",
  action: "export",
  auditAction: "EXPORT",
  auditResourceName: "data_archives",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = createServiceRoleClient();
    const res = await signArchiveDownloadUrl(supabase, {
      registry_id: input.id,
      tenant_id: ctx.actor.tenantId,
      ttl_seconds: 300,
    });
    if (!res.ok) {
      throw new Error(res.reason);
    }

    return {
      result: {
        url: res.url,
        expires_in: res.expires_in,
        storage_path: res.storage_path,
      },
      auditResourceId: input.id,
      auditMetadata: {
        storage_path: res.storage_path,
        ttl_seconds: res.expires_in,
      },
    };
  },
});

export const verifyArchiveAction = withSecureAction({
  schema: archiveIdSchema,
  resource: "data_archive",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "data_archives",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = createServiceRoleClient();
    const res = await verifyArchive(supabase, {
      registry_id: input.id,
      tenant_id: ctx.actor.tenantId,
    });
    if (!res.ok) {
      throw new Error(`${res.code}: ${res.reason}`);
    }

    revalidatePath("/settings/archives");

    return {
      result: {
        recomputed_checksum: res.recomputed_checksum,
        verified_at: res.verified_at,
        bytes_read: res.bytes_read,
      },
      auditResourceId: input.id,
      auditNewValues: {
        status: "RESTORED",
        restore_verified_at: res.verified_at,
      },
      auditMetadata: {
        recomputed_checksum: res.recomputed_checksum,
        bytes_read: res.bytes_read,
      },
    };
  },
});
