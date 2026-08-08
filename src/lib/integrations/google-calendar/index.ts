import "server-only";

import { log } from "@/lib/observability/log";
import { GoogleCalendarPublisher } from "./google";
import { NoopCalendarPublisher } from "./noop";
import type { CalendarPublisher } from "./types";

export type {
  CalendarEventDispatch,
  CalendarEventKind,
  CalendarPublishResult,
  CalendarPublisher,
  TenantCalendarCredentials,
} from "./types";

// Test-injection hook mirrors the mailer's `__setTransporterForTests`.
let overridePublisher: CalendarPublisher | null = null;

export function __setCalendarPublisherForTests(p: CalendarPublisher | null): void {
  overridePublisher = p;
}

let cached: CalendarPublisher | null = null;

/**
 * Resolve the active publisher for this process.
 *
 * Selection rules:
 *   1. Test injection wins (`__setCalendarPublisherForTests`).
 *   2. If `GOOGLE_CALENDAR_CLIENT_ID` + `GOOGLE_CALENDAR_CLIENT_SECRET`
 *      are set → real Google publisher.
 *   3. Otherwise → NoopPublisher (dev, CI, and any deployment that hasn't
 *      opted-in to Calendar yet). Emits an INFO log the first time so
 *      operators know why events are not landing in Google.
 */
export function getCalendarPublisher(): CalendarPublisher {
  if (overridePublisher) return overridePublisher;
  if (cached) return cached;

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;

  if (clientId && clientSecret) {
    cached = new GoogleCalendarPublisher({ clientId, clientSecret });
    log.info("google-calendar publisher: using real Google client");
  } else {
    cached = new NoopCalendarPublisher();
    log.info(
      "google-calendar publisher: GOOGLE_CALENDAR_CLIENT_ID/_SECRET missing — using no-op",
    );
  }

  return cached;
}
