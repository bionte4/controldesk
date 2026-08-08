import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { EmployeeRole } from "@/lib/rbac/roles";

/**
 * Read-only projection of `auth.users` ⋈ `public.employees` restricted to
 * the current tenant, sourced from the `public.admin_list_users()` RPC
 * introduced in migration 0052.
 *
 * The RPC handles both tenant scoping and the admin-role guard, so callers
 * only need to invoke it — they do not have to add a `WHERE tenant_id = …`
 * clause on top. Non-admin callers receive an empty array (defense in depth
 * beyond the UI-level `filterNavForRole()` filter).
 */
export type AdminUserRow = {
  user_id: string;
  email: string | null;
  employee_id: string | null;
  employee_name: string | null;
  employee_role: EmployeeRole | null;
  employee_is_active: boolean | null;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
  auth_created_at: string | null;
  tenant_id: string | null;
};

/**
 * Server-side filter shape mirrored by the page's search box + status
 * dropdown. All fields are optional — an empty filter returns the full
 * tenant list (subject to the admin role guard baked into the RPC).
 */
export type AdminUserFilter = {
  /** Case-insensitive substring match on email OR full_name. */
  q?: string;
  /**
   * "active"   → employees.is_active = true AND auth.banned_until IS NULL.
   * "suspended"→ auth.banned_until IS NOT NULL AND banned_until > now().
   * "inactive" → employees.is_active = false OR employees row missing.
   * undefined   → no status filter.
   */
  status?: "active" | "suspended" | "inactive";
};

/**
 * Fetch the admin-user list for the current tenant. Cached per-request via
 * `React.cache()` so the RSC can call it more than once (search bar +
 * counter + table) without re-hitting the RPC.
 *
 * We deliberately apply the filter in JS after the fetch rather than
 * pushing it into the RPC — the tenant's internal user count is small
 * (< 200 in practice) and keeping filtering in TypeScript lets us evolve
 * the UX without changing the migration surface.
 */
export const loadAdminUsers = cache(
  async (filter: AdminUserFilter = {}): Promise<AdminUserRow[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_list_users");
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as AdminUserRow[];

    const q = filter.q?.trim().toLowerCase() ?? "";
    const status = filter.status;
    const now = Date.now();

    return rows.filter((r) => {
      if (q) {
        const email = (r.email ?? "").toLowerCase();
        const name = (r.employee_name ?? "").toLowerCase();
        if (!email.includes(q) && !name.includes(q)) return false;
      }
      if (status) {
        const suspended =
          r.banned_until != null && new Date(r.banned_until).getTime() > now;
        if (status === "suspended") {
          if (!suspended) return false;
        } else if (status === "inactive") {
          const hasActiveEmployee = r.employee_is_active === true;
          if (hasActiveEmployee && !suspended) return false;
        } else if (status === "active") {
          if (suspended) return false;
          if (r.employee_is_active === false) return false;
        }
      }
      return true;
    });
  },
);

/**
 * Derive the display status of a row for badge rendering. Callers should
 * pass the current time so unit tests can pin the result deterministically.
 */
export type AdminUserStatus = "ACTIVE" | "SUSPENDED" | "INACTIVE" | "PENDING";

export function deriveAdminUserStatus(
  row: Pick<
    AdminUserRow,
    "banned_until" | "employee_is_active" | "email_confirmed_at"
  >,
  now: Date = new Date(),
): AdminUserStatus {
  if (
    row.banned_until != null &&
    new Date(row.banned_until).getTime() > now.getTime()
  ) {
    return "SUSPENDED";
  }
  if (row.email_confirmed_at == null) return "PENDING";
  if (row.employee_is_active === false) return "INACTIVE";
  return "ACTIVE";
}
