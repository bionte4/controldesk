import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/types/database";
import type { CalendarEventKind } from "./types";

/**
 * Outbox writer for `project_calendar_events` (rules §7 + §18).
 *
 * Callsite invariant: only invoke when
 *   1. The project row has `sync_calendar = true`, AND
 *   2. The tenant has an active `google_calendar_credentials` row.
 *
 * We check (1) at the callsite because we already have the wizard input in
 * hand. We DO NOT check (2) here — that check happens in the drain cron.
 * Skipping the check at write time means:
 *   - The outbox row lands regardless of whether Google creds exist.
 *   - When a tenant later opts in, historical PENDING rows will drain
 *     naturally (fire-and-forget at rate).
 * The drain cron transitions them to SKIPPED when no active creds are
 * found, so a stale backlog cannot silently pile up.
 */
export type EnqueueProjectEventArgs = {
  tenantId: string;
  projectId: string;
  kind: Extract<
    CalendarEventKind,
    "PROJECT_CREATED" | "PROJECT_UPDATED" | "PROJECT_DELETED"
  >;
  payload?: Record<string, Json>;
};

export type EnqueueMilestoneEventArgs = {
  tenantId: string;
  projectId: string;
  milestoneId: string;
  kind: Extract<
    CalendarEventKind,
    "MILESTONE_CREATED" | "MILESTONE_UPDATED" | "MILESTONE_DELETED"
  >;
  payload?: Record<string, Json>;
};

/**
 * Insert a single PENDING outbox row for a project-scoped event. Throws
 * on database error so the calling server action's compensating-delete
 * path can roll back the project row.
 */
export async function enqueueProjectCalendarEvent(
  supabase: SupabaseClient<Database>,
  args: EnqueueProjectEventArgs,
): Promise<void> {
  const { error } = await supabase.from("project_calendar_events").insert({
    tenant_id: args.tenantId,
    project_id: args.projectId,
    milestone_id: null,
    kind: args.kind,
    status: "PENDING",
    payload: args.payload ?? {},
  });
  if (error) {
    throw new Error(
      `Failed to enqueue calendar event (${args.kind}): ${error.message}`,
    );
  }
}

/**
 * Insert a single PENDING outbox row for a milestone-scoped event.
 * See `enqueueProjectCalendarEvent` for the error-handling contract.
 */
export async function enqueueMilestoneCalendarEvent(
  supabase: SupabaseClient<Database>,
  args: EnqueueMilestoneEventArgs,
): Promise<void> {
  const { error } = await supabase.from("project_calendar_events").insert({
    tenant_id: args.tenantId,
    project_id: args.projectId,
    milestone_id: args.milestoneId,
    kind: args.kind,
    status: "PENDING",
    payload: args.payload ?? {},
  });
  if (error) {
    throw new Error(
      `Failed to enqueue milestone calendar event (${args.kind}): ${error.message}`,
    );
  }
}

/**
 * Batch-enqueue milestone events. Used by the project wizard when many
 * milestones are created atomically — one round-trip instead of N.
 */
export async function enqueueMilestoneCalendarEventsBatch(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  projectId: string,
  milestoneIds: readonly string[],
  kind: Extract<
    CalendarEventKind,
    "MILESTONE_CREATED" | "MILESTONE_UPDATED" | "MILESTONE_DELETED"
  >,
): Promise<void> {
  if (milestoneIds.length === 0) return;
  const rows = milestoneIds.map((milestoneId) => ({
    tenant_id: tenantId,
    project_id: projectId,
    milestone_id: milestoneId,
    kind,
    status: "PENDING" as const,
    payload: {},
  }));
  const { error } = await supabase.from("project_calendar_events").insert(rows);
  if (error) {
    throw new Error(
      `Failed to batch-enqueue ${rows.length} milestone calendar events (${kind}): ${error.message}`,
    );
  }
}
