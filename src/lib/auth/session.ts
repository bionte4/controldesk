import { cache } from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { decodeJwtPayload } from "@/lib/auth/jwt-claims";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";
import type { Tables } from "@/types/database";

/**
 * The currently authenticated employee row.
 *
 * Note on `user_id`:
 *   Since migration 0034 the DB column is nullable so HR admins can add
 *   employees without an auth account. However this helper only ever returns
 *   the row belonging to the currently authenticated Supabase user — so at
 *   this specific call site we KNOW `user_id` is non-null. We narrow the type
 *   here to keep every downstream consumer (`authorize()`, `withSecureAction`,
 *   audit logging) free of null-checks.
 */
export type CurrentEmployee = Omit<Tables<"employees">, "user_id"> & {
  user_id: string;
  tenant_slug: string;
};

/**
 * Fetches the currently authenticated user + their employee row. Cached per
 * request via React `cache()` so RSC/Server Actions can call it freely.
 * Returns `null` if the user is anonymous or has no active employee row.
 */
export const getCurrentEmployee = cache(
  async (): Promise<CurrentEmployee | null> => {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    // Hook-injected claims (`tenant_slug`, etc.) live in the JWT only —
    // see `src/lib/auth/jwt-claims.ts` for the rationale.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const claims = decodeJwtPayload(session?.access_token);

    const tenantSlug =
      claims?.tenant_slug ??
      (user.app_metadata as { tenant_slug?: string } | undefined)
        ?.tenant_slug ??
      null;

    // The RLS policy on `employees` filters by tenant_id claim automatically,
    // so this select can never leak across tenants even without an explicit
    // where clause.
    const { data: employee, error } = await supabase
      .from("employees")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !employee || !tenantSlug) return null;
    // The row was fetched via `.eq("user_id", user.id)` where `user.id` is
    // Supabase's non-null auth user id — narrow safely.
    if (!employee.user_id) return null;

    return {
      ...employee,
      user_id: employee.user_id,
      tenant_slug: tenantSlug,
    } satisfies CurrentEmployee;
  },
);

/**
 * Same as `getCurrentEmployee()` but redirects to /login if anonymous. Use
 * inside protected route segments to avoid null-checking everywhere.
 */
export async function requireCurrentEmployee(): Promise<CurrentEmployee> {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");
  return employee;
}

/**
 * Redirects to /dashboard if the current employee lacks any of the allowed
 * roles. Useful in layout files or Server Actions.
 */
export async function requireRole(
  allowed: readonly AnyDbEmployeeRole[],
): Promise<CurrentEmployee> {
  const employee = await requireCurrentEmployee();
  if (!allowed.includes(employee.role as AnyDbEmployeeRole)) {
    redirect("/dashboard?error=forbidden");
  }
  return employee;
}
