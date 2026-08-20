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
 *
 * Note on `monthly_salary` / `hourly_rate`:
 *   Migration 0100 REVOKE'd column-level SELECT on these fields from the
 *   `authenticated` role — user-JWT reads via this helper would fail with
 *   "permission denied for column …" if they were included in the SELECT.
 *   Legitimate salary readers (payroll cron, UPK auto-gen) use the
 *   service-role Supabase client after PDP authorization and do NOT go
 *   through `getCurrentEmployee()`, so omitting them here is safe.
 */
export type CurrentEmployee = Omit<
  Tables<"employees">,
  "user_id" | "monthly_salary" | "hourly_rate"
> & {
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
    //
    // Column list is enumerated explicitly (was `select("*")` pre-migration
    // 0100) because 0100 REVOKE'd table-level SELECT from `authenticated`
    // and re-granted column-level SELECT on every column EXCEPT
    // `monthly_salary` and `hourly_rate`. `select("*")` still hits the
    // table-level path and fails with "permission denied for relation
    // employees" — which cascaded into an infinite `/dashboard ↔ /login`
    // redirect loop because `getCurrentEmployee()` returned null while the
    // proxy still saw a valid session cookie. This layout-critical function
    // does NOT need salary fields, so we simply skip them.
    //
    // If a new column is added to `employees`, add it here too — otherwise
    // the field will be missing from every `CurrentEmployee` payload.
    const { data: employee, error } = await supabase
      .from("employees")
      .select(
        `id, tenant_id, user_id, full_name, first_name, last_name, email,
         phone, role, is_active, availability, employment_type, join_date,
         terminated_at, contract_end_date, reports_to_employee_id,
         department, division, position_title, client_display_name,
         date_of_birth, emergency_contact_name, emergency_contact_phone,
         bank_account_number_enc, nik_enc, nik_hash, pii_anonymized_at,
         preferred_locale, notes, created_at, updated_at`,
      )
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
