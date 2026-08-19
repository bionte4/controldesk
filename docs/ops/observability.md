# Observability — Ops Runbook

Related rules: §21 (structured logs, health, testing), §22 (secret rotation).

ControlDesk emits observability signals via three tightly-coupled pieces:

| Piece | Where | Purpose |
| --- | --- | --- |
| `src/lib/observability/log.ts` | Server (RSC + Server Actions + API) | JSON lines to stdout/stderr for log collectors; auto-forwards `warn`/`error`/`fatal` to the sink. |
| `src/lib/observability/sink.ts` | Server | Pluggable adapter — Sentry, Axiom, Console, or NoOp. |
| `/api/observability/report` + `client-report.ts` | Browser | Client crashes POST to this endpoint; server forwards to the same sink. |

## Configure a provider

Pick one in `.env.local` (production) or your platform secrets store.

### Sentry

```env
SENTRY_DSN="https://<public-key>@o0.ingest.sentry.io/<project-id>"
```

The DSN is enough — we build the envelope URL and auth header ourselves.
No source-map upload plugin required.

### Axiom

```env
AXIOM_TOKEN="xaat-..."
AXIOM_DATASET="controldesk-prod"
```

The token needs the **ingest** capability for the dataset.

### Forcing a specific sink

```env
OBSERVABILITY_SINK="console"   # print to stderr only, ignore DSN/token
OBSERVABILITY_SINK="noop"      # off; useful for isolated integration tests
```

If no provider is configured and `OBSERVABILITY_SINK` is unset, the sink
falls back to `NoOpSink`.

## Event shape

Every dispatched event has:

```jsonc
{
  "level": "error",          // warn | error | fatal
  "msg": "cross-tenant access blocked at proxy",
  "ts": "2026-08-05T02:59:47.312Z",
  "release": "v1.4.2",
  "environment": "production",
  "request_id": "8ac1e4...b9",   // set by the proxy on every request
  "tenant_id": "…uuid…",
  "user_id": "…uuid…",
  "source": "server",             // server | client | cron
  "route": "/finance/cash-advances/…",
  "user_agent": "Mozilla/5.0 …",
  "err": { "name": "Error", "message": "…", "stack": "…" },
  "fields": { /* additional context */ }
}
```

### Redaction rules

Before dispatch we scrub:

- Object keys matching `authorization`, `cookie`, `password`, `token`,
  `secret`, `api_key`, `bearer`, `credit_card`, `ktp`, `npwp`,
  `bank_account`.
- Value patterns: `Bearer <opaque>` and long hex/base64 blobs (≥32 chars).

The client reporter applies the same regex on the browser side before
POSTing, so DSN / API tokens never leave the origin even if they leaked
into an error message.

## Client crashes

Every route group has an `error.tsx` boundary. `global-error.tsx` catches
crashes inside the root layout. All three call `reportClientError(...)`
which:

1. Redacts locally.
2. `navigator.sendBeacon` → `/api/observability/report` (survives page unload).
3. Falls back to `fetch({ keepalive: true })` on browsers without beacon.

`ErrorListener` (mounted from `<Providers>`) installs global
`window.onerror` + `unhandledrejection` listeners so uncaught errors
outside React trees also get reported.

The endpoint:

- Requires same-origin (Origin OR Referer must match `host`).
- Rate-limits 60 events per 5 minutes per IP (Redis-backed).
- Enforces a 16 KB body cap.
- Zod-validates the payload.

## Structured logging on the server

Use the `log` helper — never `console.log` — from any server-side module:

```ts
import { log } from "@/lib/observability/log";

log.info("cash advance approved", {
  tenant_id,
  user_id,
  cash_advance_id,
});

log.error("archive upload failed", {
  tenant_id,
  target,
  err,
});
```

`log.warn` and `log.error` auto-dispatch to the sink; `log.info` and
`log.debug` stay local to keep the sink signal-to-noise high.

For request-scoped logging, use `log.with({ request_id, tenant_id })` to
create a child logger.

## Request IDs

The proxy generates a 128-bit hex `x-request-id` on every request (or
preserves the caller's when present). It is:

- Echoed back on the response as `x-request-id`.
- Propagated to Server Components / Server Actions via the request header.
- Included in every sink event.

To correlate a user-facing digest with a server log, ask the user for the
digest shown on `global-error.tsx`, then search the sink by
`err.digest` OR `request_id`.

## Secret rotation

Rotate `SENTRY_DSN` (or `AXIOM_TOKEN`) at least every 90 days alongside
`SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET`. See
`docs/ops/secret-rotation.md` (TODO — same cadence as the app-encryption
key runbook).

Sink resolution is cached at process start. When rotating tokens in a
running deployment, redeploy (or the platform's env-var change will
trigger a restart) so the new value picks up.

## Silencing the sink in tests

Vitest never touches the network — `resolveSink()` picks `NoOpSink` when
`NODE_ENV === "test"` and no env is set. To assert dispatch behaviour,
inject via `__setSinkForTests(new ConsoleSink())` from within the test.

## Verifying end-to-end

```bash
# 1. Point at a Sentry / Axiom sandbox project.
export SENTRY_DSN="https://…"

# 2. Trigger an error deliberately.
curl -s -X POST http://localhost:3000/api/observability/report \
  -H "content-type: application/json" \
  -H "referer: http://localhost:3000/" \
  -d '{"level":"error","msg":"observability smoke test","stack":"at fn (test.ts:1:1)"}'

# 3. Confirm it lands in the provider UI within ~5s.
```

If the sink is misconfigured, the app still runs — only the sink
dispatch is silent. Check the process stderr for the JSON line to prove
the log fired.

## Dev-only stdout / stderr redactor

Next.js 16 Turbopack's dev server automatically logs every Server
Action invocation with a shallow JSON dump of its arguments, e.g.:

```
POST /login 200 in 815ms
  └─ ƒ signInWithPassword({"email":"…","password":"…"}, {}) in 815ms src/app/(auth)/actions.ts
```

The formatter lives in `next/dist/server/dev/server-action-logger.js`
and has no config knob to disable or redact keys as of Next 16.3.
That is a real leak vector — terminal scrollback, shared Docker
container logs, forwarded-to-aggregator dev streams — so we install
a stdout/stderr wrapper via `src/instrumentation.ts` that
regex-scrubs credential-shaped JSON key-value pairs before they hit
the terminal.

**Keys redacted** (case-insensitive):
`password`, `passwd`, `pwd`, `api_key` (+ camel + kebab variants),
`secret`, `access_token`, `refresh_token`, `id_token`, `authorization`,
`client_secret`, `service_role_key`, `encryption_key`. Also
`Bearer <token>` in headers.

**Not redacted**: `email`. Auth-flow debugging needs it, the
concurrent request-line already shows it, and redacting emails would
make dev logs unreadable.

**Scope**: Only installed in Node.js runtime under `NODE_ENV !==
"production"`. Production Next.js does not run the dev logger, and
our own `log.ts` never puts credential-shaped fields on the wire —
so prod stdout stays untouched (no regex tax on the hot path).

**Removal path**: When Next.js ships arg redaction natively (e.g.
`experimental.logging.serverActions.redactKeys`), swap to that config
and delete `src/instrumentation.ts` + `src/lib/observability/redact-stdout.ts`.

Unit tests: `pnpm vitest run src/lib/observability/redact-stdout.test.ts`
— 9 cases covering key variants, case-insensitivity, Bearer headers,
escaped quotes, idempotency, and false-positive prose.
