import "server-only";

import { log } from "@/lib/observability/log";
import type {
  CalendarEventDispatch,
  CalendarPublishResult,
  CalendarPublisher,
  TenantCalendarCredentials,
} from "./types";

/**
 * Real Google Calendar publisher (rules §7 + §18).
 *
 * Auth model:
 *   * OAuth 2.0 Web Server flow — each tenant has a stored refresh_token
 *     (`google_calendar_credentials.encrypted_refresh_token`) obtained
 *     during a one-time consent flow (`/api/integrations/google/callback`,
 *     wired separately).
 *   * At publish time we exchange the refresh_token for a short-lived
 *     access token in-process; no client secret leaves this file.
 *
 * We dynamic-import `googleapis` so the dependency stays optional at
 * install time. When `GOOGLE_CALENDAR_CLIENT_ID` / `_SECRET` are unset,
 * the factory in `./index.ts` returns the NoopPublisher instead.
 *
 * Event mapping (event.summary / description / start / end):
 *   - PROJECT_* → all-day event spanning `startDate..endDate`. If either
 *     date is null we fall back to the other; if both are null we SKIP.
 *   - MILESTONE_* → single-day event on `milestone.dueDate`. If null we
 *     SKIP with reason.
 */
export class GoogleCalendarPublisher implements CalendarPublisher {
  readonly name = "google";

  constructor(
    private readonly config: {
      clientId: string;
      clientSecret: string;
      /** Optional override for the OAuth endpoint (used in tests). */
      tokenUri?: string;
    },
  ) {}

  async publish(
    creds: TenantCalendarCredentials,
    dispatch: CalendarEventDispatch,
  ): Promise<CalendarPublishResult> {
    // Dynamic import so `googleapis` stays an optional peer dep. When the
    // package is not installed (dev images, minimal CI) we downgrade
    // publishing to SKIPPED rather than failing the drain — the drain
    // cron treats SKIPPED as a terminal state.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let googleapis: any;
    try {
      googleapis = await import(/* webpackIgnore: true */ "googleapis" as string);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("googleapis import failed — falling back to SKIPPED", { error: msg });
      return {
        status: "SKIPPED",
        reason: `googleapis package unavailable: ${msg}`,
      };
    }
    const google = googleapis.google;

    const oauth2 = new google.auth.OAuth2(
      this.config.clientId,
      this.config.clientSecret,
    );
    oauth2.setCredentials({ refresh_token: creds.refreshToken });

    const calendar = google.calendar({ version: "v3", auth: oauth2 });
    const evt = buildGoogleEvent(dispatch);

    if (evt === "skip-no-date") {
      return {
        status: "SKIPPED",
        reason: "Event has neither a project start/end date nor a milestone due date",
      };
    }

    try {
      switch (dispatch.kind) {
        case "PROJECT_CREATED":
        case "MILESTONE_CREATED": {
          const res = await calendar.events.insert({
            calendarId: creds.calendarId,
            requestBody: evt,
          });
          return {
            status: "SENT",
            googleEventId: res.data.id ?? null,
          };
        }

        case "PROJECT_UPDATED":
        case "MILESTONE_UPDATED": {
          if (!dispatch.googleEventId) {
            // No previous insert — treat as create so we don't drop the event.
            const res = await calendar.events.insert({
              calendarId: creds.calendarId,
              requestBody: evt,
            });
            return {
              status: "SENT",
              googleEventId: res.data.id ?? null,
            };
          }
          const res = await calendar.events.patch({
            calendarId: creds.calendarId,
            eventId: dispatch.googleEventId,
            requestBody: evt,
          });
          return {
            status: "SENT",
            googleEventId: res.data.id ?? dispatch.googleEventId,
          };
        }

        case "PROJECT_DELETED":
        case "MILESTONE_DELETED": {
          if (!dispatch.googleEventId) {
            return { status: "SKIPPED", reason: "No googleEventId to delete" };
          }
          await calendar.events.delete({
            calendarId: creds.calendarId,
            eventId: dispatch.googleEventId,
          });
          return { status: "SENT", googleEventId: null };
        }
      }
    } catch (err) {
      // googleapis errors expose an HTTP `code` we can use to classify
      // retryability. 4xx (except 429) = permanent, 5xx / 429 = retry.
      const code = extractHttpCode(err);
      const message = err instanceof Error ? err.message : String(err);
      const retryable =
        code === 429 || code === null || (code >= 500 && code < 600);
      log.warn("google-calendar publish failed", {
        tenant_id: creds.tenantId,
        event_id: dispatch.eventId,
        kind: dispatch.kind,
        code,
        retryable,
        error: message,
      });
      return { status: "FAILED", error: message, retryable };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MinimalGoogleEvent = {
  summary: string;
  description: string;
  location?: string;
  start: { date: string };
  end: { date: string };
  extendedProperties: {
    private: {
      controldesk_tenant_id: string;
      controldesk_project_id: string;
      controldesk_milestone_id?: string;
      controldesk_kind: string;
    };
  };
};

/**
 * Build a Google Calendar `event` resource from our dispatch payload.
 * Returns the sentinel string `"skip-no-date"` when the event lacks a
 * date to anchor on, so the caller can turn it into SKIPPED instead of
 * failing.
 */
function buildGoogleEvent(
  d: CalendarEventDispatch,
): MinimalGoogleEvent | "skip-no-date" {
  const isMilestone =
    d.kind === "MILESTONE_CREATED" ||
    d.kind === "MILESTONE_UPDATED" ||
    d.kind === "MILESTONE_DELETED";

  if (isMilestone) {
    const date = d.milestone?.dueDate;
    if (!date) return "skip-no-date";
    return {
      summary: `[Milestone] ${d.project.number} — ${d.milestone?.name ?? ""}`,
      description: buildDescription(d),
      location: d.project.location ?? undefined,
      start: { date },
      end: { date: addOneDayIso(date) }, // Google all-day events use exclusive end
      extendedProperties: {
        private: {
          controldesk_tenant_id: d.tenantId,
          controldesk_project_id: d.project.id,
          controldesk_milestone_id: d.milestone!.id,
          controldesk_kind: d.kind,
        },
      },
    };
  }

  const start = d.project.startDate;
  const end = d.project.endDate;
  const anchor = start ?? end;
  if (!anchor) return "skip-no-date";

  return {
    summary: `[Project] ${d.project.number} — ${d.project.name}`,
    description: buildDescription(d),
    location: d.project.location ?? undefined,
    start: { date: anchor },
    end: { date: end ? addOneDayIso(end) : addOneDayIso(anchor) },
    extendedProperties: {
      private: {
        controldesk_tenant_id: d.tenantId,
        controldesk_project_id: d.project.id,
        controldesk_kind: d.kind,
      },
    },
  };
}

function buildDescription(d: CalendarEventDispatch): string {
  const lines = [
    `ControlDesk project: ${d.project.number}`,
    d.project.description ? `\n${d.project.description}` : "",
    "\n--",
    "Sync source: ControlDesk (do not edit — changes will be overwritten).",
  ];
  return lines.filter(Boolean).join("\n");
}

function addOneDayIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function extractHttpCode(err: unknown): number | null {
  if (err && typeof err === "object") {
    const anyErr = err as { code?: number | string; response?: { status?: number } };
    if (typeof anyErr.code === "number") return anyErr.code;
    if (typeof anyErr.code === "string" && /^\d+$/.test(anyErr.code)) {
      return Number(anyErr.code);
    }
    if (typeof anyErr.response?.status === "number") {
      return anyErr.response.status;
    }
  }
  return null;
}

// Exposed for tests only.
export const __internals = { buildGoogleEvent, addOneDayIso, extractHttpCode };
