/**
 * JWT claim helpers.
 *
 * The Supabase custom access-token hook (see
 * `supabase/migrations/0003_rls_helpers.sql`) injects `tenant_slug`,
 * `tenant_id`, `role`, and `employee_id` into every issued JWT. Those
 * claims are the source of truth for authorization decisions — they are
 * **not** mirrored to `auth.users.raw_app_meta_data`, so
 * `supabase.auth.getUser()` cannot surface them.
 *
 * Callers should:
 *   1. Verify the session via `supabase.auth.getUser()` (server round-trip).
 *   2. Read the raw access_token via `supabase.auth.getSession()`.
 *   3. Decode the JWT payload with {@link decodeJwtPayload} to read the
 *      hook-injected custom claims.
 *
 * The decode step here does **not** verify the JWT signature; verification
 * has already been done by the Auth server via `getUser()`. Callers must
 * therefore always call `getUser()` before trusting anything from this
 * module.
 */

import type { EmployeeRole } from "@/lib/rbac/roles";

export type AppJwtClaims = {
  sub?: string;
  tenant_id?: string;
  tenant_slug?: string;
  /**
   * ControlDesk employee role — set by migration 0020's access-token hook
   * under `user_role`. Older sessions may still carry it under the top-level
   * `role` claim (pre-0020). Prefer `user_role`.
   */
  user_role?: EmployeeRole;
  /**
   * Postgres role claim consumed by PostgREST. On ControlDesk JWTs this stays
   * `"authenticated"` — see migration 0020 for the rationale.
   */
  role?: EmployeeRole | "authenticated" | string;
  employee_id?: string;
  [key: string]: unknown;
};

/**
 * Decode a JWT payload without signature verification. Safe to use only
 * after the caller has verified the session via `supabase.auth.getUser()`.
 * Returns `null` when the token is malformed.
 */
export function decodeJwtPayload(jwt: string | null | undefined): AppJwtClaims | null {
  if (!jwt) return null;
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    const padLen = (4 - (payload.length % 4)) % 4;
    const b64 =
      payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen);
    const json =
      typeof globalThis.atob === "function"
        ? globalThis.atob(b64)
        : Buffer.from(b64, "base64").toString("utf-8");
    return JSON.parse(json) as AppJwtClaims;
  } catch {
    return null;
  }
}
