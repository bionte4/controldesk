"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { withPlatformAdminAction } from "@/lib/security/platform-admin-action";
import {
  EMAIL_PATTERN,
  RESERVED_SLUGS,
  SLUG_PATTERN,
  generateSecurePassword,
  renderWelcomeEmail,
} from "@/lib/ops/tenant-provisioning";
import { FEATURE_KEYS, isKnownFeatureKey } from "@/lib/ops/feature-flags";
import { log } from "@/lib/observability/log";

/**
 * Server actions for the /super-admin surface (Fase 2 + 3, migration 0077).
 *
 * All actions run through `withPlatformAdminAction()` which:
 *   1. Verifies caller is an active platform admin (via JWT claim).
 *   2. Validates input against a Zod schema.
 *   3. Executes the handler with a service-role client (RLS bypassed
 *      by design — cross-tenant surface).
 *   4. Writes to `platform_admin_audit_logs` after success.
 */

// ---------------------------------------------------------------------------
// Provision a new tenant. Wraps the same `provision_tenant` RPC that the
// `pnpm tenant:create` CLI uses (Fase 1, migration 0076) — single source
// of truth. The UI adds: (a) confirmation via form, (b) auto-rollback,
// (c) rendered welcome email surfaced to the operator via toast/dialog.
// ---------------------------------------------------------------------------
const createTenantSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(SLUG_PATTERN, {
        message: "Slug harus lowercase alfanumerik, 2–63 karakter.",
      })
      .refine((s) => !RESERVED_SLUGS.has(s), {
        message: "Slug ini reserved oleh sistem.",
      }),
    name: z.string().trim().min(2).max(200),
    admin_email: z
      .string()
      .trim()
      .toLowerCase()
      .regex(EMAIL_PATTERN, { message: "Format email tidak valid." }),
    admin_name: z.string().trim().min(2).max(200),
    admin_password: z
      .string()
      .min(12, "Password minimum 12 karakter.")
      .optional(),
  })
  .strict();

export const createTenantAction = withPlatformAdminAction({
  schema: createTenantSchema,
  auditAction: "CREATE",
  resourceName: "tenants",
  handler: async (input, ctx) => {
    const password = input.admin_password ?? generateSecurePassword();

    // Preflight — slug + email uniqueness.
    const existingTenant = await ctx.supabase
      .from("tenants")
      .select("id")
      .eq("slug", input.slug)
      .maybeSingle();
    if (existingTenant.data) {
      throw new Error(`Slug '${input.slug}' sudah dipakai.`);
    }

    const listRes = await ctx.supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listRes.error) throw new Error(listRes.error.message);
    if (
      listRes.data.users.some(
        (u) => u.email?.toLowerCase() === input.admin_email,
      )
    ) {
      throw new Error(
        `Email ${input.admin_email} sudah terdaftar di auth.users.`,
      );
    }

    // 1. Create auth user via Admin API.
    const authRes = await ctx.supabase.auth.admin.createUser({
      email: input.admin_email,
      password,
      email_confirm: true,
      user_metadata: { full_name: input.admin_name },
      app_metadata: {
        provisioned_by: "super-admin-ui",
        provisioned_at: new Date().toISOString(),
        provisioned_by_user_id: ctx.admin.user_id,
      },
    });
    if (authRes.error || !authRes.data.user) {
      throw new Error(
        authRes.error?.message ?? "Auth user creation returned empty result.",
      );
    }
    const adminUserId = authRes.data.user.id;

    // 2. Call provision_tenant RPC (atomic tx).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpcRes = await (ctx.supabase as any).rpc("provision_tenant", {
      p_slug: input.slug,
      p_name: input.name,
      p_admin_user_id: adminUserId,
      p_admin_email: input.admin_email,
      p_admin_name: input.admin_name,
      p_source: "super-admin-ui",
    });

    if (rpcRes.error) {
      // Rollback auth user so re-run doesn't collide.
      const del = await ctx.supabase.auth.admin.deleteUser(adminUserId);
      if (del.error) {
        log.error("createTenantAction: rollback of auth user failed", {
          user_id: adminUserId,
          error: del.error.message,
        });
      }
      throw new Error(`provision_tenant RPC failed: ${rpcRes.error.message}`);
    }

    const row = Array.isArray(rpcRes.data) ? rpcRes.data[0] : rpcRes.data;
    if (!row?.tenant_id || !row?.employee_id) {
      throw new Error("provision_tenant returned empty rowset.");
    }

    const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "controldesk.app";
    const welcomeEmail = renderWelcomeEmail({
      tenantName: input.name,
      tenantSlug: input.slug,
      adminName: input.admin_name,
      adminEmail: input.admin_email,
      adminPassword: password,
      rootDomain,
    });

    revalidatePath("/super-admin/tenants");
    revalidatePath(`/super-admin/tenants/${row.tenant_id}`);

    return {
      result: {
        tenant_id: row.tenant_id as string,
        employee_id: row.employee_id as string,
        admin_user_id: adminUserId,
        temporary_password: password,
        password_auto_generated: input.admin_password === undefined,
        welcome_email_subject: welcomeEmail.subject,
        welcome_email_body: welcomeEmail.body,
      },
      auditResourceId: row.tenant_id as string,
      auditTargetTenantId: row.tenant_id as string,
      auditNewValues: {
        slug: input.slug,
        name: input.name,
        admin_email: input.admin_email,
      },
      auditMetadata: {
        provisioned_by: "super-admin-ui",
        password_auto_generated: input.admin_password === undefined,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Change tenant status. Suspend (usable → frozen) or reactivate (frozen →
// usable). "terminated" is intentionally NOT exposed via UI — that path
// only via docs/ops/tenant-provisioning.md rollback playbook.
// ---------------------------------------------------------------------------
const setTenantStatusSchema = z
  .object({
    tenant_id: z.string().uuid(),
    status: z.enum(["active", "suspended"]),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();

export const setTenantStatusAction = withPlatformAdminAction({
  schema: setTenantStatusSchema,
  auditAction: "UPDATE",
  resourceName: "tenants",
  handler: async (input, ctx) => {
    const before = await ctx.supabase
      .from("tenants")
      .select("id, slug, name, status")
      .eq("id", input.tenant_id)
      .maybeSingle();
    if (!before.data) throw new Error("Tenant tidak ditemukan.");

    if (before.data.status === input.status) {
      return {
        result: { tenant_id: input.tenant_id, status: input.status, unchanged: true },
        auditResourceId: input.tenant_id,
        auditTargetTenantId: input.tenant_id,
        auditOldValues: { status: before.data.status },
        auditNewValues: { status: input.status },
        auditMetadata: { unchanged: true, reason: input.reason ?? null },
      };
    }

    const upd = await ctx.supabase
      .from("tenants")
      .update({ status: input.status })
      .eq("id", input.tenant_id);
    if (upd.error) throw new Error(upd.error.message);

    revalidatePath("/super-admin/tenants");
    revalidatePath(`/super-admin/tenants/${input.tenant_id}`);

    return {
      result: { tenant_id: input.tenant_id, status: input.status, unchanged: false },
      auditResourceId: input.tenant_id,
      auditTargetTenantId: input.tenant_id,
      auditOldValues: { status: before.data.status },
      auditNewValues: { status: input.status },
      auditMetadata: {
        reason: input.reason ?? null,
        tenant_slug: before.data.slug,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Toggle a feature flag for a tenant (Fase 3).
// ---------------------------------------------------------------------------
const toggleFeatureFlagSchema = z
  .object({
    tenant_id: z.string().uuid(),
    feature_key: z.string().refine(isKnownFeatureKey, {
      message: `feature_key harus salah satu dari: ${FEATURE_KEYS.join(", ")}`,
    }),
    enabled: z.boolean(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export const toggleFeatureFlagAction = withPlatformAdminAction({
  schema: toggleFeatureFlagSchema,
  auditAction: "UPDATE",
  resourceName: "tenant_feature_flags",
  handler: async (input, ctx) => {
    const existing = await ctx.supabase
      .from("tenant_feature_flags")
      .select("id, enabled, notes")
      .eq("tenant_id", input.tenant_id)
      .eq("feature_key", input.feature_key)
      .maybeSingle();

    const oldEnabled = existing.data?.enabled ?? null;

    const upsert = await ctx.supabase
      .from("tenant_feature_flags")
      .upsert(
        {
          tenant_id: input.tenant_id,
          feature_key: input.feature_key,
          enabled: input.enabled,
          notes: input.notes ?? null,
          updated_by: ctx.admin.user_id,
        },
        { onConflict: "tenant_id,feature_key" },
      )
      .select("id, feature_key, enabled")
      .single();
    if (upsert.error) throw new Error(upsert.error.message);

    revalidatePath(`/super-admin/tenants/${input.tenant_id}`);

    return {
      result: {
        feature_key: input.feature_key,
        enabled: input.enabled,
        was_previously: oldEnabled,
      },
      auditResourceId: upsert.data.id,
      auditTargetTenantId: input.tenant_id,
      auditOldValues: { enabled: oldEnabled },
      auditNewValues: { enabled: input.enabled },
      auditMetadata: {
        feature_key: input.feature_key,
        notes: input.notes ?? null,
      },
    };
  },
});
