# API reference

Every HTTP surface exposed by ControlDesk that isn't a user-facing
page or Server Action. This page is the contract; the source is
authoritative when in doubt.

## Auth model

- **User routes** — `/api/auth/*`. Cookie-based Supabase session.
- **Health / version** — unauthenticated. Safe for uptime probes.
- **Cron** — `Authorization: Bearer $CRON_SECRET` required.
- **Observability report** — same-origin only + Redis rate limit.

## Health probes

### `GET /api/health`

Docker liveness probe. Always returns `200 { "ok": true }`. Never
touches the DB.

```bash
curl -fsS https://demo.controldesk.app/api/health
# {"ok":true,"time":"2026-08-05T00:00:00.000Z"}
```

### `GET /api/ready`

Readiness probe. Verifies Supabase + Redis reachability. Returns
`503` on any dependency failure — useful behind a load balancer.

```bash
curl -fsS https://demo.controldesk.app/api/ready
# {"ok":true,"checks":{"supabase":"ok","redis":"ok"}}
```

### `GET /api/version`

Deploy identity. Combines `package.json` version + `BUILD_SHA` +
`BUILD_TIME`.

```bash
curl -fsS https://demo.controldesk.app/api/version
# {"version":"0.1.0","sha":"abc1234","time":"2026-08-05T00:00:00Z"}
```

## Auth callback

### `GET /api/auth/callback`

Handles OAuth + magic-link exchange from Supabase Auth. Reads the
short-lived code from the query string, exchanges it for a session
cookie, then redirects to the intended destination (`?next=...`).

**Never call this directly** — it's Supabase-driven.

## Cron endpoints

All cron endpoints:

- Require `Authorization: Bearer $CRON_SECRET`. 401 without.
- Accept `?dry_run=true` to compute + return the plan without
  mutating.
- Write a row to `public.cron_run_log` for each execution — status,
  duration, and payload.

### `POST /api/cron/digest`

**Schedule** — `0 1 * * *` (daily 08:00 WIB).

Sends the HR Admin + Lead Finance daily digest per rules §20:

1. Pending approvals older than 24 h.
2. Petty cash funds mendekati min threshold.
3. SLA breach risks in the next 24-48 h.

Response:

```json
{
  "ok": true,
  "sent": {
    "recipients": 12,
    "emails": 12
  },
  "duration_ms": 842
}
```

### `POST /api/cron/retention`

**Schedule** — `0 20 * * *` (daily 03:00 WIB).

Purges rows past retention (rules §22). Only purges rows for which
a matching ARCHIVED row exists in `public.data_archives`.

Query params:

- `?dry_run=true` — compute the plan without deleting.

Response (dry-run):

```json
{
  "ok": true,
  "plan": {
    "security_audit_logs": { "eligible_rows": 1234, "would_purge": 1234 },
    "email_outbox":        { "eligible_rows": 89, "would_purge": 89 }
  },
  "dry_run": true
}
```

### `POST /api/cron/archive`

**Schedule** — `0 19 * * 0` (weekly Mon 02:00 WIB).

Exports rows past `archive_after_days` into gzipped NDJSON on the
`tenant-archives` bucket. Registers each batch in `public.data_archives`
with a SHA-256 checksum.

Query params:

- `?target=security_audit_logs` — override which table to archive.
  Defaults to iterating through the retention config.
- `?year=2024` — override the archive window.
- `?dry_run=true` — compute the export plan without writing.

Response:

```json
{
  "ok": true,
  "archives": [
    {
      "target": "security_audit_logs",
      "year": 2024,
      "rows": 5238,
      "size_bytes": 431029,
      "checksum_sha256": "abc123...",
      "storage_path": "tenant-archives/00000000-.../security_audit_logs/2024.ndjson.gz"
    }
  ]
}
```

### `POST /api/cron/rotation-check`

**Schedule** — `0 2 * * 1` (weekly Mon 09:00 WIB).

Reads `public.secret_rotation_status()` and dispatches a `SYSTEM`
notification to every ACTIVE `TENANT_ADMIN` for any secret in the
WARN (≤14 d remaining) or OVERDUE bucket.

Query params:

- `?dry_run=true` — compute the notification list without writing.

Response:

```json
{
  "ok": true,
  "warn": 2,
  "overdue": 1,
  "notified_admins": 4
}
```

### `POST /api/cron/ai-insights-sweep`

**Schedule** — `*/15 * * * *` (every 15 minutes).

Sweeps every eligible tenant (`active`/`suspended` status) and
regenerates the four AI insight kinds
(`predict-expense-impact`, `analyze-resource-utilization`,
`analyze-client-health`, `analyze-sla-breach`) when the latest cached
row is older than the freshness window (default 15 minutes). Skips
tenants missing an AI config or whose Redis-backed daily token cap is
exhausted.

Isolation: each tenant is queried with an explicit
`.eq("tenant_id", …)` filter through the service-role client — no
cross-tenant reads.

Response:

```json
{
  "status": "success",
  "started_at": "2026-08-12T00:00:34.153Z",
  "processed": 4,
  "generated": 6,
  "skipped": 10,
  "errors": []
}
```

### `POST /api/cron/issues-sla-sweeper`

**Schedule** — `*/15 * * * *` (every 15 minutes).

Iterates every active (`OPEN|IN_PROGRESS|REOPENED`) issue across all
tenants and climbs the escalation ladder for those past SLA
(rules §26). Ladder: Supervisor → PM → OM → Director. Cooldown between
climbs on the same issue is 15 minutes.

Side effects per breached issue:

1. Update `project_issues.escalation_level`, `.last_escalated_at`, and
   `.assignee_employee_id` (when a matching role exists in
   `project_assignments`, or a tenant-wide Director role for level 3).
2. Insert `SLA_BREACHED` event on first breach + `ESCALATED` event on
   every climb into `project_issue_events`.
3. Enqueue `SLA_BREACH_WARNING` notification to the new assignee, plus
   the reporter on first breach.

Query params:

- `?dry_run=true` — compute decisions only; no updates, events, or
  notifications are written.

Response:

```json
{
  "status": "success",
  "dry_run": false,
  "started_at": "2026-08-06T09:03:34.153Z",
  "cooldown_minutes": 15,
  "outcome": {
    "processed": 3,
    "escalated": 1,
    "breachEventsOnly": 0,
    "skipped": 2,
    "skippedByReason": {
      "not-active": 0,
      "not-breached": 2,
      "cooldown": 0,
      "max-level": 0,
      "invalid-level": 0
    }
  }
}
```

## Observability endpoints

### `POST /api/observability/report`

Client-side crash sink. Called by the browser via
`navigator.sendBeacon()` from the root + segment error boundaries.

- **Same-origin only** — CORS checked against `NEXT_PUBLIC_APP_URL`.
- **Rate limited** — Redis 5 req / 5 min per IP.
- **Redacted** — payload runs through `redactPayload()` before
  dispatch to the configured sink (Sentry / Axiom / Console / NoOp).
- Returns `202` even on invalid payloads to avoid leaking parser
  behaviour to an attacker.

Request shape:

```json
{
  "level": "error",
  "message": "TypeError: Cannot read properties of undefined",
  "stack": "at ...",
  "route": "/finance/cash-advances",
  "request_id": "abc123",
  "user_agent": "Mozilla/5.0 ..."
}
```

## Server Action endpoints (internal)

Every mutation lives at `/[route]` and is called via Next.js Server
Actions — not addressable as REST. Contract documented in
[`security-model.md`](security-model.md) and
[`development.md`](development.md).

The `_action` POST endpoint is Next.js internal — do not call it
directly.

## Response conventions

| Case                 | Status | Body shape                              |
| -------------------- | ------ | --------------------------------------- |
| Success              | 200    | `{ "ok": true, ...payload }`            |
| Unauthenticated      | 401    | `{ "ok": false, "code": "AUTH" }`       |
| Forbidden (cron etc) | 403    | `{ "ok": false, "code": "FORBIDDEN" }`  |
| Rate limited         | 429    | `{ "ok": false, "code": "RATE_LIMITED" }` |
| Validation           | 400    | `{ "ok": false, "code": "VALIDATION", "issues": [...] }` |
| Unavailable          | 503    | `{ "ok": false, "code": "DEPENDENCY_DOWN", "checks": {...} }` |
| Server error         | 500    | `{ "ok": false, "code": "INTERNAL", "request_id": "..." }` |

Every non-2xx response includes an `x-request-id` header so you can
grep the audit + observability logs for the exact request.

## Rate limit budgets

| Endpoint                        | Budget                          |
| ------------------------------- | ------------------------------- |
| `POST /api/observability/report` | 5 req / 5 min / IP             |
| `POST /api/auth/*`              | 5 login attempts / 60 s / IP+email |
| Any `/api/cron/*`               | No app-level limit — CRON_SECRET-bearer only |
| AI generation (Server Actions)  | 10 calls / hour / tenant + daily token cap |

Adjust via `src/lib/security/rate-limit.ts` presets.

## Deprecation policy

Endpoints follow a 90-day sunset. Deprecation is announced in
[`CHANGELOG.md`](../CHANGELOG.md) under `### Deprecated`, and the
endpoint continues to work for 90 calendar days. The `Sunset` header
is set on every response during the deprecation window with the
retirement date.
