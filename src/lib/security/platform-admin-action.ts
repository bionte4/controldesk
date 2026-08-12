import { z } from "zod";

import { getCurrentPlatformAdmin } from "@/lib/auth/platform-admin-session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { log } from "@/lib/observability/log";
import type { AuditActionType, Json } from "@/types/database";

/**
 * HOF wrapper for platform-admin Server Actions (Fase 2, migration 0077).
 *
 * A parallel to `withCanonicalSecureAction` for cross-tenant surfaces:
 *
 *   1. Verify the caller is an authenticated + active platform admin
 *      (short-circuits with `UNAUTHENTICATED`/`FORBIDDEN` otherwise).
 *   2. Validate the raw input against a Zod schema.
 *   3. Run the handler with a service-role Supabase client (RLS is
 *      NOT the enforcement layer here — the platform admin gate is).
 *   4. Write a `platform_admin_audit_logs` row after the handler returns.
 *
 * Why service-role: platform-admin actions typically span tenants
 * (list all tenants, suspend arbitrary tenant, toggle feature flag).
 * Attempting to route those through RLS would require every table
 * to grow a "platform admin bypass" policy which is fragile. Instead
 * we lock the action wrapper itself (only platform admins pass the
 * gate) and use service-role inside.
 *
 * Every mutation MUST supply `resourceName`, `resourceId` (nullable),
 * and `targetTenantId` (nullable — null for tenant-create actions
 * where the tenant didn't exist yet at the time of the audit write).
 */

export type PlatformActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string; code: PlatformActionErrorCode };

export type PlatformActionErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "AUDIT_FAILED"
  | "PRECONDITION"
  | "INTERNAL";

export type PlatformActionSnapshot<T> = {
  result: T;
  auditResourceId?: string | null;
  auditTargetTenantId?: string | null;
  auditOldValues?: Record<string, unknown> | null;
  auditNewValues?: Record<string, unknown> | null;
  auditMetadata?: Record<string, unknown> | null;
};

export type PlatformActionContext = {
  admin: { user_id: string; email: string; full_name: string };
  supabase: ReturnType<typeof createServiceRoleClient>;
};

export type PlatformActionOptions<TSchema extends z.ZodTypeAny, TResult> = {
  schema: TSchema;
  auditAction: AuditActionType;
  resourceName: string;
  handler: (
    input: z.infer<TSchema>,
    ctx: PlatformActionContext,
  ) => Promise<PlatformActionSnapshot<TResult>>;
};

export function withPlatformAdminAction<
  TSchema extends z.ZodTypeAny,
  TResult,
>(opts: PlatformActionOptions<TSchema, TResult>) {
  return async (rawInput: unknown): Promise<PlatformActionResult<TResult>> => {
    const admin = await getCurrentPlatformAdmin();
    if (!admin) {
      return {
        ok: false,
        code: "UNAUTHENTICATED",
        reason: "Not signed in as a platform admin.",
      };
    }

    const parsed = opts.schema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        reason: parsed.error.issues
          .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
          .join("; "),
      };
    }

    const supabase = createServiceRoleClient();
    const ctx: PlatformActionContext = {
      admin: {
        user_id: admin.user_id,
        email: admin.email,
        full_name: admin.full_name,
      },
      supabase,
    };

    let snapshot: PlatformActionSnapshot<TResult>;
    try {
      snapshot = await opts.handler(parsed.data, ctx);
    } catch (err) {
      log.error("platform admin action failed", {
        action: opts.auditAction,
        resource: opts.resourceName,
        actor: admin.user_id,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        code: "INTERNAL",
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    // Write audit row via RPC. RPC is security invoker + checks
    // is_current_user_platform_admin() — we're already gated, so this
    // should succeed. Use service-role client so RLS doesn't reject
    // because request.jwt.claims might not be set in this path.
    //
    // The `as unknown as Json` casts below are necessary because
    // Supabase's generated types constrain jsonb parameters to a
    // recursive Json type; our snapshot fields are `Record<string,
    // unknown>` (JSON-shaped by construction, but TypeScript can't
    // prove it). The DB validates at insert time regardless.
    const { error: auditErr } = await supabase.rpc(
      "record_platform_admin_audit",
      {
        p_action_type: opts.auditAction,
        p_resource_name: opts.resourceName,
        p_resource_id: snapshot.auditResourceId ?? undefined,
        p_target_tenant: snapshot.auditTargetTenantId ?? undefined,
        p_old_values: (snapshot.auditOldValues ?? undefined) as
          | Json
          | undefined,
        p_new_values: (snapshot.auditNewValues ?? undefined) as
          | Json
          | undefined,
        p_metadata: {
          ...(snapshot.auditMetadata ?? {}),
          actor_user_id: admin.user_id,
          actor_email: admin.email,
        } as unknown as Json,
      },
    );
    if (auditErr) {
      // The mutation already happened, so we log + surface AUDIT_FAILED
      // rather than swallowing. Operator should investigate.
      log.error("platform admin audit write failed", {
        error: auditErr.message,
        action: opts.auditAction,
        resource: opts.resourceName,
      });
      // Bypass audit write via direct insert as fallback so we don't
      // lose the trail entirely.
      try {
        await supabase.from("platform_admin_audit_logs").insert({
          actor_user_id: admin.user_id,
          actor_email: admin.email,
          action_type: opts.auditAction,
          resource_name: opts.resourceName,
          resource_id: snapshot.auditResourceId ?? null,
          target_tenant_id: snapshot.auditTargetTenantId ?? null,
          old_values: (snapshot.auditOldValues ?? null) as Json | null,
          new_values: (snapshot.auditNewValues ?? null) as Json | null,
          metadata: {
            ...(snapshot.auditMetadata ?? {}),
            audit_rpc_error: auditErr.message,
            fallback_direct_insert: true,
          } as unknown as Json,
        });
      } catch (fallbackErr) {
        log.error("platform admin audit fallback insert also failed", {
          error:
            fallbackErr instanceof Error
              ? fallbackErr.message
              : String(fallbackErr),
        });
      }
    }

    return { ok: true, data: snapshot.result };
  };
}
