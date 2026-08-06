import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { AnyDbEmployeeRole, EmployeeRole } from "@/lib/rbac/roles";
import type { NotificationKind } from "@/types/database";

/**
 * ControlDesk in-app notification service (rules §20).
 *
 * Wraps the `public.enqueue_notification` RPC (SECURITY DEFINER) so
 * server actions can fan out approval events to the appropriate approver
 * without leaking cross-tenant data.
 *
 * The RPC enforces tenant isolation itself; we still call it defensively
 * (single-tenant per invocation) and swallow errors so a notification hiccup
 * never fails the underlying business mutation.
 */

export type NotifyRecipient = {
  userId: string;
  employeeId?: string | null;
};

/**
 * Fire a single in-app notification. Errors are logged, never thrown.
 */
export async function notifyUser(input: {
  recipient: NotifyRecipient;
  kind: NotificationKind;
  title: string;
  body?: string;
  actionUrl?: string;
  payload?: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("enqueue_notification", {
    p_recipient_user_id: input.recipient.userId,
    p_kind: input.kind,
    p_title: input.title,
    p_body: input.body ?? undefined,
    p_action_url: input.actionUrl ?? undefined,
    p_payload: input.payload ? (input.payload as never) : undefined,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Fan out a notification to every ACTIVE employee in the given tenant whose
 * `role` is in `roles`. Best-effort — silently skips any single-recipient
 * failures.
 */
export async function notifyRoles(input: {
  tenantId: string;
  /**
   * Accepts both legacy DB codes (e.g. `PROJECT_MANAGER`) and canonical
   * ones (e.g. `PM`). We simply forward the strings to the `IN (...)` clause
   * on `employees.role`, so mixing both is safe as long as the value exists
   * in the DB enum (see migration 0021).
   */
  roles: readonly (EmployeeRole | AnyDbEmployeeRole)[];
  kind: NotificationKind;
  title: string;
  body?: string;
  actionUrl?: string;
  payload?: Record<string, unknown>;
}): Promise<{ delivered: number; failed: number }> {
  if (input.roles.length === 0) return { delivered: 0, failed: 0 };

  const supabase = await createClient();
  const { data: recipients, error } = await supabase
    .from("employees")
    .select("user_id, id")
    .eq("tenant_id", input.tenantId)
    .eq("is_active", true)
    // Cast: `roles` widens across legacy + canonical DB codes. Supabase's
    // generated `.in()` narrows to the legacy union — the DB enum actually
    // accepts all values (see migration 0021).
    .in("role", [...input.roles] as unknown as EmployeeRole[]);
  if (error || !recipients) return { delivered: 0, failed: 0 };

  let delivered = 0;
  let failed = 0;
  await Promise.all(
    recipients.map(async (r) => {
      const res = await notifyUser({
        recipient: { userId: r.user_id, employeeId: r.id },
        kind: input.kind,
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl,
        payload: input.payload,
      });
      if (res.ok) delivered += 1;
      else failed += 1;
    }),
  );
  return { delivered, failed };
}
