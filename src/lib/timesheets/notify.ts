import "server-only";

import { notifyRoles, notifyUser } from "@/lib/notifications/service";
import { createClient } from "@/lib/supabase/server";

/**
 * Notify the appropriate approver(s) that a submitter has queued a
 * timesheet packet (daily or weekly) for review.
 *
 * Resolution ladder — first match wins:
 *   1. Submitter's direct supervisor via `employees.reports_to_employee_id`.
 *      A precise, one-user notification when the org chart is filled in.
 *   2. Tenant-wide fan-out to PROJECT_MANAGER + PM + SUPERVISOR + TENANT_ADMIN
 *      roles. Broader, but ensures the packet doesn't sit unseen in
 *      tenants without a supervisor chain wired up.
 *
 * Both hops use `notifyUser()` / `notifyRoles()` which fan out to
 * in-app + Telegram + WhatsApp based on each recipient's preferences.
 * All calls are best-effort — failures never propagate.
 *
 * Called from:
 *   * `src/app/(app)/hr/timesheets/actions.ts::submitTimesheetAction`
 *   * `src/app/(app)/hr/timesheets/weekly/actions.ts::submitWeeklyTimesheetAction`
 *
 * Kept out of the notifications service module because it queries the
 * `employees` table (business-domain concern) — the service module is
 * intentionally domain-agnostic and only knows about users and channels.
 */
export async function notifyTimesheetSubmission(input: {
  tenantId: string;
  submitterEmployeeId: string;
  title: string;
  body: string;
  actionUrl: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const supabase = await createClient();

  const { data: submitter } = await supabase
    .from("employees")
    .select("id, reports_to_employee_id")
    .eq("id", input.submitterEmployeeId)
    .maybeSingle();

  const supervisorEmployeeId = submitter?.reports_to_employee_id ?? null;

  if (supervisorEmployeeId) {
    const { data: superv } = await supabase
      .from("employees")
      .select("id, user_id, is_active")
      .eq("id", supervisorEmployeeId)
      .maybeSingle();

    if (superv?.user_id && superv.is_active !== false) {
      await notifyUser({
        recipient: { userId: superv.user_id, employeeId: superv.id },
        kind: "TIMESHEET_SUBMITTED",
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl,
        payload: input.payload,
        tenantId: input.tenantId,
      });
      return;
    }
    // Supervisor was set but inactive / has no user_id — fall through
    // to the tenant-wide fan-out so the packet doesn't stall silently.
  }

  await notifyRoles({
    tenantId: input.tenantId,
    // Accepts both legacy (PROJECT_MANAGER) and canonical (PM) enum values —
    // notifyRoles forwards to Supabase `.in()` and both live in the DB
    // enum after migration 0021.
    roles: ["PROJECT_MANAGER", "PM", "SUPERVISOR", "TENANT_ADMIN"],
    kind: "TIMESHEET_SUBMITTED",
    title: input.title,
    body: input.body,
    actionUrl: input.actionUrl,
    payload: input.payload,
  });
}
