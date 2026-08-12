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

### `POST /api/cron/approval-idle-nudge`

**Schedule** — `0 * * * *` (hourly, on the hour).

Bridges the gap between "just submitted" and the once-daily digest.
For every active tenant, counts pending items (`project_expenses`,
`cash_advances`, `hr_requests` with `status LIKE 'PENDING_%'`) whose
`created_at < now() - 24h`. If the total is non-zero, every ACTIVE
employee with an approver role (SUPERVISOR / PROJECT_MANAGER /
OPERATIONS_MANAGER / LEAD_FINANCE / GENERAL_MANAGER / TENANT_ADMIN
plus canonical aliases) receives at most one `APPROVAL_IDLE_24H`
in-app notification per UTC day.

Deduplication key: `(user_id, kind='APPROVAL_IDLE_24H', created_at
same UTC day)`. Users can silence the APPROVALS category in
Preferences to opt out entirely.

Query params:

- `?dry_run=true` — count only, no `notifications` INSERT.

Response:

```json
{
  "status": "success",
  "dry_run": false,
  "started_at": "2026-08-12T00:00:00.000Z",
  "stats": {
    "tenants_processed": 3,
    "tenants_skipped_no_idle": 12,
    "notified": 5,
    "skipped_already_nudged_today": 8
  }
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

## Help center endpoints

### `POST /api/help/ask`

Streaming chatbot backend for the "Ask ControlDesk" tab at `/help`.
Supports Level 1 (docs-only RAG) by default AND Level 2 ("Ask my
data" — read-only tool calling) when the client opts in.
Implementation: `src/app/api/help/ask/route.ts`. Full design:
[docs/rfc/0001-ask-my-data.md](rfc/0001-ask-my-data.md).

- **Auth** — requires an authenticated employee. Tenant scope is
  derived from `requireCurrentEmployee()` (never trusts request body).
- **Rate limit** — two Redis buckets: 6 messages/min per user
  (`helpChatPerUser`) + 60 messages/min per tenant
  (`helpChatPerTenant`). 429 with `Retry-After` header on breach.
- **Token cap** — `reserve(ESTIMATED_OUTPUT_TOKENS)` against the
  tenant's daily AI budget BEFORE contacting the provider (rules §15).
  Returns 402 with the current used/cap on overshoot; refunds the
  reservation on provider failure.
- **Body** — `{ messages, conversationId?, useTools? }`. `messages`
  is 1–20 items of `{ role, content }`, each content ≤ 8000 chars.
  Passing `conversationId` (uuid) + `useTools: true` opts into
  Level 2; otherwise the route runs Level 1 unchanged.
- **Response** — `text/plain; charset=utf-8` stream. Consume with
  `res.body.getReader()`.

Level 2 additions (only when `conversationId` + `useTools` are set):

- **History persisted** to `tenant_chat_messages` (RLS: owner-only,
  tenant-scoped, see migration 0085). Each user turn is written
  immediately; the assistant reply + `tool_calls` trace + retrieval
  slugs are written at `onFinish`.
- **Tool registry** (`src/lib/ai/tools/index.ts`) exposes 8 read-only
  tools bound to the caller: `list_pending_approvals`, `my_projects`,
  `expense_summary_this_month`, `my_timesheet_this_week`,
  `my_direct_reports`, `pending_timesheets_to_approve`,
  `project_status(project_id)`, `budget_remaining(project_id)`.
  Every user/tenant filter comes from the session; model-supplied
  arguments cannot override. Tools that take a `project_id` verify
  the caller is on that project before reading it (ADMIN, DIRECTOR
  and FINANCE roles may open any project in the tenant); tools that
  return budget data additionally check `canViewBudget(dbRole)` and
  return `{ error: "forbidden" }` without touching the DB for
  Employee/Supervisor.
- **Bounded tool loop** — `stopWhen: stepCountIs(4)` caps the model
  to at most 4 tool-call steps per turn. Combined with the 400-token
  reservation, the request cost is deterministic per invocation.

Error responses:

| Status | Meaning                                                                       |
| ------ | ----------------------------------------------------------------------------- |
| 400    | `invalid_body` — Zod schema failed OR no user message in `messages`.          |
| 402    | `daily_ai_budget_exceeded` — tenant token cap reached today.                  |
| 429    | `rate_limited` — per-user or per-tenant window exceeded.                      |
| 500    | `tenant_lookup_failed` — defensive; the session's tenant_id can't be resolved.|
| 502    | `llm_failed` — provider returned an error mid-stream.                         |
| 503    | `ai_not_configured` — tenant has no active AI config; admin must set one.     |

Isolation guarantees:

- The tenant name that lands in the system prompt is loaded via
  `.eq("id", tenantId)` where `tenantId` comes from the session.
- Retrieval reads `docs/`-derived static content only — no tenant DB
  reads, so nothing to leak across tenants.
- Telemetry via `log.info("help_chat_reply", …)` — never persists user
  content, only slug hits, latency, and token counts.

### `GET /api/help/conversations`

Lists the caller's own recent chatbot conversations for the "Ask AI"
sidebar. Implementation: `src/app/api/help/conversations/route.ts`.

- **Auth** — `requireCurrentEmployee()`.
- **RLS** — `tenant_chat_conversations_tenant_read` (migration 0085)
  enforces `tenant_id = current_tenant_id() AND user_id = auth.uid()`.
  Tenant admins cannot read colleagues' chats.
- **Response** — `{ conversations: [{ id, title, updated_at,
  message_count }] }`. Max 10 rows, sorted by `updated_at desc`.
  `message_count` counts only `user` + `assistant` roles; `tool`
  traces are internal.

### `GET /api/help/conversations/{id}`

Hydrates one thread's messages so the client sidebar can resume it.

- **Auth + RLS** — same as list.
- **Path** — `{id}` must be a UUID. Non-UUID returns 400
  `invalid_id`; unknown UUID (either non-existent or owned by another
  user) returns 404 `not_found` — no existence oracle between users.
- **Response** — `{ id, title, messages: [{ id, role, content,
  created_at }] }` sorted by `created_at asc`. `tool` role rows are
  filtered out.

### `DELETE /api/help/conversations/{id}`

Hard-deletes a thread and cascades to its messages.

- **Auth + RLS** — same as above.
- **Response** — `{ ok: true }` on success. 500 `delete_failed` when
  the RLS-guarded delete errors; the row is silently untouched if the
  policy denies (no existence oracle).
- Telemetry — `log.info("help_conversation_deleted", …)`.

### `POST /api/ai/copilot`

Streaming per-field inline AI copilot (Level 3). Implementation:
`src/app/api/ai/copilot/route.ts`.

- **Auth** — requires an authenticated employee. Tenant scope from
  session (never body).
- **Rate limit** — 12/min per user (`aiCopilotPerUser`) + 120/min
  per tenant (`aiCopilotPerTenant`).
- **Token cap** — reserves `surface.maxOutputTokens` (≤ 240 today)
  against the tenant's daily budget before hitting the LLM.
- **Body** — `{ surface, input, context }` per
  `copilotRequestSchema` in `src/lib/ai/copilot-surfaces.ts`.
- **Response** — `text/plain; charset=utf-8` stream.

Surface allowlist (see `COPILOT_SURFACES`):

| Surface | Wired form field | Whitelisted context keys |
| --- | --- | --- |
| `ca_purpose` | CA General → `purpose` | `amount`, `project_name`, `expected_settlement_date` |
| `field_ops_justification` | CA FieldOps → `justification` | `project_name`, `area`, `tujuan`, `ticket_number`, `transport_need`, `pic_name` |
| `expense_description` | Project Expense → `notes` | `amount`, `project_name`, `vendor`, `category` |
| `project_description` | Project wizard → `description` | `project_name`, `client_name`, `start_date`, `end_date`, `contract_value` |

Any context key **not** in the whitelist for the requested surface is
silently dropped BEFORE the prompt is built. This makes it safe for
the client to pass any form values as context — the server enforces
the allowlist, not the caller.

Isolation guarantees:

- Same tenant-lookup pattern as `/api/help/ask` (session `.eq`).
- No DB reads for user data — client passes context values it
  already displays; nothing is fetched cross-form.
- Telemetry via `log.info("ai_copilot_reply", …)` — never persists
  user content, only surface, tokens, latency, and context key names.

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
