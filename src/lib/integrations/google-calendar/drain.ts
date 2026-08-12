import type { SupabaseClient } from "@supabase/supabase-js";

import { log } from "@/lib/observability/log";
import { decryptToken } from "@/lib/security/token-crypto";
import type { Database } from "@/types/database";
import type {
  CalendarEventDispatch,
  CalendarPublisher,
  TenantCalendarCredentials,
} from "./types";

/**
 * Drain the `project_calendar_events` outbox (rules §7 + §18).
 *
 * Kept as a pure function so it can be unit-tested with an in-memory
 * Supabase-shaped adapter (see `drain.test.ts`). The HTTP route in
 * `/api/cron/google-calendar-drain` only handles auth + cron_run_log
 * bookkeeping and delegates the actual work here.
 */

export type DrainOptions = {
  supabase: SupabaseClient<Database>;
  publisher: CalendarPublisher;
  dryRun: boolean;
  startedAt: Date;
  batchSize: number;
};

export type DrainResult = {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
};

/**
 * Backoff schedule for FAILED rows: 2^attempts minutes, capped at 6 hours.
 * Sits under `scheduled_at` on the outbox row — the SELECT below only
 * picks rows whose scheduled_at has passed.
 */
function backoffMinutes(attempts: number): number {
  return Math.min(2 ** attempts, 360);
}

type OutboxRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  milestone_id: string | null;
  kind: Database["public"]["Enums"]["calendar_event_kind"];
  status: Database["public"]["Enums"]["calendar_event_status"];
  attempts: number;
  google_event_id: string | null;
  payload: unknown;
};

type ProjectRow = {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  project_number: string | null;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  sync_calendar: boolean;
};

type MilestoneRow = {
  id: string;
  project_id: string;
  name: string;
  planned_end_date: string | null;
};

type CredentialRow = {
  tenant_id: string;
  encrypted_refresh_token: string;
  calendar_id: string;
  client_email: string | null;
  is_active: boolean;
};

export async function drainCalendarOutbox(
  opts: DrainOptions,
): Promise<DrainResult> {
  const { supabase, publisher, dryRun, startedAt, batchSize } = opts;

  // 1. Grab candidate rows (PENDING + FAILED whose scheduled_at is in the past).
  const { data: rows, error: rowsErr } = await supabase
    .from("project_calendar_events")
    .select(
      "id, tenant_id, project_id, milestone_id, kind, status, attempts, google_event_id, payload",
    )
    .in("status", ["PENDING", "FAILED"])
    .lte("scheduled_at", startedAt.toISOString())
    .order("created_at", { ascending: true })
    .limit(batchSize);
  if (rowsErr) throw new Error(`Outbox select failed: ${rowsErr.message}`);

  const candidates = (rows ?? []) as OutboxRow[];
  const result: DrainResult = {
    total: candidates.length,
    sent: 0,
    failed: 0,
    skipped: 0,
  };
  if (candidates.length === 0) return result;

  // 2. Hydrate project + milestone state in one round-trip per relation.
  const projectIds = Array.from(new Set(candidates.map((r) => r.project_id)));
  const milestoneIds = Array.from(
    new Set(
      candidates
        .map((r) => r.milestone_id)
        .filter((id): id is string => !!id),
    ),
  );

  const { data: projectRows, error: projErr } = await supabase
    .from("projects")
    .select(
      "id, tenant_id, name, code, project_number, description, start_date, end_date, location, sync_calendar",
    )
    .in("id", projectIds);
  if (projErr) throw new Error(`Project hydration failed: ${projErr.message}`);
  const projectsById = new Map<string, ProjectRow>();
  for (const p of (projectRows ?? []) as ProjectRow[]) {
    projectsById.set(p.id, p);
  }

  const milestonesById = new Map<string, MilestoneRow>();
  if (milestoneIds.length > 0) {
    const { data: milestoneRows, error: msErr } = await supabase
      .from("project_milestones")
      .select("id, project_id, name, planned_end_date")
      .in("id", milestoneIds);
    if (msErr) throw new Error(`Milestone hydration failed: ${msErr.message}`);
    for (const m of (milestoneRows ?? []) as MilestoneRow[]) {
      milestonesById.set(m.id, m);
    }
  }

  // 3. Pre-load tenant credentials. Decryption happens Node-side using
  //    the `token-crypto` AES-GCM helper (rules §3): we already have
  //    APP_ENCRYPTION_KEY in the runtime, so a Postgres pgcrypto round-
  //    trip would add a round-trip without hiding the key.
  //
  //    Skipping tenants without active creds lets rows land quickly in
  //    SKIPPED (not FAILED) — a distinction the ops dashboard cares about.
  const tenantIds = Array.from(new Set(candidates.map((r) => r.tenant_id)));
  const credsByTenant = new Map<string, TenantCalendarCredentials>();
  const { data: credRows, error: credErr } = await supabase
    .from("google_calendar_credentials")
    .select(
      "tenant_id, encrypted_refresh_token, calendar_id, client_email, is_active",
    )
    .in("tenant_id", tenantIds)
    .eq("is_active", true);
  if (credErr) {
    log.warn("google-calendar-drain: credential lookup failed", {
      error: credErr.message,
    });
  }
  for (const row of ((credRows ?? []) as CredentialRow[])) {
    try {
      const refreshToken = decryptToken(row.encrypted_refresh_token);
      credsByTenant.set(row.tenant_id, {
        tenantId: row.tenant_id,
        calendarId: row.calendar_id,
        clientEmail: row.client_email,
        refreshToken,
      });
    } catch (err) {
      log.warn("google-calendar-drain: refresh_token decrypt failed", {
        tenant_id: row.tenant_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4. Dispatch each row.
  for (const row of candidates) {
    const project = projectsById.get(row.project_id);
    if (!project) {
      await markSkipped(supabase, row.id, "Project no longer exists", dryRun);
      result.skipped += 1;
      continue;
    }

    // Sanity: if the project has `sync_calendar = false` (owner opted out
    // between enqueue and drain), skip so we don't publish stale state.
    if (!project.sync_calendar) {
      await markSkipped(
        supabase,
        row.id,
        "sync_calendar=false on hydrated project",
        dryRun,
      );
      result.skipped += 1;
      continue;
    }

    const creds = credsByTenant.get(row.tenant_id);
    if (!creds) {
      await markSkipped(
        supabase,
        row.id,
        "No active google_calendar_credentials for tenant",
        dryRun,
      );
      result.skipped += 1;
      continue;
    }

    const milestone = row.milestone_id
      ? milestonesById.get(row.milestone_id)
      : null;
    if (row.milestone_id && !milestone) {
      await markSkipped(supabase, row.id, "Milestone no longer exists", dryRun);
      result.skipped += 1;
      continue;
    }

    const dispatch: CalendarEventDispatch = {
      tenantId: row.tenant_id,
      eventId: row.id,
      kind: row.kind,
      calendarId: creds.calendarId,
      googleEventId: row.google_event_id,
      project: {
        id: project.id,
        number: project.project_number ?? project.code,
        name: project.name,
        description: project.description,
        startDate: project.start_date,
        endDate: project.end_date,
        location: project.location,
      },
      milestone: milestone
        ? {
            id: milestone.id,
            name: milestone.name,
            dueDate: milestone.planned_end_date,
          }
        : null,
    };

    if (dryRun) {
      log.info("google-calendar-drain dry_run — would publish", {
        event_id: row.id,
        kind: row.kind,
        publisher: publisher.name,
      });
      result.sent += 1;
      continue;
    }

    let publishResult;
    try {
      publishResult = await publisher.publish(creds, dispatch);
    } catch (err) {
      publishResult = {
        status: "FAILED" as const,
        error: err instanceof Error ? err.message : String(err),
        retryable: true,
      };
    }

    if (publishResult.status === "SENT") {
      await supabase
        .from("project_calendar_events")
        .update({
          status: "SENT",
          sent_at: new Date().toISOString(),
          google_event_id: publishResult.googleEventId,
          last_error: null,
          attempts: row.attempts + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      result.sent += 1;
    } else if (publishResult.status === "SKIPPED") {
      await markSkipped(supabase, row.id, publishResult.reason, false);
      result.skipped += 1;
    } else {
      const nextAttempts = row.attempts + 1;
      const backoff = backoffMinutes(nextAttempts);
      const scheduledAt = new Date(startedAt.getTime() + backoff * 60_000);
      await supabase
        .from("project_calendar_events")
        .update({
          status: publishResult.retryable ? "FAILED" : "SKIPPED",
          last_error: publishResult.error.slice(0, 500),
          attempts: nextAttempts,
          scheduled_at: scheduledAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (publishResult.retryable) {
        result.failed += 1;
      } else {
        result.skipped += 1;
      }
    }
  }

  return result;
}

async function markSkipped(
  supabase: SupabaseClient<Database>,
  id: string,
  reason: string,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  await supabase
    .from("project_calendar_events")
    .update({
      status: "SKIPPED",
      last_error: reason.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

// Exposed for unit tests.
export const __internals = { backoffMinutes };
