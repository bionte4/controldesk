"use server";

import { revalidatePath } from "next/cache";

import { generateSecurePassword } from "@/lib/ops/tenant-provisioning";
import { toLegacyDbRole } from "@/lib/rbac/roles";
import { withSecureAction } from "@/lib/security/action-wrapper";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  changeUserRoleSchema,
  createUserManuallySchema,
  forceLogoutSchema,
  inviteUserSchema,
  setUserStatusSchema,
} from "@/lib/validation/user-admin";
import { assertTenantCapacity } from "@/lib/ops/entitlements";

/**
 * Server actions for the `/settings/users` admin surface (Fase 2 + 3).
 *
 * All four mutations flow through `withSecureAction` so we get:
 *   - authenticated employee guard
 *   - Zod validation
 *   - PDP check against the `user_admin` resource (TENANT_ADMIN only)
 *   - audit-log row on success
 *
 * The bodies talk to Supabase Auth via the SERVICE ROLE client because
 * `auth.admin.*` methods are privileged. RLS still applies to any writes
 * we do against `public.employees` — the guard is already re-verified
 * inside the RPCs (`can_admin_target_user`) added by migration 0053.
 */

const REVALIDATE_PATH = "/settings/users";

const FAR_FUTURE_BAN = "9999-12-31T23:59:59Z";

// ---------------------------------------------------------------------------
// INVITE — create a new auth user and send a magic-link invite. On accept
// the user chooses their own password. We pre-create the employees row so
// the JWT-hook has `role` + `tenant_id` ready on first sign-in.
// ---------------------------------------------------------------------------
export const inviteUserAction = withSecureAction({
  schema: inviteUserSchema,
  resource: "user_admin",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "auth.users",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const service = createServiceRoleClient();

    await assertTenantCapacity({
      client: service,
      tenantId: ctx.actor.tenantId,
      capability: "active_users",
      table: "employees",
      activeFilter: { column: "is_active", equals: true },
    });

    // 1. Reject if there's already an active employees row for this email in
    //    this tenant — otherwise a rogue admin could shadow an existing user.
    const emailLower = input.email.toLowerCase();
    const { data: dupEmp } = await service
      .from("employees")
      .select("id")
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("email", emailLower)
      .maybeSingle();
    if (dupEmp) {
      throw new Error(
        "An employee with this email already exists in this tenant.",
      );
    }

    // 2. Also check auth.users globally (an email can only own one user
    //    across the whole Supabase project — even across tenants).
    const {
      data: { users: existingUsers },
      error: listErr,
    } = await service.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (listErr) throw new Error(listErr.message);
    const clash = existingUsers?.find(
      (u) => u.email?.toLowerCase() === emailLower,
    );
    if (clash) {
      throw new Error(
        "This email is already registered in Supabase Auth. Ask that user to switch tenants or use a different address.",
      );
    }

    // 3. Send the invite. `inviteUserByEmail` creates the auth.users row
    //    AND emails a magic link in one round-trip. In dev this lands in
    //    Inbucket (http://localhost:54324); in prod it goes via SMTP.
    const { data: invited, error: inviteErr } =
      await service.auth.admin.inviteUserByEmail(emailLower, {
        data: {
          full_name: input.full_name,
          tenant_id: ctx.actor.tenantId,
          role: toLegacyDbRole(input.role),
        },
      });
    if (inviteErr || !invited.user) {
      throw new Error(inviteErr?.message ?? "Failed to send invite.");
    }

    // 4. Insert the employees row using the fresh user_id. If this fails we
    //    roll back by deleting the auth user we just created — otherwise
    //    the workspace ends up with an unclaimable ghost.
    const legacyRole = toLegacyDbRole(input.role);
    const { data: newEmployee, error: empErr } = await service
      .from("employees")
      .insert({
        tenant_id: ctx.actor.tenantId,
        user_id: invited.user.id,
        role: legacyRole,
        full_name: input.full_name,
        email: emailLower,
        is_active: true,
      })
      .select("id")
      .single();
    if (empErr || !newEmployee) {
      await service.auth.admin.deleteUser(invited.user.id).catch(() => {});
      throw new Error(empErr?.message ?? "Failed to create employee record.");
    }

    revalidatePath(REVALIDATE_PATH);

    return {
      result: {
        user_id: invited.user.id,
        employee_id: newEmployee.id,
        email: emailLower,
      },
      auditResourceId: invited.user.id,
      auditNewValues: {
        email: emailLower,
        full_name: input.full_name,
        role: legacyRole,
      },
      auditMetadata: { flow: "invite" },
    };
  },
});

/**
 * Find an auth.users row by email, paging through the Admin API. Supabase JS
 * has no getUserByEmail, so we page (1000/page, capped at 20 pages) — the
 * same pattern the platform-admin actions use.
 */
async function findAuthUserByEmail(
  service: ReturnType<typeof createServiceRoleClient>,
  emailLower: string,
): Promise<{ id: string } | null> {
  let page = 1;
  for (;;) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw new Error(error.message);
    const hit = data.users.find(
      (u) => u.email?.toLowerCase() === emailLower,
    );
    if (hit) return { id: hit.id };
    if (data.users.length < 1000) return null;
    page += 1;
    if (page > 20) return null;
  }
}

// ---------------------------------------------------------------------------
// MANUAL CREATE — alternative to invite. The tenant admin creates the auth
// account directly (email pre-confirmed, NO email sent) with a temporary
// password: auto-generated when the admin does not supply one. The plaintext
// password is returned to the admin exactly once for out-of-band handover and
// is NEVER written to the audit log, the employees row, or any log line.
// ---------------------------------------------------------------------------
export const createUserManuallyAction = withSecureAction({
  schema: createUserManuallySchema,
  resource: "user_admin",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "auth.users",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const service = createServiceRoleClient();
    const emailLower = input.email.toLowerCase();

    // 1. Same duplicate guards as invite: no shadowing an employee already
    //    in this tenant, and no reusing an email owned by another tenant's
    //    auth account (Supabase emails are globally unique).
    const { data: dupEmp } = await service
      .from("employees")
      .select("id")
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("email", emailLower)
      .maybeSingle();
    if (dupEmp) {
      throw new Error(
        "An employee with this email already exists in this tenant.",
      );
    }

    const clash = await findAuthUserByEmail(service, emailLower);
    if (clash) {
      throw new Error(
        "This email is already registered in Supabase Auth. Ask that user to switch tenants or use a different address.",
      );
    }

    // 2. Create the auth user with a pre-confirmed email so the account can
    //    sign in immediately — no invitation email is sent.
    const passwordAutoGenerated = input.password === undefined;
    const password = input.password ?? generateSecurePassword();
    const { data: created, error: createErr } =
      await service.auth.admin.createUser({
        email: emailLower,
        password,
        email_confirm: true,
        user_metadata: { full_name: input.full_name },
        app_metadata: {
          provisioned_by: "tenant-admin-manual",
          tenant_id: ctx.actor.tenantId,
          provisioned_at: new Date().toISOString(),
        },
      });
    if (createErr || !created.user) {
      throw new Error(createErr?.message ?? "Failed to create auth user.");
    }

    // 3. Pre-create the employees row so the JWT hook has role + tenant_id
    //    ready on first sign-in. Roll back the auth user on failure so a
    //    retry does not collide with a ghost account.
    const legacyRole = toLegacyDbRole(input.role);
    const { data: newEmployee, error: empErr } = await service
      .from("employees")
      .insert({
        tenant_id: ctx.actor.tenantId,
        user_id: created.user.id,
        role: legacyRole,
        full_name: input.full_name,
        email: emailLower,
        is_active: true,
      })
      .select("id")
      .single();
    if (empErr || !newEmployee) {
      await service.auth.admin.deleteUser(created.user.id).catch(() => {});
      throw new Error(empErr?.message ?? "Failed to create employee record.");
    }

    revalidatePath(REVALIDATE_PATH);

    return {
      result: {
        user_id: created.user.id,
        employee_id: newEmployee.id,
        email: emailLower,
        full_name: input.full_name,
        role: legacyRole,
        // One-time handover credential. Deliberately excluded from every
        // audit field below.
        temporary_password: password,
        password_auto_generated: passwordAutoGenerated,
      },
      auditResourceId: created.user.id,
      auditNewValues: {
        email: emailLower,
        full_name: input.full_name,
        role: legacyRole,
      },
      auditMetadata: {
        flow: "manual_create",
        password_auto_generated: passwordAutoGenerated,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// CHANGE ROLE — mutate employees.role for the target user. Force logout on
// success so the JWT claim gets refreshed on next sign-in.
// ---------------------------------------------------------------------------
export const changeUserRoleAction = withSecureAction({
  schema: changeUserRoleSchema,
  resource: "user_admin",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "employees",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    // Guardrail 1: cannot change your own role — protects against lone-admin
    // self-demotion lock-out.
    if (input.user_id === ctx.actor.userId) {
      throw new Error("You cannot change your own role.");
    }

    const service = createServiceRoleClient();

    const { data: target, error: findErr } = await service
      .from("employees")
      .select("id, role, full_name, email, tenant_id")
      .eq("user_id", input.user_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!target) throw new Error("User not found in your tenant.");

    const newLegacyRole = toLegacyDbRole(input.new_role);
    if (target.role === newLegacyRole) {
      throw new Error("The target already has that role.");
    }

    // Guardrail 2: demoting the LAST admin is refused. We count the other
    // active TENANT_ADMIN rows in the tenant — if none remain, block.
    const isDemotingAdmin =
      target.role === "TENANT_ADMIN" && newLegacyRole !== "TENANT_ADMIN";
    if (isDemotingAdmin) {
      const { count } = await service
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", ctx.actor.tenantId)
        .eq("role", "TENANT_ADMIN")
        .eq("is_active", true)
        .neq("user_id", input.user_id);
      if (!count || count < 1) {
        throw new Error(
          "Cannot demote the last active TENANT_ADMIN — promote another admin first.",
        );
      }
    }

    const { error: updErr } = await service
      .from("employees")
      .update({ role: newLegacyRole })
      .eq("id", target.id);
    if (updErr) throw new Error(updErr.message);

    // Session invalidation — best effort. If the RPC fails we still return
    // success (the audit log captured the mutation) but surface a warning.
    let sessionsRevoked = 0;
    const { data: revokeData, error: revokeErr } = await service.rpc(
      "revoke_user_sessions",
      { p_user_id: input.user_id },
    );
    if (!revokeErr && typeof revokeData === "number") {
      sessionsRevoked = revokeData;
    }

    revalidatePath(REVALIDATE_PATH);

    return {
      result: {
        user_id: input.user_id,
        employee_id: target.id,
        sessions_revoked: sessionsRevoked,
      },
      auditResourceId: target.id,
      auditOldValues: { role: target.role },
      auditNewValues: { role: newLegacyRole },
      auditMetadata: {
        target_email: target.email,
        reason: input.reason ?? null,
        sessions_revoked: sessionsRevoked,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// SET STATUS — deactivate or reactivate. Deactivate = employees.is_active=false
// AND auth.users.banned_until=far-future; reactivate reverses both.
// ---------------------------------------------------------------------------
export const setUserStatusAction = withSecureAction({
  schema: setUserStatusSchema,
  resource: "user_admin",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "employees",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    if (input.user_id === ctx.actor.userId) {
      throw new Error("You cannot deactivate your own account.");
    }

    const service = createServiceRoleClient();
    const { data: target, error: findErr } = await service
      .from("employees")
      .select("id, is_active, role, email")
      .eq("user_id", input.user_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!target) throw new Error("User not found in your tenant.");

    // Guardrail: prevent deactivating the last active TENANT_ADMIN.
    if (!input.active && target.role === "TENANT_ADMIN" && target.is_active) {
      const { count } = await service
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", ctx.actor.tenantId)
        .eq("role", "TENANT_ADMIN")
        .eq("is_active", true)
        .neq("user_id", input.user_id);
      if (!count || count < 1) {
        throw new Error(
          "Cannot deactivate the last active TENANT_ADMIN — promote another admin first.",
        );
      }
    }

    const { error: empErr } = await service
      .from("employees")
      .update({ is_active: input.active })
      .eq("id", target.id);
    if (empErr) throw new Error(empErr.message);

    // Toggle Supabase auth ban to match. Failure here is non-fatal — the
    // is_active flag still gates login via the JWT hook + PDP.
    const { error: banErr } = await service.rpc("set_user_ban", {
      p_user_id: input.user_id,
      // DB function accepts null (unban); Supabase's type generator
      // reports it as non-null since the column has no default. Cast
      // narrowly instead of relaxing the whole RPC contract.
      p_banned_until: (input.active ? null : FAR_FUTURE_BAN) as unknown as string,
    });
    if (banErr) {
      // Best-effort log — swallowing keeps deactivate idempotent even if
      // the underlying auth.users row is missing (edge case).
      console.warn("[users] set_user_ban failed:", banErr.message);
    }

    // If deactivating, also kill sessions immediately.
    let sessionsRevoked = 0;
    if (!input.active) {
      const { data: revokeData } = await service.rpc("revoke_user_sessions", {
        p_user_id: input.user_id,
      });
      if (typeof revokeData === "number") sessionsRevoked = revokeData;
    }

    revalidatePath(REVALIDATE_PATH);

    return {
      result: {
        user_id: input.user_id,
        active: input.active,
        sessions_revoked: sessionsRevoked,
      },
      auditResourceId: target.id,
      auditOldValues: { is_active: target.is_active },
      auditNewValues: { is_active: input.active },
      auditMetadata: {
        target_email: target.email,
        reason: input.reason ?? null,
        sessions_revoked: sessionsRevoked,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// FORCE LOGOUT — revoke every session for the target user without touching
// role or active status. Useful for stale-device / suspected-theft scenarios.
// ---------------------------------------------------------------------------
export const forceLogoutUserAction = withSecureAction({
  schema: forceLogoutSchema,
  resource: "user_admin",
  action: "delete",
  auditAction: "UPDATE",
  auditResourceName: "auth.sessions",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    if (input.user_id === ctx.actor.userId) {
      throw new Error("You cannot force-logout your own session from here.");
    }

    const service = createServiceRoleClient();
    const { data: target, error: findErr } = await service
      .from("employees")
      .select("id, email")
      .eq("user_id", input.user_id)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!target) throw new Error("User not found in your tenant.");

    const { data: revokeData, error: revokeErr } = await service.rpc(
      "revoke_user_sessions",
      { p_user_id: input.user_id },
    );
    if (revokeErr) throw new Error(revokeErr.message);

    revalidatePath(REVALIDATE_PATH);

    return {
      result: {
        user_id: input.user_id,
        sessions_revoked:
          typeof revokeData === "number" ? revokeData : 0,
      },
      auditResourceId: target.id,
      auditMetadata: {
        target_email: target.email,
        reason: input.reason ?? null,
        sessions_revoked:
          typeof revokeData === "number" ? revokeData : 0,
      },
    };
  },
});
