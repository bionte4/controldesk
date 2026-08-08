"use server";

import { revalidatePath } from "next/cache";

import { withSecureAction } from "@/lib/security/action-wrapper";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  retryEventSchema,
  runReconciliationSchema,
  skipEventSchema,
} from "@/lib/validation/calendar-sync";

/**
 * Server actions for the Google Calendar Sync admin dashboard
 * (rules §17). All mutations go through `withSecureAction` →
 * PDP `calendar_sync/update` (TENANT_ADMIN + GENERAL_MANAGER only)
 * → audit log. Reads happen server-side via `lib/data/calendar-sync`.
 *
 * We use the service-role client for writes because the outbox is
 * locked down to service_role (RLS `no_client_write` policy) — the
 * PDP gate at the wrapper layer is the sole authorization check.
 *
 * Failed rows carry `attempts` + `last_error` context that the ops
 * team needs to keep even after retry, so we NEVER hard-delete —
 * `SKIP` is a soft-close that preserves the audit trail.
 */

const REVALIDATE_PATH = "/settings/integrations/calendar";

/**
 * Retry a single FAILED (or SKIPPED, in case of manual mistake)
 * outbox row. Resets status to PENDING and pulls `scheduled_at`
 * forward to `now()` so the next drain tick picks it up. Does NOT
 * reset `attempts` — the counter tells ops how many times we have
 * already tried, which is diagnostic signal we want to preserve.
 */
export const retryCalendarEventAction = withSecureAction({
  schema: retryEventSchema,
  resource: "calendar_sync",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_calendar_events",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = createServiceRoleClient();

    const { data: prev } = await supabase
      .from("project_calendar_events")
      .select("id, tenant_id, status, attempts, last_error, scheduled_at")
      .eq("id", input.eventId)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();

    if (!prev) throw new Error(`Calendar event not found: ${input.eventId}`);
    if (prev.status !== "FAILED" && prev.status !== "SKIPPED") {
      throw new Error(
        `Cannot retry: current status is ${prev.status}. Only FAILED or SKIPPED rows may be retried.`,
      );
    }

    const scheduledAt = new Date().toISOString();
    const { error } = await supabase
      .from("project_calendar_events")
      .update({
        status: "PENDING",
        scheduled_at: scheduledAt,
        last_error: null,
        updated_at: scheduledAt,
      })
      .eq("id", input.eventId)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    revalidatePath(REVALIDATE_PATH);

    return {
      result: { id: input.eventId, status: "PENDING" as const },
      auditResourceId: input.eventId,
      auditOldValues: {
        status: prev.status,
        attempts: prev.attempts,
        last_error: prev.last_error,
      },
      auditNewValues: {
        status: "PENDING",
        scheduled_at: scheduledAt,
        last_error: null,
      },
    };
  },
});

/**
 * Manually close an outbox row without pushing to Google. Ops uses
 * this when a project was retro-actively opted out of calendar
 * sync, or when a row is stuck in a way that retry cannot fix.
 * The `reason` string is required and lands in `last_error` so it
 * shows up in the same UI column as auto-generated error messages.
 */
export const skipCalendarEventAction = withSecureAction({
  schema: skipEventSchema,
  resource: "calendar_sync",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_calendar_events",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const supabase = createServiceRoleClient();

    const { data: prev } = await supabase
      .from("project_calendar_events")
      .select("id, tenant_id, status, last_error")
      .eq("id", input.eventId)
      .eq("tenant_id", ctx.actor.tenantId)
      .maybeSingle();

    if (!prev) throw new Error(`Calendar event not found: ${input.eventId}`);
    if (prev.status === "SENT") {
      throw new Error(
        "Cannot skip: this row was already successfully synced to Google.",
      );
    }

    const skippedAt = new Date().toISOString();
    const { error } = await supabase
      .from("project_calendar_events")
      .update({
        status: "SKIPPED",
        last_error: `Manually skipped: ${input.reason}`,
        updated_at: skippedAt,
      })
      .eq("id", input.eventId)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    revalidatePath(REVALIDATE_PATH);

    return {
      result: { id: input.eventId, status: "SKIPPED" as const },
      auditResourceId: input.eventId,
      auditOldValues: {
        status: prev.status,
        last_error: prev.last_error,
      },
      auditNewValues: {
        status: "SKIPPED",
        last_error: `Manually skipped: ${input.reason}`,
      },
      auditMetadata: { reason: input.reason },
    };
  },
});

/**
 * Bulk-retry every FAILED row for this tenant. Equivalent to
 * clicking "Retry" on each one, but done as a single SQL UPDATE
 * so we don't fan out N audit rows for a routine ops action.
 *
 * We deliberately do NOT invoke `drainCalendarOutbox` inline here.
 * The cron endpoint runs every 10 minutes and will pick these up.
 * Blocking the request on a live Google Calendar API round-trip
 * risks timeout when a tenant has hundreds of stuck rows; the
 * async drain design is the whole point of using an outbox.
 *
 * Returned `count` lets the toast show "N events queued for retry".
 */
export const runCalendarReconciliationAction = withSecureAction({
  schema: runReconciliationSchema,
  resource: "calendar_sync",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "project_calendar_events",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (_input, ctx) => {
    const supabase = createServiceRoleClient();

    const { data: failedRows } = await supabase
      .from("project_calendar_events")
      .select("id")
      .eq("tenant_id", ctx.actor.tenantId)
      .eq("status", "FAILED");

    const ids = (failedRows ?? []).map((r) => r.id);
    if (ids.length === 0) {
      return {
        result: { count: 0 },
        auditNewValues: { count: 0 },
      };
    }

    const scheduledAt = new Date().toISOString();
    const { error } = await supabase
      .from("project_calendar_events")
      .update({
        status: "PENDING",
        scheduled_at: scheduledAt,
        last_error: null,
        updated_at: scheduledAt,
      })
      .in("id", ids)
      .eq("tenant_id", ctx.actor.tenantId);
    if (error) throw new Error(error.message);

    revalidatePath(REVALIDATE_PATH);

    return {
      result: { count: ids.length },
      auditNewValues: { count: ids.length, scheduled_at: scheduledAt },
      auditMetadata: { affected_ids: ids.slice(0, 50) }, // cap to avoid huge audit rows
    };
  },
});
