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
import { getCurrentPlatformAdmin } from "@/lib/auth/platform-admin-session";
import { createServiceRoleClient } from "@/lib/supabase/server";

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

// ---------------------------------------------------------------------------
// Promote an existing auth.users row to platform admin (Fase 5).
// The account must already exist — typically a real ops person who
// was invited to another tenant, or a dedicated ops auth user created
// via `createPlatformAdminAction`. This is the safer of the two paths
// because it never creates new credentials.
// ---------------------------------------------------------------------------
const promoteAdminSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .regex(EMAIL_PATTERN, { message: "Format email tidak valid." }),
    full_name: z.string().trim().min(2).max(200),
  })
  .strict();

export const promotePlatformAdminAction = withPlatformAdminAction({
  schema: promoteAdminSchema,
  auditAction: "CREATE",
  resourceName: "platform_admins",
  handler: async (input, ctx) => {
    // Look up the auth user by email. auth.admin.listUsers is
    // paginated; we page through until we find it or exhaust. This
    // scales to ~thousands of users. For 10k+ we'd need a `getUserByEmail`
    // endpoint (not present in Supabase JS as of v2.x).
    let target: { id: string; email?: string; created_at: string } | null =
      null;
    let page = 1;
    for (;;) {
      const listRes = await ctx.supabase.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (listRes.error) throw new Error(listRes.error.message);
      const hit = listRes.data.users.find(
        (u) => u.email?.toLowerCase() === input.email,
      );
      if (hit) {
        target = { id: hit.id, email: hit.email, created_at: hit.created_at };
        break;
      }
      if (listRes.data.users.length < 1000) break;
      page += 1;
      if (page > 20) break; // Safety cap — 20k users searched.
    }
    if (!target) {
      throw new Error(
        `Tidak ada auth.users dengan email ${input.email}. ` +
          `Buat user dulu (bisa via "Buat admin baru" atau via provisioning tenant).`,
      );
    }

    const existing = await ctx.supabase
      .from("platform_admins")
      .select("user_id, is_active")
      .eq("user_id", target.id)
      .maybeSingle();

    if (existing.data) {
      if (existing.data.is_active) {
        throw new Error(
          `${input.email} sudah menjadi platform admin aktif.`,
        );
      }
      // Row exists but inactive — re-activate + refresh full_name.
      const upd = await ctx.supabase
        .from("platform_admins")
        .update({
          is_active: true,
          full_name: input.full_name,
          created_by: ctx.admin.user_id,
        })
        .eq("user_id", target.id);
      if (upd.error) throw new Error(upd.error.message);

      revalidatePath("/super-admin/admins");
      return {
        result: {
          user_id: target.id,
          email: input.email,
          reactivated: true,
        },
        auditResourceId: target.id,
        auditOldValues: { is_active: false },
        auditNewValues: { is_active: true, full_name: input.full_name },
        auditMetadata: {
          email: input.email,
          promotion_source: "reactivate_existing_row",
        },
      };
    }

    const ins = await ctx.supabase.from("platform_admins").insert({
      user_id: target.id,
      email: input.email,
      full_name: input.full_name,
      is_active: true,
      created_by: ctx.admin.user_id,
    });
    if (ins.error) throw new Error(ins.error.message);

    revalidatePath("/super-admin/admins");
    return {
      result: {
        user_id: target.id,
        email: input.email,
        reactivated: false,
      },
      auditResourceId: target.id,
      auditNewValues: {
        email: input.email,
        full_name: input.full_name,
        is_active: true,
      },
      auditMetadata: {
        email: input.email,
        promotion_source: "existing_auth_user",
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Create a brand-new auth user + platform_admins row in one go (Fase 5).
// For fresh hires who don't have an account yet. Password auto-generated
// and returned to the caller for one-time display (never persisted).
// ---------------------------------------------------------------------------
const createAdminSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .regex(EMAIL_PATTERN, { message: "Format email tidak valid." }),
    full_name: z.string().trim().min(2).max(200),
    password: z.string().min(12).optional(),
  })
  .strict();

export const createPlatformAdminAction = withPlatformAdminAction({
  schema: createAdminSchema,
  auditAction: "CREATE",
  resourceName: "platform_admins",
  handler: async (input, ctx) => {
    const password = input.password ?? generateSecurePassword();

    // Preflight — email must not already exist in auth.users. This
    // avoids collisions and forces the operator to use "Promote
    // existing" when appropriate.
    let existingUserId: string | null = null;
    let page = 1;
    for (;;) {
      const listRes = await ctx.supabase.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (listRes.error) throw new Error(listRes.error.message);
      const hit = listRes.data.users.find(
        (u) => u.email?.toLowerCase() === input.email,
      );
      if (hit) {
        existingUserId = hit.id;
        break;
      }
      if (listRes.data.users.length < 1000) break;
      page += 1;
      if (page > 20) break;
    }
    if (existingUserId) {
      throw new Error(
        `Email ${input.email} sudah terdaftar di auth.users (user_id ${existingUserId}). ` +
          `Gunakan "Promote existing user" untuk menjadikannya platform admin.`,
      );
    }

    const authRes = await ctx.supabase.auth.admin.createUser({
      email: input.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: input.full_name },
      app_metadata: {
        role: "platform_admin",
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
    const newUserId = authRes.data.user.id;

    const ins = await ctx.supabase.from("platform_admins").insert({
      user_id: newUserId,
      email: input.email,
      full_name: input.full_name,
      is_active: true,
      created_by: ctx.admin.user_id,
    });
    if (ins.error) {
      // Rollback the auth user so retry is clean. If rollback fails,
      // we log — orphan auth.users row can be cleaned up manually.
      const del = await ctx.supabase.auth.admin.deleteUser(newUserId);
      if (del.error) {
        log.error("createPlatformAdminAction: rollback of auth user failed", {
          user_id: newUserId,
          error: del.error.message,
        });
      }
      throw new Error(ins.error.message);
    }

    revalidatePath("/super-admin/admins");
    return {
      result: {
        user_id: newUserId,
        email: input.email,
        temporary_password: password,
        password_auto_generated: input.password === undefined,
      },
      auditResourceId: newUserId,
      auditNewValues: {
        email: input.email,
        full_name: input.full_name,
        is_active: true,
      },
      auditMetadata: {
        email: input.email,
        promotion_source: "new_auth_user",
        password_auto_generated: input.password === undefined,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Deactivate a platform admin (soft — is_active=false). Auth user is
// KEPT — they may still be a tenant user via `employees`. Self-demote
// is blocked to prevent an operator from locking themselves out. To
// hard-remove, run SQL against `platform_admins` directly.
// ---------------------------------------------------------------------------
const setAdminActiveSchema = z
  .object({
    user_id: z.string().uuid(),
    is_active: z.boolean(),
  })
  .strict();

export async function setPlatformAdminActiveAction(rawInput: unknown) {
  // We handle the self-demote guard OUTSIDE of `withPlatformAdminAction`
  // because it needs the current admin identity to compare against the
  // target. `withPlatformAdminAction` also loads the identity, so we
  // could refactor to pass it in — but a preliminary check here keeps
  // the error message crisp.
  const admin = await getCurrentPlatformAdmin();
  if (!admin) {
    return {
      ok: false as const,
      code: "UNAUTHENTICATED" as const,
      reason: "Not signed in as a platform admin.",
    };
  }
  const parsed = setAdminActiveSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: "VALIDATION" as const,
      reason: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  if (parsed.data.user_id === admin.user_id && parsed.data.is_active === false) {
    return {
      ok: false as const,
      code: "PRECONDITION" as const,
      reason:
        "Tidak bisa non-aktifkan diri sendiri. Minta platform admin lain untuk melakukan aksi ini.",
    };
  }

  return withPlatformAdminAction({
    schema: setAdminActiveSchema,
    auditAction: "UPDATE",
    resourceName: "platform_admins",
    handler: async (input, ctx) => {
      const before = await ctx.supabase
        .from("platform_admins")
        .select("user_id, email, is_active, full_name")
        .eq("user_id", input.user_id)
        .maybeSingle();
      if (!before.data) {
        throw new Error("Platform admin row not found.");
      }
      if (before.data.is_active === input.is_active) {
        return {
          result: {
            user_id: input.user_id,
            is_active: input.is_active,
            unchanged: true,
          },
          auditResourceId: input.user_id,
          auditOldValues: { is_active: before.data.is_active },
          auditNewValues: { is_active: input.is_active },
          auditMetadata: { unchanged: true },
        };
      }
      const upd = await ctx.supabase
        .from("platform_admins")
        .update({ is_active: input.is_active })
        .eq("user_id", input.user_id);
      if (upd.error) throw new Error(upd.error.message);

      revalidatePath("/super-admin/admins");
      return {
        result: {
          user_id: input.user_id,
          is_active: input.is_active,
          unchanged: false,
        },
        auditResourceId: input.user_id,
        auditOldValues: { is_active: before.data.is_active },
        auditNewValues: { is_active: input.is_active },
        auditMetadata: {
          email: before.data.email,
          full_name: before.data.full_name,
        },
      };
    },
  })(parsed.data);
}

// Small helper to expose the current admin's user_id to client
// components (used by the admin list to disable the self-row's
// deactivate button). Returning a plain server action is simpler than
// threading it through the RSC page as a prop.
export async function getCurrentPlatformAdminIdAction() {
  const supabase = createServiceRoleClient();
  void supabase; // ensure we're on server
  const admin = await getCurrentPlatformAdmin();
  return admin?.user_id ?? null;
}

// ---------------------------------------------------------------------------
// SaaS commercial control plane (migration 0104, business phases 1–5).
// Billing is deliberately ledger-only: no payment provider side effects.
// ---------------------------------------------------------------------------
const nullableDate = z.union([z.iso.date(), z.literal(""), z.null()]).optional();
const nullableDateTime = z
  .union([z.iso.datetime({ offset: true }), z.literal(""), z.null()])
  .optional();
const optionalEmail = z.union([z.email(), z.literal(""), z.null()]).optional();

const updateCommercialControlSchema = z.object({
  tenant_id: z.string().uuid(),
  profile: z.object({
    stage: z.enum(["lead", "qualified", "trial", "pilot", "customer", "churned"]),
    industry_segment: z.string().max(120).optional(),
    acquisition_source: z.string().max(120).optional(),
    sales_owner: z.string().max(160).optional(),
    customer_success_owner: z.string().max(160).optional(),
    economic_buyer_name: z.string().max(160).optional(),
    economic_buyer_email: optionalEmail,
    champion_name: z.string().max(160).optional(),
    champion_email: optionalEmail,
    engineer_count: z.number().int().min(0).nullable().optional(),
    estimated_active_projects: z.number().int().min(0).nullable().optional(),
    notes: z.string().max(4000).optional(),
  }),
  onboarding: z.object({
    status: z.enum(["new", "configuring", "activated", "stalled"]),
    pilot_start_date: nullableDate,
    pilot_end_date: nullableDate,
    decision_date: nullableDate,
    blocker: z.string().max(2000).optional(),
    technical_activated_at: nullableDateTime,
    business_activated_at: nullableDateTime,
    success_criteria: z.array(z.string().min(1).max(500)).max(20),
    checklist: z.record(z.string(), z.boolean()),
  }),
  subscription: z.object({
    plan_code: z.enum(["trial", "field_control", "project_margin", "service_governance", "custom"]),
    status: z.enum(["trialing", "active", "past_due", "canceled", "expired"]),
    billing_interval: z.enum(["monthly", "quarterly", "annual", "one_time"]),
    recurring_price_idr: z.number().int().min(0),
    implementation_fee_idr: z.number().int().min(0),
    contract_start_date: nullableDate,
    contract_end_date: nullableDate,
    renewal_date: nullableDate,
    payment_terms_days: z.number().int().min(0).max(365),
    grace_ends_at: nullableDateTime,
    read_only_at: nullableDateTime,
    suspend_at: nullableDateTime,
    cancellation_reason: z.string().max(2000).optional(),
    auto_renew: z.boolean(),
  }),
  session_policy: z.object({
    idle_timeout_minutes: z.number().int().min(5).max(1440),
    idle_warning_minutes: z.number().int().min(1).max(60),
    absolute_session_minutes: z.number().int().min(30).max(10080),
  }).refine((v) => v.idle_warning_minutes < v.idle_timeout_minutes, {
    message: "Warning harus lebih kecil dari idle timeout.",
  }).refine((v) => v.absolute_session_minutes >= v.idle_timeout_minutes, {
    message: "Absolute lifetime harus >= idle timeout.",
  }),
}).strict();

function emptyToNull<T>(value: T | "" | undefined): T | null {
  return value === "" || value === undefined ? null : value;
}

export const updateCommercialControlAction = withPlatformAdminAction({
  schema: updateCommercialControlSchema,
  auditAction: "UPDATE",
  resourceName: "tenant_commercial_control",
  handler: async (input, ctx) => {
    // New tables intentionally use a migration-forward client until generated
    // Supabase types are refreshed against an environment with migration 0104.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = ctx.supabase as any;
    const before = await db
      .from("tenant_subscriptions")
      .select("id, plan_code, status, recurring_price_idr, read_only_at")
      .eq("tenant_id", input.tenant_id)
      .in("status", ["trialing", "active", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const profile = {
      tenant_id: input.tenant_id,
      ...input.profile,
      economic_buyer_email: emptyToNull(input.profile.economic_buyer_email),
      champion_email: emptyToNull(input.profile.champion_email),
      updated_at: new Date().toISOString(),
    };
    const onboarding = {
      tenant_id: input.tenant_id,
      ...input.onboarding,
      pilot_start_date: emptyToNull(input.onboarding.pilot_start_date),
      pilot_end_date: emptyToNull(input.onboarding.pilot_end_date),
      decision_date: emptyToNull(input.onboarding.decision_date),
      technical_activated_at: emptyToNull(input.onboarding.technical_activated_at),
      business_activated_at: emptyToNull(input.onboarding.business_activated_at),
      last_reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const subscription = {
      tenant_id: input.tenant_id,
      ...input.subscription,
      contract_start_date: emptyToNull(input.subscription.contract_start_date),
      contract_end_date: emptyToNull(input.subscription.contract_end_date),
      renewal_date: emptyToNull(input.subscription.renewal_date),
      grace_ends_at: emptyToNull(input.subscription.grace_ends_at),
      read_only_at: emptyToNull(input.subscription.read_only_at),
      suspend_at: emptyToNull(input.subscription.suspend_at),
      cancellation_reason: emptyToNull(input.subscription.cancellation_reason),
      canceled_at:
        input.subscription.status === "canceled" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    const profileResult = await db
      .from("tenant_commercial_profiles")
      .upsert(profile, { onConflict: "tenant_id" });
    if (profileResult.error) throw new Error(profileResult.error.message);
    const onboardingResult = await db
      .from("tenant_onboarding")
      .upsert(onboarding, { onConflict: "tenant_id" });
    if (onboardingResult.error) throw new Error(onboardingResult.error.message);
    const policyResult = await db.from("tenants").update(input.session_policy).eq("id", input.tenant_id);
    if (policyResult.error) throw new Error(policyResult.error.message);

    let subscriptionId = before.data?.id as string | undefined;
    if (subscriptionId) {
      const updated = await db
        .from("tenant_subscriptions")
        .update(subscription)
        .eq("id", subscriptionId);
      if (updated.error) throw new Error(updated.error.message);
    } else {
      const inserted = await db
        .from("tenant_subscriptions")
        .insert(subscription)
        .select("id")
        .single();
      if (inserted.error) throw new Error(inserted.error.message);
      subscriptionId = inserted.data.id;
    }

    // Explainable health snapshot: recalculated on every business review.
    // This intentionally uses deterministic rules, not AI.
    const usageResult = await db
      .from("tenant_current_usage")
      .select("active_users,cash_advances_total")
      .eq("tenant_id", input.tenant_id)
      .maybeSingle();
    if (usageResult.error) throw new Error(usageResult.error.message);
    const reasons: string[] = [];
    let score = 100;
    if (Number(usageResult.data?.active_users ?? 0) < 5) {
      score -= 25;
      reasons.push("Kurang dari 5 pengguna aktif");
    }
    if (Number(usageResult.data?.cash_advances_total ?? 0) === 0) {
      score -= 20;
      reasons.push("Belum ada cash advance diproses");
    }
    if (input.onboarding.status === "stalled") {
      score -= 30;
      reasons.push("Onboarding stalled");
    }
    if (input.onboarding.status !== "activated") {
      score -= 10;
      reasons.push("Business activation belum selesai");
    }
    if (input.subscription.status === "past_due") {
      score -= 25;
      reasons.push("Subscription past due");
    }
    score = Math.max(0, score);
    const healthResult = await db.from("tenant_health_snapshots").insert({
      tenant_id: input.tenant_id,
      status: score >= 75 ? "healthy" : score >= 45 ? "attention" : "at_risk",
      score,
      reasons: reasons.length ? reasons : ["Seluruh rule dasar terpenuhi"],
      activity_14d: 0,
      calculated_by: `platform-review:${ctx.admin.email}`,
    });
    if (healthResult.error) throw new Error(healthResult.error.message);

    revalidatePath("/super-admin/tenants");
    revalidatePath(`/super-admin/tenants/${input.tenant_id}`);
    return {
      result: { tenant_id: input.tenant_id, subscription_id: subscriptionId },
      auditResourceId: input.tenant_id,
      auditTargetTenantId: input.tenant_id,
      auditOldValues: before.data ?? null,
      auditNewValues: {
        stage: input.profile.stage,
        onboarding_status: input.onboarding.status,
        subscription_status: input.subscription.status,
        plan_code: input.subscription.plan_code,
        read_only_at: subscription.read_only_at,
        suspend_at: subscription.suspend_at,
        session_policy: input.session_policy,
      },
    };
  },
});

const entitlementOverrideSchema = z.object({
  tenant_id: z.string().uuid(),
  capability_key: z.string().trim().min(2).max(100),
  enabled: z.boolean().nullable(),
  limit_value: z.number().int().min(0).nullable(),
  reason: z.string().trim().min(3).max(500),
  expires_at: nullableDateTime,
}).strict();

export const upsertEntitlementOverrideAction = withPlatformAdminAction({
  schema: entitlementOverrideSchema,
  auditAction: "UPDATE",
  resourceName: "tenant_entitlement_overrides",
  handler: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = ctx.supabase as any;
    const row = {
      ...input,
      expires_at: emptyToNull(input.expires_at),
      updated_by: ctx.admin.user_id,
      updated_at: new Date().toISOString(),
    };
    const result = await db.from("tenant_entitlement_overrides").upsert(row, {
      onConflict: "tenant_id,capability_key",
    });
    if (result.error) throw new Error(result.error.message);
    revalidatePath(`/super-admin/tenants/${input.tenant_id}`);
    return {
      result: { tenant_id: input.tenant_id, capability_key: input.capability_key },
      auditResourceId: `${input.tenant_id}:${input.capability_key}`,
      auditTargetTenantId: input.tenant_id,
      auditNewValues: row,
    };
  },
});

const invoiceSchema = z.object({
  tenant_id: z.string().uuid(),
  subscription_id: z.string().uuid().nullable().optional(),
  invoice_number: z.string().trim().min(2).max(80),
  status: z.enum(["draft", "issued", "paid", "overdue", "void"]),
  amount_idr: z.number().int().min(0),
  issued_at: nullableDate,
  due_at: nullableDate,
  payment_reference: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
}).strict();

export const createManualInvoiceAction = withPlatformAdminAction({
  schema: invoiceSchema,
  auditAction: "CREATE",
  resourceName: "tenant_invoices",
  handler: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = ctx.supabase as any;
    const row = {
      ...input,
      subscription_id: input.subscription_id ?? null,
      issued_at: emptyToNull(input.issued_at),
      due_at: emptyToNull(input.due_at),
      paid_at: input.status === "paid" ? new Date().toISOString() : null,
      payment_reference: emptyToNull(input.payment_reference),
      notes: emptyToNull(input.notes),
    };
    const inserted = await db.from("tenant_invoices").insert(row).select("id").single();
    if (inserted.error) throw new Error(inserted.error.message);
    revalidatePath(`/super-admin/tenants/${input.tenant_id}`);
    return {
      result: { id: inserted.data.id },
      auditResourceId: inserted.data.id,
      auditTargetTenantId: input.tenant_id,
      auditNewValues: { invoice_number: input.invoice_number, status: input.status, amount_idr: input.amount_idr },
    };
  },
});

const updateInvoiceStatusSchema = z.object({
  tenant_id: z.string().uuid(),
  invoice_id: z.string().uuid(),
  status: z.enum(["draft", "issued", "paid", "overdue", "void"]),
}).strict();

export const updateManualInvoiceStatusAction = withPlatformAdminAction({
  schema: updateInvoiceStatusSchema,
  auditAction: "UPDATE",
  resourceName: "tenant_invoices",
  handler: async (input, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = ctx.supabase as any;
    const before = await db.from("tenant_invoices").select("id,status,invoice_number").eq("id", input.invoice_id).eq("tenant_id", input.tenant_id).maybeSingle();
    if (!before.data) throw new Error("Invoice tidak ditemukan untuk tenant ini.");
    const updated = await db.from("tenant_invoices").update({
      status: input.status,
      paid_at: input.status === "paid" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("id", input.invoice_id).eq("tenant_id", input.tenant_id);
    if (updated.error) throw new Error(updated.error.message);
    revalidatePath(`/super-admin/tenants/${input.tenant_id}`);
    return {
      result: { id: input.invoice_id, status: input.status },
      auditResourceId: input.invoice_id,
      auditTargetTenantId: input.tenant_id,
      auditOldValues: { status: before.data.status },
      auditNewValues: { status: input.status },
      auditMetadata: { invoice_number: before.data.invoice_number },
    };
  },
});

// ---------------------------------------------------------------------------
// Bulk feature-flag toggle (Fase 6.2). Applies one feature flag to a
// selection of tenants in a single audit event. Selection modes:
//
//   - "all": every tenant (regardless of current status).
//   - "active": every tenant where status='active'. Recommended default.
//   - "tenant_ids": explicit list of tenant UUIDs (bulk-select UI).
//
// This is intentionally not exposed as a percentage rollout — that's
// a distinct product decision (canary → progressive rollout ordering)
// and would need per-tenant seed selection. The `tenant_ids` mode is
// the escape hatch: the operator picks who gets the flag first (e.g.
// friendly tenants for canary).
//
// Audit: writes ONE row per affected tenant so the log stays queryable
// per-tenant. The metadata field carries a `bulk_run_id` so operators
// can reconcile all rows of a single bulk operation.
// ---------------------------------------------------------------------------
const bulkToggleFeatureFlagSchema = z
  .object({
    feature_key: z.string().refine(isKnownFeatureKey, {
      message: `feature_key harus salah satu dari: ${FEATURE_KEYS.join(", ")}`,
    }),
    enabled: z.boolean(),
    mode: z.enum(["all", "active", "tenant_ids"]),
    tenant_ids: z.array(z.string().uuid()).max(1000).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(
    (v) => v.mode !== "tenant_ids" || (v.tenant_ids && v.tenant_ids.length > 0),
    { message: "tenant_ids wajib diisi bila mode='tenant_ids'." },
  );

export async function bulkToggleFeatureFlagAction(rawInput: unknown) {
  const admin = await getCurrentPlatformAdmin();
  if (!admin) {
    return {
      ok: false as const,
      code: "UNAUTHENTICATED" as const,
      reason: "Not signed in as a platform admin.",
    };
  }
  const parsed = bulkToggleFeatureFlagSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false as const,
      code: "VALIDATION" as const,
      reason: parsed.error.issues.map((i) => i.message).join("; "),
    };
  }
  const input = parsed.data;
  const supa = createServiceRoleClient();

  // Resolve the target tenant list.
  let targetIds: string[] = [];
  if (input.mode === "tenant_ids") {
    targetIds = input.tenant_ids ?? [];
  } else {
    const q = supa.from("tenants").select("id");
    const q2 = input.mode === "active" ? q.eq("status", "active") : q;
    const list = await q2;
    if (list.error) {
      return {
        ok: false as const,
        code: "INTERNAL" as const,
        reason: list.error.message,
      };
    }
    targetIds = (list.data ?? []).map((r) => r.id);
  }
  if (targetIds.length === 0) {
    return {
      ok: false as const,
      code: "NO_TARGETS" as const,
      reason: "Tidak ada tenant yang cocok dengan mode dipilih.",
    };
  }

  // Load existing rows in one shot so we can produce accurate old→new
  // audit values. Missing rows imply the DEFAULT (see FEATURE_REGISTRY);
  // we still record old=null so the audit doesn't lie about "was the
  // effective value X or the default?".
  const existingRes = await supa
    .from("tenant_feature_flags")
    .select("tenant_id, enabled")
    .eq("feature_key", input.feature_key)
    .in("tenant_id", targetIds);
  if (existingRes.error) {
    return {
      ok: false as const,
      code: "INTERNAL" as const,
      reason: existingRes.error.message,
    };
  }
  const existingMap = new Map(
    (existingRes.data ?? []).map((r) => [r.tenant_id, r.enabled]),
  );

  // Upsert all rows in one transaction.
  const now = new Date().toISOString();
  const upserts = targetIds.map((tid) => ({
    tenant_id: tid,
    feature_key: input.feature_key,
    enabled: input.enabled,
    notes: input.notes ?? null,
    updated_by: admin.user_id,
    updated_at: now,
  }));
  const upsertRes = await supa
    .from("tenant_feature_flags")
    .upsert(upserts, { onConflict: "tenant_id,feature_key" });
  if (upsertRes.error) {
    return {
      ok: false as const,
      code: "INTERNAL" as const,
      reason: upsertRes.error.message,
    };
  }

  // Audit one row per tenant. Best-effort — a failure here does NOT
  // roll back the toggle because doing so would half-flip a canary.
  // Log loudly instead.
  const bulkRunId = crypto.randomUUID();
  let auditedCount = 0;
  for (const tid of targetIds) {
    const before = existingMap.has(tid) ? existingMap.get(tid) : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auditRes = await (supa as any).rpc("record_platform_admin_audit", {
      p_action_type: "UPDATE",
      p_resource_name: "tenant_feature_flags",
      p_resource_id: `${tid}:${input.feature_key}`,
      p_target_tenant: tid,
      p_old_values: { enabled: before },
      p_new_values: { enabled: input.enabled },
      p_metadata: {
        bulk_run_id: bulkRunId,
        feature_key: input.feature_key,
        mode: input.mode,
        total_targets: targetIds.length,
        notes: input.notes ?? null,
      },
    });
    if (!auditRes.error) auditedCount += 1;
  }
  if (auditedCount < targetIds.length) {
    log.warn("bulkToggleFeatureFlag: partial audit failure", {
      bulk_run_id: bulkRunId,
      total: targetIds.length,
      audited: auditedCount,
    });
  }

  revalidatePath("/super-admin/features");
  revalidatePath("/super-admin/tenants");

  return {
    ok: true as const,
    data: {
      feature_key: input.feature_key,
      enabled: input.enabled,
      mode: input.mode,
      affected_tenants: targetIds.length,
      audited_rows: auditedCount,
      bulk_run_id: bulkRunId,
    },
  };
}

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
