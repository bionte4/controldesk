/**
 * ControlDesk — Client Portal session helpers (GAS §28).
 *
 * Portal users authenticate via password (scrypt) + opaque session token, NOT
 * through Supabase Auth. This module reads the `cd_portal_session` cookie,
 * validates it against `client_user_sessions`, and returns the current
 * client-user record.
 *
 * Design constraints:
 *   • Every read query uses the service-role Supabase client because portal
 *     users have no JWT — RLS `authenticated` policies would deny them.
 *     App-layer filters (`tenant_id`, `client_id`) are mandatory on every
 *     call site; helpers in `src/lib/portal/data.ts` enforce this.
 *   • The cookie stores the raw session token; the DB stores only
 *     `sha256(token)` (see `src/lib/portal/crypto.ts::hashToken`).
 *   • Sessions have a hard TTL (`expires_at`) AND soft revocation
 *     (`revoked_at`). Any session with either constraint failing is treated
 *     as expired and the cookie is cleared on the next response.
 */

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

import { hashToken } from "./crypto";
import {
  SESSION_ACTIVITY_COOKIE,
  SESSION_STARTED_COOKIE,
  verifySessionTimestamp,
} from "@/lib/security/session-timeout-cookie";

export const PORTAL_COOKIE_NAME = "cd_portal_session";
export const PORTAL_SESSION_TTL_SECONDS = 60 * 60 * 8;

export type ClientUserRow = Tables<"client_users">;
export type ClientRow = Tables<"clients">;

export type PortalSession = {
  session_id: string;
  client_user: ClientUserRow;
  client: Pick<
    ClientRow,
    "id" | "tenant_id" | "name" | "contact_email" | "contact_name"
  >;
  expires_at: string;
};

/**
 * Read the portal cookie, validate against the DB, and return the current
 * session. Wrapped in `React.cache()` so a single RSC render only performs
 * one DB round-trip. Returns `null` when the visitor is anonymous, when the
 * cookie is missing / corrupt, or when the session is expired / revoked.
 */
export const getCurrentPortalSession = cache(
  async (): Promise<PortalSession | null> => {
    const jar = await cookies();
    const raw = jar.get(PORTAL_COOKIE_NAME)?.value;
    if (!raw) return null;

    const tokenHash = hashToken(raw);
    const supabase = createServiceRoleClient();

    const { data: session, error: sessionErr } = await supabase
      .from("client_user_sessions")
      .select("id, tenant_id, client_user_id, expires_at, revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (sessionErr || !session) return null;

    if (session.revoked_at) return null;
    if (new Date(session.expires_at).getTime() <= Date.now()) return null;

    // Signed-cookie timeout is enforced server-side for portal RSC/actions.
    // Missing timestamps are allowed for the first request; the provider's
    // authenticated heartbeat establishes them immediately.
    const [startedAt, activeAt] = await Promise.all([
      verifySessionTimestamp(jar.get(SESSION_STARTED_COOKIE)?.value),
      verifySessionTimestamp(jar.get(SESSION_ACTIVITY_COOKIE)?.value),
    ]);
    const { data: policy } = await supabase
      .from("tenants")
      .select("idle_timeout_minutes,absolute_session_minutes")
      .eq("id", session.tenant_id)
      .maybeSingle();
    const now = Date.now();
    if (activeAt && policy && now - activeAt >= policy.idle_timeout_minutes * 60_000) return null;
    if (startedAt && policy && now - startedAt >= policy.absolute_session_minutes * 60_000) return null;

    const { data: user, error: userErr } = await supabase
      .from("client_users")
      .select("*")
      .eq("id", session.client_user_id)
      .eq("tenant_id", session.tenant_id)
      .maybeSingle();
    if (userErr || !user) return null;
    // Both ACTIVE (fully provisioned) and PENDING_ACTIVATION (admin-invited,
    // hasn't rotated the temp password yet) are considered authenticated at
    // the session layer. `requirePortalSession()` decides which routes are
    // reachable based on `client_user.status` — a PENDING_ACTIVATION visitor
    // may only reach `/portal/change-password` and `/portal/login` (logout).
    if (user.status !== "ACTIVE" && user.status !== "PENDING_ACTIVATION") {
      return null;
    }

    const { data: client, error: clientErr } = await supabase
      .from("clients")
      .select("id, tenant_id, name, contact_email, contact_name")
      .eq("id", user.client_id)
      .eq("tenant_id", user.tenant_id)
      .maybeSingle();
    if (clientErr || !client) return null;

    return {
      session_id: session.id,
      client_user: user as unknown as ClientUserRow,
      client: client as unknown as PortalSession["client"],
      expires_at: session.expires_at,
    };
  },
);

/**
 * Same as `getCurrentPortalSession()` but redirects unauthenticated visitors
 * to `/portal/login`. Use in protected portal RSC pages.
 *
 * PENDING_ACTIVATION visitors are further redirected to
 * `/portal/change-password` — the only route they can reach until they set
 * a permanent password. Pass `allowPendingActivation: true` in the
 * change-password page itself to opt out of the redirect (otherwise you'd
 * loop).
 */
export async function requirePortalSession(
  opts?: { allowPendingActivation?: boolean },
): Promise<PortalSession> {
  const session = await getCurrentPortalSession();
  if (!session) redirect("/portal/login");
  if (
    !opts?.allowPendingActivation &&
    session.client_user.status === "PENDING_ACTIVATION"
  ) {
    redirect("/portal/change-password");
  }
  return session;
}
