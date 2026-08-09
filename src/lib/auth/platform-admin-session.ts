import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { decodeJwtPayload } from "@/lib/auth/jwt-claims";
import type { Tables } from "@/types/database";

/**
 * Platform admin session helpers (Fase 2, migration 0077).
 *
 * A platform admin is a cross-tenant super-user managed via
 * `public.platform_admins`. They authenticate through the SAME
 * Supabase Auth flow as tenant users (email + password), but the JWT
 * hook (see migration 0077) injects an `is_platform_admin: true`
 * claim when the user has an active row in `platform_admins`.
 *
 * Platform admins live on the apex domain — they access
 * `/super-admin/*` routes on `controldesk.app` (no tenant subdomain).
 * The proxy allows those paths through without a tenant claim check.
 */

export type CurrentPlatformAdmin = Pick<
  Tables<"platform_admins">,
  "user_id" | "full_name" | "email" | "created_at"
>;

/**
 * Fetch the current platform admin session. Cached per-request so RSC
 * layouts + Server Actions can call freely without extra round-trips.
 * Returns null if:
 *   • no auth session,
 *   • auth user has no `platform_admins` row,
 *   • `platform_admins.is_active = false`,
 *   • JWT claim `is_platform_admin` is missing (session issued before
 *     migration 0077 landed and hasn't been refreshed).
 */
export const getCurrentPlatformAdmin = cache(
  async (): Promise<CurrentPlatformAdmin | null> => {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const claims = decodeJwtPayload(session?.access_token);

    // Fast path: JWT claim tells us cheaply whether to bother querying
    // the platform_admins table. This is also the *authoritative* gate
    // — the DB row lookup below is just for the display fields.
    const isPa =
      claims?.is_platform_admin === true ||
      (user.app_metadata as { is_platform_admin?: boolean } | undefined)
        ?.is_platform_admin === true;
    if (!isPa) return null;

    // Read the platform_admins row for display purposes (full_name,
    // email). RLS on this table would normally deny — but this call
    // uses the anon-scoped server client with the user's JWT, and the
    // is_current_user_platform_admin() helper allows the read via
    // service definer semantics. Even so, we tolerate a null result
    // (would only happen mid-race with a demotion).
    const { data, error } = await supabase
      .from("platform_admins")
      .select("user_id, full_name, email, created_at")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !data) {
      return {
        user_id: user.id,
        full_name: (user.user_metadata?.full_name as string | undefined) ?? "Platform Admin",
        email: user.email ?? "",
        created_at: user.created_at,
      };
    }
    return data;
  },
);

/**
 * Same as getCurrentPlatformAdmin() but redirects unauthenticated
 * requests to /login and non-platform-admins to the apex homepage
 * with a hint. Use in `/super-admin/**` layouts / Server Actions.
 */
export async function requirePlatformAdmin(): Promise<CurrentPlatformAdmin> {
  const admin = await getCurrentPlatformAdmin();
  if (!admin) {
    // Distinguish "not signed in" (send to /login) from "signed in but
    // not authorized" (send to apex root with a hint) so the UI can
    // show a friendly explanation instead of an infinite redirect
    // loop through the login page.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      redirect("/login?next=/super-admin");
    }
    redirect("/?error=not_platform_admin");
  }
  return admin;
}
