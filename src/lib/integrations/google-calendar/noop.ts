import { log } from "@/lib/observability/log";
import type {
  CalendarEventDispatch,
  CalendarPublishResult,
  CalendarPublisher,
  TenantCalendarCredentials,
} from "./types";

/**
 * No-op publisher — used in local dev, tests, and any environment where a
 * real Google integration is not configured. Behaves as if the dispatch
 * succeeded (returns a synthetic googleEventId prefixed with `noop-`) so
 * the drain cron can transition outbox rows to SENT and exercise the
 * whole pipeline without a network call.
 *
 * Logs at INFO so a `dry_run` cron invocation still tells the operator
 * what would have shipped.
 */
export class NoopCalendarPublisher implements CalendarPublisher {
  readonly name = "noop";

  async publish(
    creds: TenantCalendarCredentials,
    dispatch: CalendarEventDispatch,
  ): Promise<CalendarPublishResult> {
    log.info("google-calendar noop publisher", {
      tenant_id: creds.tenantId,
      calendar_id: creds.calendarId,
      event_id: dispatch.eventId,
      kind: dispatch.kind,
      project_number: dispatch.project.number,
      milestone_name: dispatch.milestone?.name ?? null,
    });

    if (
      dispatch.kind === "PROJECT_DELETED" ||
      dispatch.kind === "MILESTONE_DELETED"
    ) {
      return { status: "SENT", googleEventId: null };
    }

    return {
      status: "SENT",
      googleEventId: `noop-${dispatch.eventId.slice(0, 12)}`,
    };
  }
}
