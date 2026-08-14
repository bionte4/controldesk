import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * Data access layer for the Google Calendar Sync admin dashboard
 * (rules §17). Reads only — no mutations here.
 *
 * All queries scope to the caller's tenant via RLS
 * (`project_calendar_events_tenant_admin_read` in migration 0039)
 * so no explicit `.eq("tenant_id", ...)` filter is needed for
 * `project_calendar_events`. The credentials table is service-role
 * only, so we route that lookup through a service-role client and
 * scope explicitly.
 */

export type CalendarConnectionStatus =
  | {
      connected: true;
      calendarId: string;
      clientEmail: string | null;
      lastRefreshedAt: string | null;
      lastError: string | null;
    }
  | {
      connected: false;
      /**
       * Distinguishes "publisher not configured at process level"
       * (env vars missing) from "publisher configured but tenant
       * has no active credentials row". The UI copies vary.
       */
      reason: "no_env" | "no_creds" | "inactive";
      inactiveDetail?: { calendarId: string; lastError: string | null };
    };

export type CalendarSyncCounters = {
  sent: number;
  pending: number;
  failed: number;
  skipped: number;
};

export type CalendarSyncStatus = "PENDING" | "SENT" | "FAILED" | "SKIPPED";
export type CalendarSyncKind =
  | "PROJECT_CREATED"
  | "PROJECT_UPDATED"
  | "PROJECT_DELETED"
  | "MILESTONE_CREATED"
  | "MILESTONE_UPDATED"
  | "MILESTONE_DELETED";

export type CalendarSyncEvent = {
  id: string;
  kind: CalendarSyncKind;
  status: CalendarSyncStatus;
  attempts: number;
  googleEventId: string | null;
  lastError: string | null;
  scheduledAt: string;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  project: {
    id: string;
    name: string;
    projectNumber: string | null;
    startDate: string | null;
    endDate: string | null;
  } | null;
  milestone: {
    id: string;
    name: string;
    dueDate: string | null;
  } | null;
};

/**
 * Resolve the calendar connection state for the current tenant.
 *
 * Order of precedence:
 *   1. Env vars missing → `no_env`. Publisher is in noop mode across
 *      the whole process, so even a valid creds row would go nowhere.
 *   2. No credentials row → `no_creds`. Tenant needs to run the
 *      OAuth flow (or ops needs to seed the row).
 *   3. Row exists but `is_active = false` → `inactive`. Usually a
 *      failed refresh disabled it — surface `last_error` in the UI.
 *   4. Row exists and active → `connected`.
 *
 * The refresh token itself is NEVER read here — this endpoint only
 * exposes metadata. Decryption stays in the drain worker via the
 * SECURITY DEFINER RPC.
 */
export const getCalendarConnectionStatus = cache(
  async (tenantId: string): Promise<CalendarConnectionStatus> => {
    const envReady = Boolean(
      process.env.GOOGLE_CALENDAR_CLIENT_ID &&
        process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    );
    if (!envReady) return { connected: false, reason: "no_env" };

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("google_calendar_credentials")
      .select("calendar_id, client_email, is_active, last_refreshed_at, last_error")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error || !data) return { connected: false, reason: "no_creds" };

    if (!data.is_active) {
      return {
        connected: false,
        reason: "inactive",
        inactiveDetail: {
          calendarId: data.calendar_id,
          lastError: data.last_error,
        },
      };
    }

    return {
      connected: true,
      calendarId: data.calendar_id,
      clientEmail: data.client_email,
      lastRefreshedAt: data.last_refreshed_at,
      lastError: data.last_error,
    };
  },
);

/**
 * Aggregate counts for the 4 KPI cards. Uses one round-trip per
 * status because Supabase's PostgREST does not expose `GROUP BY`
 * directly — with only 4 statuses this is a fair trade-off for
 * simplicity. If the outbox grows past 10⁶ rows we can promote
 * this to a materialized view or a SECURITY DEFINER RPC.
 */
export const getCalendarSyncCounters = cache(
  async (): Promise<CalendarSyncCounters> => {
    const supabase = await createClient();
    const statuses: CalendarSyncStatus[] = [
      "SENT",
      "PENDING",
      "FAILED",
      "SKIPPED",
    ];
    const results = await Promise.all(
      statuses.map((s) =>
        supabase
          .from("project_calendar_events")
          .select("id", { count: "exact", head: true })
          .eq("status", s),
      ),
    );
    return {
      sent: results[0].count ?? 0,
      pending: results[1].count ?? 0,
      failed: results[2].count ?? 0,
      skipped: results[3].count ?? 0,
    };
  },
);

/**
 * List outbox rows with joined project + milestone context, most
 * recent first. Optional status filter narrows to one bucket for
 * the sync-map table. RLS already scopes to the caller's tenant.
 */
export async function listCalendarSyncEvents(input: {
  status?: CalendarSyncStatus;
  limit?: number;
}): Promise<CalendarSyncEvent[]> {
  const supabase = await createClient();
  const limit = input.limit ?? 100;

  let query = supabase
    .from("project_calendar_events")
    .select(
      `id, kind, status, attempts, google_event_id, last_error,
       scheduled_at, sent_at, created_at, updated_at,
       project:projects(id, name, project_number, start_date, end_date),
       milestone:project_milestones(id, name, planned_end_date)`,
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (input.status) query = query.eq("status", input.status);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list calendar sync events: ${error.message}`);
  }

  type Row = {
    id: string;
    kind: CalendarSyncKind;
    status: CalendarSyncStatus;
    attempts: number;
    google_event_id: string | null;
    last_error: string | null;
    scheduled_at: string;
    sent_at: string | null;
    created_at: string;
    updated_at: string;
    project: {
      id: string;
      name: string;
      project_number: string | null;
      start_date: string | null;
      end_date: string | null;
    } | null;
    milestone: {
      id: string;
      name: string;
      // Milestones use `planned_end_date` (GAS-aligned schema per migration
      // 0022). We surface it to the UI as `dueDate` because from the
      // calendar's perspective it IS the target due date for that
      // milestone. If the schema ever adds a distinct `due_date` column
      // we should update both sides.
      planned_end_date: string | null;
    } | null;
  };

  return (data as unknown as Row[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    attempts: r.attempts,
    googleEventId: r.google_event_id,
    lastError: r.last_error,
    scheduledAt: r.scheduled_at,
    sentAt: r.sent_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    project: r.project
      ? {
          id: r.project.id,
          name: r.project.name,
          projectNumber: r.project.project_number,
          startDate: r.project.start_date,
          endDate: r.project.end_date,
        }
      : null,
    milestone: r.milestone
      ? {
          id: r.milestone.id,
          name: r.milestone.name,
          dueDate: r.milestone.planned_end_date,
        }
      : null,
  }));
}

/**
 * Timestamp of the most recent SENT row — feeds "Last sync: …"
 * subtitle in the header. Returns `null` when the outbox is
 * empty or nothing has ever synced successfully.
 */
export const getLastSyncTimestamp = cache(
  async (): Promise<string | null> => {
    const supabase = await createClient();
    const { data } = await supabase
      .from("project_calendar_events")
      .select("sent_at")
      .eq("status", "SENT")
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.sent_at as string | null) ?? null;
  },
);
