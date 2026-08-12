# Environment variable reference

The canonical example lives at [`.env.local.example`](../.env.local.example).
This page is the human-readable companion — grouped by area, with the
provenance of each value.

## Legend

- **Scope** — where the variable is read from.
- **Required** — hard requirement for the app to start.
- **Rotation** — how often to rotate per rules §22.

## Supabase

| Variable                         | Scope   | Required | Rotation | Where to find it |
| -------------------------------- | ------- | -------- | -------- | ---------------- |
| `NEXT_PUBLIC_SUPABASE_URL`       | client + server | ✅ | never   | `supabase status` (local) or project dashboard. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | client + server | ✅ | 90d     | `supabase status` / project dashboard → API. |
| `SUPABASE_SERVICE_ROLE_KEY`      | server only     | ✅ | 90d     | Project dashboard → API. Never expose to client. |
| `SUPABASE_SERVER_URL`            | server only     | ⭕ | never   | Override URL used by server-side Supabase clients only. Set to `http://kong:8000` in Docker Compose so the container reaches Supabase across the shared bridge network without going through `host.docker.internal`. Leave unset outside Docker. |

The service_role key bypasses RLS. It is only imported by
`src/lib/supabase/service.ts` (cron routes, storage listings on admin
surfaces, audit purge helper). Never inline it in a client component.

`SUPABASE_SERVER_URL` exists because `NEXT_PUBLIC_SUPABASE_URL` is baked
into the client bundle (Turbopack) at build time. That value must be
reachable from the user's browser (e.g. `http://127.0.0.1:54321`), but
that URL loops back to the container itself when running under Docker.
The server-side Supabase helpers in `src/lib/supabase/{server,middleware}.ts`
and `proxy.ts` prefer `SUPABASE_SERVER_URL` when set.

## Tenant routing

| Variable                         | Scope         | Required | Notes |
| -------------------------------- | ------------- | -------- | ----- |
| `NEXT_PUBLIC_ROOT_DOMAIN`        | client + server | ✅       | Local: `localhost:3000`. Prod: `controldesk.app`. |
| `NEXT_PUBLIC_APP_NAME`           | client        | ⭕       | Defaults to `ControlDesk`. |
| `NEXT_PUBLIC_APP_URL`            | server        | ⭕       | Absolute URL used in emails + observability payloads. |

## Security

| Variable                         | Scope       | Required | Rotation | Notes |
| -------------------------------- | ----------- | -------- | -------- | ----- |
| `APP_ENCRYPTION_KEY`             | server only | ✅       | 90d      | ≥32 hex chars. Used by `pgcrypto` for HRIS PII at rest. Rotation requires a re-encryption migration — see `docs/ops/secret-rotation.md`. |
| `CRON_SECRET`                    | server only | ✅       | 90d      | Bearer token for all `/api/cron/*` endpoints. |

## Rate limiting

| Variable                         | Scope       | Required | Notes |
| -------------------------------- | ----------- | -------- | ----- |
| `REDIS_URL`                      | server only | ✅ (prod) | Falls back to in-process memory limiter if unset — fine for local dev only. Prod requires an actual Redis instance. |

## SMTP

| Variable                         | Scope       | Required | Rotation | Notes |
| -------------------------------- | ----------- | -------- | -------- | ----- |
| `SMTP_HOST`                      | server only | ✅       | never    | `smtp.resend.com` / `smtp.postmarkapp.com` / `127.0.0.1` (mailpit). |
| `SMTP_PORT`                      | server only | ✅       | never    | `465` (TLS) / `587` (STARTTLS) / `1025` (mailpit). |
| `SMTP_USER`                      | server only | ⭕       | 90d      | Provider-dependent. Blank for mailpit. |
| `SMTP_PASSWORD`                  | server only | ⭕       | 90d      | Provider-dependent. Blank for mailpit. |
| `SMTP_FROM`                      | server only | ✅       | never    | Display name + email. Must be verified with the provider. |

Every dispatched email lands in `public.email_outbox` with the status,
recipient, and last error (if any) — a persisted audit trail even when
SMTP is degraded.

## AI Analytics Engine

| Variable                         | Scope       | Required | Rotation | Notes |
| -------------------------------- | ----------- | -------- | -------- | ----- |
| `OPENAI_API_KEY`                 | server only | ⭕       | 90d      | `sk-...` from [platform.openai.com](https://platform.openai.com/api-keys). No free tier. |
| `ANTHROPIC_API_KEY`              | server only | ⭕       | 90d      | `sk-ant-...` from [console.anthropic.com](https://console.anthropic.com/settings/keys). No free tier. |
| `GOOGLE_GENERATIVE_AI_API_KEY`   | server only | ⭕       | 90d      | Format modern `AQ.Ab...` (per Juni 2026) atau legacy `AIza...` (sunset September 2026). Get free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). |
| `AI_PROVIDER`                    | server only | ⭕       | never    | `openai` \| `anthropic` \| `google` \| `mock`. Default `mock`. |
| `AI_MODEL_ID`                    | server only | ⭕       | never    | Provider-specific model slug. Untuk Gemini: **`gemini-flash-latest`** (recommended — auto-track versi stable terbaru). |
| `AI_DAILY_TOKEN_CAP`             | server only | ⭕       | never    | Per-tenant daily output-token budget. Default `10000`. Enforced via Redis. |

Details lengkap + troubleshooting → [`integrations/ai-insights-gemini.md`](integrations/ai-insights-gemini.md).

PII redaction (`src/lib/ai/redact.ts`) runs on every prompt before
dispatch — names hashed, salaries bucketed, KTP dropped, bank accounts
truncated. Independent of provider.

## Messaging integrations (Telegram + WhatsApp)

| Variable                         | Scope       | Required                       | Rotation | Notes |
| -------------------------------- | ----------- | ------------------------------ | -------- | ----- |
| `TELEGRAM_LINK_TOKEN_SECRET`     | server only | ✅ untuk user link             | 90d      | HMAC-SHA256 secret untuk sign deep link `/start` token. Min 32 chars. |
| `TELEGRAM_WEBHOOK_URL`           | server only | ✅ production                  | never    | URL webhook publik (`https://<domain>/api/telegram/webhook`). Dipakai saat activate bot. |
| `TELEGRAM_WEBHOOK_SECRET`        | server only | ⭕ recommended                 | 90d      | Secret path parameter untuk validasi webhook authenticity. |
| `WHATSAPP_OTP_SECRET`            | server only | ✅ untuk user link             | 90d      | HMAC secret untuk OTP verifikasi nomor WA user. Min 32 chars. |
| `WHATSAPP_WEBHOOK_SECRET`        | server only | ⭕                             | 90d      | Header validation untuk inbound webhook (belum digunakan untuk Fonnte). |

Bot token / device token per-tenant **BUKAN** environment variable —
disimpan encrypted di kolom `encrypted_bot_token` / `encrypted_api_token`,
di-enter via UI admin per tenant (`/settings/integrations/*`).

Details lengkap:
- Telegram → [`integrations/telegram-bot.md`](integrations/telegram-bot.md)
- WhatsApp (Fonnte) → [`integrations/whatsapp-fonnte.md`](integrations/whatsapp-fonnte.md)

## Observability

| Variable                         | Scope       | Required | Rotation | Notes |
| -------------------------------- | ----------- | -------- | -------- | ----- |
| `OBSERVABILITY_SINK`             | server only | ⭕       | never    | `auto` (default) \| `sentry` \| `axiom` \| `console` \| `noop`. |
| `SENTRY_DSN`                     | server only | ⭕       | 90d      | Copy from Sentry project settings. |
| `SENTRY_ENV`                     | server only | ⭕       | never    | Overrides `OBSERVABILITY_ENV`. |
| `AXIOM_TOKEN`                    | server only | ⭕       | 90d      | Axiom ingest token (`xaat-...`). |
| `AXIOM_DATASET`                  | server only | ⭕       | never    | Dataset name. |
| `OBSERVABILITY_ENV`              | server only | ⭕       | never    | Tag applied to every dispatched event. |
| `RELEASE_TAG`                    | server only | ⭕       | never    | Falls back to `VERCEL_GIT_COMMIT_SHA` / `GIT_SHA`. |

Redaction happens in `redactPayload()` regardless of provider — no
adapter can leak PII by design.

## Build-time metadata

| Variable                         | Scope       | Required | Notes |
| -------------------------------- | ----------- | -------- | ----- |
| `BUILD_SHA`                      | server only | ⭕       | Auto-set by Vercel to `VERCEL_GIT_COMMIT_SHA`. Surfaces via `/api/version`. |
| `BUILD_TIME`                     | server only | ⭕       | ISO timestamp injected at build. Surfaces via `/api/version`. |
| `NEXT_TELEMETRY_DISABLED`        | server only | ⭕       | Set to `1` to opt out of Next.js anonymous telemetry. |

## CI-only

| Variable                         | Scope       | Required | Notes |
| -------------------------------- | ----------- | -------- | ----- |
| `PLAYWRIGHT_BASE_URL`            | ci          | ⭕       | Overrides the default `http://demo.localhost:3000` for E2E. |
| `PLAYWRIGHT_SKIP_WEBSERVER`      | ci          | ⭕       | Set to `1` when running Playwright against an existing dev server. |

## Provisioning checklist

Before flipping a new environment (staging or prod) to real traffic:

- [ ] All ✅-required variables set.
- [ ] `APP_ENCRYPTION_KEY` was generated with `openssl rand -hex 32`.
      NEVER copied from another environment.
- [ ] `CRON_SECRET` was generated with `openssl rand -hex 32`.
- [ ] `SMTP_FROM` domain verified with the provider.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is stored in a secret manager, not
      inlined in Vercel env for developer access.
- [ ] `REDIS_URL` reachable from the runner region.
- [ ] `SENTRY_DSN` OR `AXIOM_TOKEN` — one of them set, and the sink
      configured accordingly.
- [ ] `/settings/secrets` page has been walked to confirm the initial
      seed matches which secrets you actually rotated during provisioning.
