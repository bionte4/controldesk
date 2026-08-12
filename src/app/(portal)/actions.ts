"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { getTenantContext } from "@/lib/tenant/context";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  generateSessionToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "@/lib/portal/crypto";
import {
  PORTAL_COOKIE_NAME,
  PORTAL_SESSION_TTL_SECONDS,
  getCurrentPortalSession,
} from "@/lib/portal/session";
import { portalLoginSchema } from "@/lib/validation/portal-auth";
import { portalChangePasswordSchema } from "@/lib/validation/portal-change-password";

/**
 * Result contract mirrors `ActionResult` from `withSecureAction` (rules §17).
 * We can't reuse `withSecureAction` directly because portal callers have no
 * `auth.users` record — the wrapper's PDP calls would deny before we could
 * verify a password.
 */
export type PortalLoginResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "INVALID_INPUT"
        | "INVALID_CREDENTIALS"
        | "ACCOUNT_LOCKED"
        | "TENANT_UNKNOWN"
        | "INTERNAL";
      reason: string;
    };

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

async function forensicMeta(): Promise<{
  ip_address: string | null;
  user_agent: string | null;
}> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    null;
  return { ip_address: ip, user_agent: h.get("user-agent") };
}

/**
 * Log a portal auth event into `portal_login_events` (append-only, rules §3).
 * Silent-fails on errors to avoid leaking auth state via a 500 response.
 */
async function recordEvent(input: {
  tenant_id: string;
  client_user_id: string | null;
  email_attempted: string | null;
  event:
    | "SUCCESS"
    | "FAILURE_UNKNOWN_USER"
    | "FAILURE_BAD_PASSWORD"
    | "FAILURE_LOCKED"
    | "LOGOUT"
    | "SESSION_EXPIRED";
}): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const meta = await forensicMeta();
    await supabase.from("portal_login_events").insert({
      tenant_id: input.tenant_id,
      client_user_id: input.client_user_id,
      email_attempted: input.email_attempted,
      event: input.event,
      ip_address: meta.ip_address,
      user_agent: meta.user_agent,
    });
  } catch {
    // deliberately swallow — audit-log write must never break auth path.
  }
}

// ---------------------------------------------------------------------------
// Login action.
// ---------------------------------------------------------------------------
export async function portalLoginAction(input: {
  email: string;
  password: string;
}): Promise<PortalLoginResult> {
  const parsed = portalLoginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const tenant = await getTenantContext();
  if (!tenant.id) {
    return {
      ok: false,
      code: "TENANT_UNKNOWN",
      reason:
        "Portal must be accessed via a tenant subdomain (e.g. demo.controldesk.app).",
    };
  }

  const supabase = createServiceRoleClient();
  const { data: user, error: readErr } = await supabase
    .from("client_users")
    .select(
      "id, tenant_id, client_id, email, password_hash, status, failed_login_count, locked_until",
    )
    .eq("tenant_id", tenant.id)
    .eq("email", parsed.data.email)
    .maybeSingle();

  if (readErr) {
    return { ok: false, code: "INTERNAL", reason: "Login unavailable." };
  }
  if (!user) {
    await recordEvent({
      tenant_id: tenant.id,
      client_user_id: null,
      email_attempted: parsed.data.email,
      event: "FAILURE_UNKNOWN_USER",
    });
    // Uniform message — do NOT leak whether the account exists.
    return {
      ok: false,
      code: "INVALID_CREDENTIALS",
      reason: "Incorrect email or password.",
    };
  }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    await recordEvent({
      tenant_id: tenant.id,
      client_user_id: user.id,
      email_attempted: parsed.data.email,
      event: "FAILURE_LOCKED",
    });
    return {
      ok: false,
      code: "ACCOUNT_LOCKED",
      reason: "Account temporarily locked. Try again later.",
    };
  }

  if (user.status !== "ACTIVE") {
    await recordEvent({
      tenant_id: tenant.id,
      client_user_id: user.id,
      email_attempted: parsed.data.email,
      event: "FAILURE_BAD_PASSWORD",
    });
    return {
      ok: false,
      code: "INVALID_CREDENTIALS",
      reason: "Incorrect email or password.",
    };
  }

  const passwordOk = await verifyPassword(
    parsed.data.password,
    user.password_hash,
  );
  if (!passwordOk) {
    const nextFailCount = (user.failed_login_count ?? 0) + 1;
    const shouldLock = nextFailCount >= LOCKOUT_THRESHOLD;
    await supabase
      .from("client_users")
      .update({
        failed_login_count: nextFailCount,
        locked_until: shouldLock
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
          : null,
      })
      .eq("id", user.id);
    await recordEvent({
      tenant_id: tenant.id,
      client_user_id: user.id,
      email_attempted: parsed.data.email,
      event: "FAILURE_BAD_PASSWORD",
    });
    return {
      ok: false,
      code: "INVALID_CREDENTIALS",
      reason: "Incorrect email or password.",
    };
  }

  // Success — issue a session.
  const rawToken = generateSessionToken();
  const tokenHash = hashToken(rawToken);
  const expires = new Date(
    Date.now() + PORTAL_SESSION_TTL_SECONDS * 1_000,
  ).toISOString();
  const meta = await forensicMeta();

  const { error: insertErr } = await supabase
    .from("client_user_sessions")
    .insert({
      tenant_id: tenant.id,
      client_user_id: user.id,
      token_hash: tokenHash,
      expires_at: expires,
      ip_address: meta.ip_address,
      user_agent: meta.user_agent,
    });
  if (insertErr) {
    return { ok: false, code: "INTERNAL", reason: "Login failed." };
  }

  // Clear failure counter + stamp last_login_at.
  await supabase
    .from("client_users")
    .update({
      failed_login_count: 0,
      locked_until: null,
      last_login_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  const jar = await cookies();
  jar.set(PORTAL_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PORTAL_SESSION_TTL_SECONDS,
  });

  await recordEvent({
    tenant_id: tenant.id,
    client_user_id: user.id,
    email_attempted: parsed.data.email,
    event: "SUCCESS",
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Change password — invoked from `/portal/change-password` (rules §28 B.4).
// Serves two flows:
//   1. PENDING_ACTIVATION → set permanent password + flip status to ACTIVE.
//   2. ACTIVE → voluntary rotation (future work; the page currently only
//      exposes the flow for #1, but the action supports both).
// ---------------------------------------------------------------------------
export type PortalChangePasswordResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "UNAUTHENTICATED"
        | "INVALID_INPUT"
        | "INVALID_CREDENTIALS"
        | "INTERNAL";
      reason: string;
    };

export async function portalChangePasswordAction(input: {
  current_password: string;
  new_password: string;
  confirm_password: string;
}): Promise<PortalChangePasswordResult> {
  const session = await getCurrentPortalSession();
  if (!session) {
    return { ok: false, code: "UNAUTHENTICATED", reason: "Not signed in." };
  }

  const parsed = portalChangePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      reason: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const supabase = createServiceRoleClient();

  // Fetch a fresh hash from the DB — session cache may be stale.
  const { data: user, error: readErr } = await supabase
    .from("client_users")
    .select("id, password_hash, status")
    .eq("id", session.client_user.id)
    .eq("tenant_id", session.client.tenant_id)
    .maybeSingle();
  if (readErr || !user) {
    return { ok: false, code: "INTERNAL", reason: "Unable to load account." };
  }

  const currentOk = await verifyPassword(
    parsed.data.current_password,
    user.password_hash,
  );
  if (!currentOk) {
    return {
      ok: false,
      code: "INVALID_CREDENTIALS",
      reason: "The current password is incorrect.",
    };
  }

  const newHash = await hashPassword(parsed.data.new_password);
  const { error: updErr } = await supabase
    .from("client_users")
    .update({
      password_hash: newHash,
      status: "ACTIVE",
      failed_login_count: 0,
      locked_until: null,
    })
    .eq("id", user.id)
    .eq("tenant_id", session.client.tenant_id);
  if (updErr) {
    return { ok: false, code: "INTERNAL", reason: "Update failed." };
  }

  // Revoke ALL OTHER sessions — the current cookie stays valid so the user
  // doesn't have to sign in again immediately after changing.
  await supabase
    .from("client_user_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("client_user_id", user.id)
    .eq("tenant_id", session.client.tenant_id)
    .neq("id", session.session_id)
    .is("revoked_at", null);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Notifications — mark a single or all notifications as read (rules §28 B.4).
// ---------------------------------------------------------------------------
export type PortalMarkReadResult =
  | { ok: true; updated: number }
  | { ok: false; code: "UNAUTHENTICATED" | "INTERNAL"; reason: string };

export async function markPortalNotificationRead(
  notificationId: string,
): Promise<PortalMarkReadResult> {
  const session = await getCurrentPortalSession();
  if (!session) {
    return { ok: false, code: "UNAUTHENTICATED", reason: "Not signed in." };
  }
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("portal_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("tenant_id", session.client.tenant_id)
    // Belt-and-braces: even if the caller passes another client_user's id
    // we still bind the update to the current session's user.
    .eq("client_user_id", session.client_user.id)
    .is("read_at", null)
    .select("id");
  if (error) {
    return { ok: false, code: "INTERNAL", reason: "Update failed." };
  }
  return { ok: true, updated: data?.length ?? 0 };
}

export async function markAllPortalNotificationsRead(): Promise<PortalMarkReadResult> {
  const session = await getCurrentPortalSession();
  if (!session) {
    return { ok: false, code: "UNAUTHENTICATED", reason: "Not signed in." };
  }
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("portal_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", session.client.tenant_id)
    .eq("client_user_id", session.client_user.id)
    .is("read_at", null)
    .select("id");
  if (error) {
    return { ok: false, code: "INTERNAL", reason: "Update failed." };
  }
  return { ok: true, updated: data?.length ?? 0 };
}

// ---------------------------------------------------------------------------
// Logout — revoke session + clear cookie + audit.
// ---------------------------------------------------------------------------
export async function portalLogoutAction(): Promise<void> {
  const session = await getCurrentPortalSession();
  if (session) {
    const supabase = createServiceRoleClient();
    await supabase
      .from("client_user_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", session.session_id)
      .eq("tenant_id", session.client.tenant_id);
    await recordEvent({
      tenant_id: session.client.tenant_id,
      client_user_id: session.client_user.id,
      email_attempted: session.client_user.email,
      event: "LOGOUT",
    });
  }
  const jar = await cookies();
  jar.set(PORTAL_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  redirect("/portal/login");
}
