/**
 * Google Calendar publisher — shared types (rules §7 + §18).
 *
 * The internal event vocabulary is deliberately narrower than the Google
 * Calendar API. Our outbox writes a small set of shapes; the concrete
 * publisher translates each shape into `events.insert / .patch / .delete`
 * calls. This keeps the callsite (server actions) decoupled from Google's
 * API surface and lets us swap in mocks / no-ops in tests.
 */

export type CalendarEventKind =
  | "PROJECT_CREATED"
  | "PROJECT_UPDATED"
  | "PROJECT_DELETED"
  | "MILESTONE_CREATED"
  | "MILESTONE_UPDATED"
  | "MILESTONE_DELETED";

/**
 * Fully-resolved event payload dispatched to a publisher. The outbox row's
 * `payload` column is the source of truth; the drain cron hydrates any
 * missing project / milestone fields from the current DB state before
 * calling into the publisher, so the publisher itself never touches
 * Postgres.
 */
export type CalendarEventDispatch = {
  tenantId: string;
  eventId: string;
  kind: CalendarEventKind;
  /** Google `events.insert` uses the calendar_id from tenant credentials. */
  calendarId: string;
  /**
   * Present only when `kind` is a `*_UPDATED` or `*_DELETED` — points to
   * the Google-side event we previously created. New rows leave this null.
   */
  googleEventId: string | null;
  project: {
    id: string;
    number: string;
    name: string;
    description: string | null;
    startDate: string | null; // ISO date, YYYY-MM-DD
    endDate: string | null;
    location: string | null;
  };
  milestone: {
    id: string;
    name: string;
    dueDate: string | null;
  } | null;
};

/**
 * Outcome of publishing a single event. `googleEventId` is set on
 * successful `insert`, echoed back on `patch`, and cleared on `delete`.
 * Transport errors surface via `status: "FAILED"` + `error`; the drain
 * cron applies exponential backoff on the outbox row using `attempts`.
 */
export type CalendarPublishResult =
  | { status: "SENT"; googleEventId: string | null }
  | { status: "SKIPPED"; reason: string }
  | { status: "FAILED"; error: string; retryable: boolean };

/**
 * Tenant credentials handed to the publisher by the drain cron. The
 * refresh token is already decrypted at this point (via the SECURITY
 * DEFINER RPC `get_google_credential_refresh_token`) so the publisher
 * itself does not need direct Postgres access.
 */
export type TenantCalendarCredentials = {
  tenantId: string;
  calendarId: string;
  clientEmail: string | null;
  refreshToken: string;
};

export interface CalendarPublisher {
  /** Human-readable name for logs + observability. */
  readonly name: string;
  publish(
    creds: TenantCalendarCredentials,
    dispatch: CalendarEventDispatch,
  ): Promise<CalendarPublishResult>;
}
