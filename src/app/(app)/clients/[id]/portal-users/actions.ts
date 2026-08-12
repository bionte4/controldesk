"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { generateTempPassword, hashPassword } from "@/lib/portal/crypto";
import { withSecureAction } from "@/lib/security/action-wrapper";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  createClientPortalUserSchema,
  resetClientPortalUserPasswordSchema,
  updateClientPortalUserStatusSchema,
} from "@/lib/validation/client-portal-user";

/**
 * Create a new Client Portal user (rules §28 B.4 admin).
 *
 * Flow:
 *   1. Admin selects an existing client + provides email + full_name.
 *   2. Server generates a temporary 12-char password (rejection-sampled
 *      against a look-alike-free alphabet — see `generateTempPassword`).
 *   3. Password is scrypt-hashed and stored; the plaintext is returned to
 *      the admin exactly ONCE via the action result so it can be shared
 *      out-of-band with the client. It is never logged nor persisted.
 *   4. Status defaults to `PENDING_ACTIVATION` — the client can log in
 *      immediately, but the value flags "hasn't logged in yet".
 *
 * We deliberately use the service-role client for the INSERT because RLS on
 * `client_users` is `service_role only` (see migration 0023).
 */
export const createClientPortalUserAction = withSecureAction({
  schema: createClientPortalUserSchema,
  resource: "client_portal_user",
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "client_users",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, _ctx) => {
    const service = createServiceRoleClient();
    const employee = await requireCurrentEmployee();

    // Confirm the client belongs to this tenant BEFORE we create anything.
    const { data: client, error: clientErr } = await service
      .from("clients")
      .select("id, tenant_id, name")
      .eq("id", input.clientId)
      .eq("tenant_id", employee.tenant_id)
      .maybeSingle();
    if (clientErr || !client) {
      throw new Error("Client not found in your tenant.");
    }

    // Enforce email uniqueness within the tenant BEFORE hashing so we don't
    // waste scrypt cycles on duplicate submissions.
    const { data: existing } = await service
      .from("client_users")
      .select("id")
      .eq("tenant_id", employee.tenant_id)
      .eq("email", input.email)
      .maybeSingle();
    if (existing) {
      throw new Error(
        "A portal user with this email already exists in this tenant.",
      );
    }

    const tempPassword = generateTempPassword(12);
    const passwordHash = await hashPassword(tempPassword);

    const { data, error } = await service
      .from("client_users")
      .insert({
        tenant_id: employee.tenant_id,
        client_id: input.clientId,
        email: input.email,
        password_hash: passwordHash,
        full_name: input.full_name,
        status: "PENDING_ACTIVATION",
        created_by: employee.id,
      })
      .select("id, email, full_name, status")
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? "Failed to create portal user.");
    }

    revalidatePath(`/clients/${input.clientId}/portal-users`);

    return {
      // NEVER include `temp_password` in the audit snapshot.
      result: {
        id: data.id,
        email: data.email,
        full_name: data.full_name,
        status: data.status,
        temp_password: tempPassword,
      },
      auditResourceId: data.id,
      auditNewValues: {
        client_id: input.clientId,
        email: data.email,
        full_name: data.full_name,
        status: data.status,
      },
    };
  },
});

/**
 * Rotate a portal user's password. Server generates a new temporary
 * password, returns it to the admin ONCE, and revokes ALL existing sessions
 * for the user so any active browser is signed out.
 */
export const resetClientPortalUserPasswordAction = withSecureAction({
  schema: resetClientPortalUserPasswordSchema,
  resource: "client_portal_user",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "client_users",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const service = createServiceRoleClient();

    const { data: user, error: readErr } = await service
      .from("client_users")
      .select("id, tenant_id, client_id, email, status")
      .eq("id", input.clientPortalUserId)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (readErr || !user) {
      throw new Error("Portal user not found in your tenant.");
    }

    const tempPassword = generateTempPassword(12);
    const passwordHash = await hashPassword(tempPassword);

    const { error: updErr } = await service
      .from("client_users")
      .update({
        password_hash: passwordHash,
        // A fresh admin-issued temp password ALWAYS forces the user through
        // the change-password flow on next sign-in (rules §28 B.4).
        status: "PENDING_ACTIVATION",
        failed_login_count: 0,
        locked_until: null,
      })
      .eq("id", user.id)
      .eq("tenant_id", ctx.actor.tenantId);
    if (updErr) throw new Error(updErr.message);

    // Kick every active browser off — password rotation must invalidate
    // outstanding sessions immediately.
    await service
      .from("client_user_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("client_user_id", user.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .is("revoked_at", null);

    revalidatePath(`/clients/${user.client_id}/portal-users`);

    return {
      result: {
        id: user.id,
        email: user.email,
        temp_password: tempPassword,
      },
      auditResourceId: user.id,
      auditMetadata: { action: "reset_password" },
    };
  },
});

/**
 * Toggle a portal user's status between ACTIVE and DISABLED. Also revokes
 * all sessions if disabling.
 */
export const updateClientPortalUserStatusAction = withSecureAction({
  schema: updateClientPortalUserStatusSchema,
  resource: "client_portal_user",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "client_users",
  resolveAttributes: async (_input, ctx) => ({ tenantId: ctx.actor.tenantId }),
  handler: async (input, ctx) => {
    const service = createServiceRoleClient();

    const { data: user, error: readErr } = await service
      .from("client_users")
      .select("id, tenant_id, client_id, status")
      .eq("id", input.clientPortalUserId)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();
    if (readErr || !user) {
      throw new Error("Portal user not found in your tenant.");
    }

    const { data, error } = await service
      .from("client_users")
      .update({
        status: input.status,
        // On DISABLE also clear lockout state so future re-enable is clean.
        ...(input.status === "DISABLED"
          ? { failed_login_count: 0, locked_until: null }
          : {}),
      })
      .eq("id", user.id)
      .eq("tenant_id", ctx.actor.tenantId)
      .select("id, status")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Update failed.");

    if (input.status === "DISABLED") {
      await service
        .from("client_user_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("client_user_id", user.id)
        .eq("tenant_id", ctx.actor.tenantId)
        .is("revoked_at", null);
    }

    revalidatePath(`/clients/${user.client_id}/portal-users`);

    return {
      result: { id: data.id, status: data.status },
      auditResourceId: data.id,
      auditOldValues: { status: user.status },
      auditNewValues: { status: data.status },
    };
  },
});

/**
 * Read-only list of portal users for a given client. Called by the admin
 * page — returns rows using the invoker's SSR Supabase client so RLS still
 * applies if a downstream policy is added. Currently `client_users` is
 * service_role only, so we fall back to the service client scoped by
 * tenant + client. This is a READ, so we don't need `withSecureAction`.
 */
export async function listClientPortalUsers(clientId: string) {
  const employee = await requireCurrentEmployee();
  const supabase = await createClient();
  // Verify the client is in this tenant using the RLS-bound client first.
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .eq("tenant_id", employee.tenant_id)
    .maybeSingle();
  if (!client) return null;

  const service = createServiceRoleClient();
  const { data, error } = await service
    .from("client_users")
    .select(
      "id, email, full_name, status, last_login_at, failed_login_count, locked_until, created_at",
    )
    .eq("tenant_id", employee.tenant_id)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return { client, users: data ?? [] };
}

// ---------------------------------------------------------------------------
// Login events lens (rules §3 audit trail, GAS §28) — read-only.
// ---------------------------------------------------------------------------
export type PortalLoginEventRow = {
  id: number;
  client_user_id: string | null;
  email_attempted: string | null;
  event: string;
  // Postgres `inet` — Supabase types it as `unknown`; we accept unknown here
  // and stringify at render time.
  ip_address: unknown;
  user_agent: string | null;
  created_at: string;
};

/**
 * List the last N portal login events for portal users belonging to a client.
 *
 * Security contract:
 *   1. Verify the client is in the caller's tenant via the RLS-bound client
 *      first — the same pattern used by `listClientPortalUsers`.
 *   2. Fetch the client's portal user IDs (may be empty).
 *   3. Query `portal_login_events` via the service-role client, scoping by
 *      `(tenant_id, client_user_id in ...)`. `email_attempted` failures for
 *      unknown-user events are intentionally NOT surfaced here because they
 *      have no `client_user_id` binding — surfacing them per-client would
 *      leak enumeration attempts across tenants. Ops can still query them
 *      globally via the SQL console for tenant-wide investigations.
 *
 * Returns null when the client is not in the caller's tenant so the page
 * can 404 consistently with the users list.
 */
export async function listClientPortalLoginEvents(
  clientId: string,
  opts?: { limit?: number },
): Promise<{
  client: { id: string; name: string };
  events: (PortalLoginEventRow & { user_email: string | null })[];
} | null> {
  const employee = await requireCurrentEmployee();
  const supabase = await createClient();
  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .eq("tenant_id", employee.tenant_id)
    .maybeSingle();
  if (!client) return null;

  const service = createServiceRoleClient();

  const { data: users, error: usersErr } = await service
    .from("client_users")
    .select("id, email")
    .eq("tenant_id", employee.tenant_id)
    .eq("client_id", clientId);
  if (usersErr) throw usersErr;

  const userIds = (users ?? []).map((u) => u.id);
  const emailByUserId = new Map(
    (users ?? []).map((u) => [u.id, u.email as string | null] as const),
  );

  if (userIds.length === 0) {
    return { client, events: [] };
  }

  const { data: events, error: evErr } = await service
    .from("portal_login_events")
    .select(
      "id, client_user_id, email_attempted, event, ip_address, user_agent, created_at",
    )
    .eq("tenant_id", employee.tenant_id)
    .in("client_user_id", userIds)
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 50);
  if (evErr) throw evErr;

  return {
    client,
    events: (events ?? []).map((e) => ({
      ...(e as unknown as PortalLoginEventRow),
      user_email: e.client_user_id ? emailByUserId.get(e.client_user_id) ?? null : null,
    })),
  };
}
