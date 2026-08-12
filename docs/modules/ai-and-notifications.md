# AI Insights & Notifications

Dua cross-cutting modul yang mempengaruhi hampir semua modul bisnis
lain. AI adalah analitika/prediksi opsional (bisa di-off tenant-by-tenant);
notifications adalah sistem messaging in-app + email + realtime yang
integral.

## Part 1 — AI Insights

**Route**: `/insights`. Tabel: `public.ai_insights` (migration `0014`).

### Four generators

Kode: `src/lib/ai/generators/*.ts`. Semua pakai **Vercel AI SDK
`generateObject`** dengan Zod schema untuk **structured output** (bukan
free-form text).

| Generator                          | Purpose                                                                          | Trigger                                       |
| ---------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------- |
| `predict-expense-impact`           | Proyeksikan dampak biaya baru terhadap gross margin proyek.                     | On-demand dari dashboard atau CA/expense form.|
| `analyze-resource-utilization`     | Flag PM/employee yang over-allocated atau under-utilized lintas proyek.         | Cron harian + on-demand di `/insights`.       |
| `analyze-client-health`            | Skor kesehatan hubungan klien (SLA compliance + response time + payment cycle).  | Cron mingguan + on-demand.                    |
| `analyze-sla-breach`               | Warning risiko breach SLA 24–48 jam ke depan.                                    | Cron per 4 jam.                                |

### Schema of insight

```
public.ai_insights (
  id uuid,
  tenant_id uuid,
  kind ai_insight_kind,          -- 'EXPENSE_IMPACT', 'RESOURCE_UTILIZATION', 'CLIENT_HEALTH', 'SLA_BREACH_RISK'
  scope_type text,                -- 'project', 'client', 'employee', 'tenant'
  scope_id uuid,                  -- FK ke scope_type
  severity ai_insight_severity,   -- 'INFO', 'WARN', 'ACTION_REQUIRED'
  title text,
  summary text,
  payload jsonb,                  -- structured output dari generator
  prompt_version text,            -- for audit reproducibility
  model_id text,                  -- e.g. 'gpt-4o-mini'
  generated_at timestamptz,
  read_at timestamptz             -- per-user unread tracking di `ai_insight_reads`
);
```

### AI Safety (rules §15)

**Non-negotiable checks** sebelum payload dikirim ke LLM:

#### 1. PII redaction (`src/lib/ai/redact.ts`)

Setiap payload di-scrub via `scrubPrompt(input)`:

| Field                    | Redaction                                                          |
| ------------------------ | ------------------------------------------------------------------ |
| Employee full name       | → `"employee_" || short_hash(id)`                                  |
| Employee email           | → dropped                                                          |
| Salary (any numeric)     | → range bucket: `"<5jt"` / `"5-10jt"` / `"10-20jt"` / `">20jt"`  |
| Bank account number      | → last-4: `"**** 1234"`                                            |
| KTP / NPWP               | → dropped entirely                                                 |
| Phone number             | → last-4: `"**** 5678"`                                            |
| Client contact           | → dropped                                                          |
| Long hex/base64 tokens   | → `"[REDACTED_TOKEN]"`                                             |

Unit-tested against adversarial payloads (name in nested object, etc.)
di `src/lib/ai/redact.test.ts`.

#### 2. Per-tenant daily token cap

Sebelum call, generator cek Redis counter:

```
key: ai:cost-cap:{tenant_id}:{yyyy-mm-dd}
```

Default cap: **10,000 output tokens per tenant per day**.
Setelah quota terlampaui:

- Return `{ ok: false, code: "AI_QUOTA_EXCEEDED" }`.
- Fallback graceful: UI show cached last insight + "quota reached until 00:00 WIB".

Tenant Admin bisa bump per tenant di `tenant_ai_config.daily_token_cap`.

#### 3. Prompt version + model tracking

`ai_insights.prompt_version` dan `model_id` disimpan untuk **audit
reproducibility** — kalau ada dispute ("kenapa AI recommend ini?"),
kita bisa reproduce dengan prompt + model yang sama.

#### 4. Cross-tenant isolation

Generator **NEVER** query lintas tenant. Setiap fetch data pakai
`.eq('tenant_id', ctx.actor.tenantId)`. Kalau ada RPC yang perlu
service-role (misal aggregate lintas project), tetap filter tenant di
app layer.

### Providers

Config via env (lihat [`../env-reference.md`](../env-reference.md)):

```
AI_PROVIDER=google                                # 'openai' | 'anthropic' | 'google' | 'mock'
AI_MODEL_ID=gemini-flash-latest
GOOGLE_GENERATIVE_AI_API_KEY=AQ.Ab...             # AI Studio API key (format modern per Juni 2026)
```

**Default: `mock`** — kalau `AI_PROVIDER` unset atau key placeholder,
semua generator pakai fallback deterministic (bilingual `id`/`en`) yang
di-generate dari data DB tenant. Ini memudahkan onboarding dan
development tanpa cost.

**Recommended untuk production**: Google Gemini free tier — 1,500
req/hari, structured output kelas satu, biaya nol untuk skala kecil-menengah.
Setup lengkap + troubleshooting → [`../integrations/ai-insights-gemini.md`](../integrations/ai-insights-gemini.md).

### Locale-aware output

Bahasa output mengikuti cookie `NEXT_LOCALE` yang di-set via toggle
bahasa di Topbar (rules §18). Server Action `runInsightAction()` baca
cookie via `resolveInsightLocale()` dan pass ke `runInsight(kind, actor, locale)`.
Generator inject `languageDirective(locale)` di awal system prompt supaya
Gemini/OpenAI/Anthropic return teks dalam bahasa yang tepat.

Yang tidak diterjemahkan: nama proyek, klien, karyawan, kode COA — semua
tetap seperti di DB. Yang diterjemahkan: narasi, headline, actions,
signals.

Fallback (mock) output juga bilingual via helper `pick(locale, id, en)`.
`PROMPT_VERSION = "v2-locale"` di-track di `ai_insights.prompt_version`
untuk audit reproducibility.

### Dashboard integration

`/dashboard` menampilkan **AI Insights Badge** di topbar (bel kedua di
sebelah notifikasi umum). Badge dot muncul kalau ada insight
`severity = ACTION_REQUIRED` yang belum dibaca.

`/insights` adalah full page — filter by kind, severity, scope, date
range. Mark-as-read individual atau bulk.

## Part 2 — Notifications system

Tiga surface paralel:

1. **In-app bell** — badge topbar + full page `/notifications`. Fan-out
   default untuk semua kind, ditulis oleh helper `notifyUser()` /
   `notifyRoles()` di `src/lib/notifications/service.ts`.
2. **Telegram** — opt-in per user (`user_telegram_links`) via bot per
   tenant. Best-effort, tidak block server action kalau gagal.
3. **WhatsApp** — opt-in per user (`user_whatsapp_links`) via gateway
   per tenant (Twilio, Fonnte, Meta Cloud — provider dipilih di
   Settings → Integrations → WhatsApp). Best-effort, dispatch bareng
   Telegram lewat `notifyUser()`; `NO_CONFIG` / `NO_LINK` di-log info
   dan dilewati (bukan error).
4. **Email** — via `email_outbox` + Nodemailer. Saat ini **hanya**
   dipakai oleh cron digest, settlement reminders, dan self-signup;
   server-action-driven notifications belum fan-out ke email (dilacak
   di [`../../TODO.md`](../../TODO.md)).
5. **Realtime** — Supabase Realtime `postgres_changes` untuk
   auto-refresh UI notifikasi + approval inbox.

Plus khusus untuk Client Portal: `portal_notifications` — surface
terpisah, lihat [`clients-and-portal.md#notifications`](clients-and-portal.md#notifications).

### Table `notifications`

Migration `0006_notifications_and_attachments.sql`:

| Kolom          | Tipe                    | Note                                                     |
| -------------- | ----------------------- | -------------------------------------------------------- |
| `id`           | `uuid`                  |                                                          |
| `tenant_id`    | `uuid`                  | RLS                                                      |
| `user_id`      | `uuid`                  | Target (FK → `auth.users`)                               |
| `kind`         | `notification_kind`     | Enum panjang — lihat di bawah                            |
| `title`        | `text`                  |                                                          |
| `body`         | `text`                  |                                                          |
| `action_url`   | `text`                  | Deep-link ke detail (mis. `/approvals/exp-xxx`)          |
| `payload`      | `jsonb`                 | Structured metadata untuk badge, filters                 |
| `read_at`      | `timestamptz`           | Null = unread                                            |
| `created_at`   | `timestamptz`           |                                                          |

### Notification kinds

```
APPROVAL_REQUIRED       - Ada item pending di inbox user
APPROVAL_APPROVED       - Item user di-approve oleh someone
APPROVAL_REJECTED       - Item user di-reject
EXPENSE_APPROVED / EXPENSE_REJECTED
CASH_ADVANCE_APPROVED / CASH_ADVANCE_DISBURSED / CASH_ADVANCE_SETTLED
BUDGET_REQUEST_APPROVED
PETTY_CASH_LOW_BALANCE
HR_REQUEST_APPROVED / HR_REQUEST_REJECTED
PROJECT_ASSIGNED / PROJECT_UNASSIGNED
PROJECT_ISSUE_ESCALATED
PM_HANDOVER_RECEIVED
SLA_BREACH_WARNING
SLA_BREACH_INCURRED
AI_INSIGHT_NEW
SECRET_ROTATION_DUE / SECRET_ROTATION_OVERDUE
SYSTEM (generic)
DIGEST_DAILY (aggregated)
```

### Enqueue helper

Postgres function: `public.enqueue_notification(user_id, kind, title, body, action_url, payload)`.

Dipakai dari DB triggers + Server Actions. Fan-out otomatis via
`notifications` INSERT (kanal `IN_APP`, source-of-truth) + optional
Telegram push + optional WhatsApp push. Kedua kanal side-channel
dieksekusi paralel oleh `notifyUser()` dan **best-effort** —
kegagalan tidak pernah membatalkan Server Action yang memanggil
(rules §20). Setiap side-channel di-gate oleh
`user_notification_preferences` (kategori × kanal), fail-open kalau
row preferensi tidak ada.

Fan-out ke `email_outbox` **belum di-wire pada mutations** — cek
"Writer semantics" di bagian Email outbox di bawah untuk daftar caller
yang saat ini menulis outbox.

Contoh trigger (approval state change):

```sql
CREATE TRIGGER expense_notify_on_state_change
AFTER UPDATE OF status ON public.expenses
FOR EACH ROW
WHEN (NEW.status != OLD.status)
EXECUTE FUNCTION public.trg_expense_state_notify();
```

### Email outbox

Tabel `public.email_outbox` (schema: migrasi
[`0016_retention_and_ops_logs.sql`](../../supabase/migrations/0016_retention_and_ops_logs.sql)):

| Kolom                 | Tipe          | Note                                                     |
| --------------------- | ------------- | -------------------------------------------------------- |
| `id`                  | `uuid`        | PK                                                       |
| `tenant_id`           | `uuid`        | Nullable — signup verify emails ditulis sebelum tenant ada |
| `to_address`          | `text`        | Alamat penerima                                          |
| `from_address`        | `text`        | `From:` yang benar-benar dikirim (tenant relay vs env)   |
| `subject`             | `text`        |                                                          |
| `body_text`           | `text`        |                                                          |
| `body_html`           | `text`        | Nullable — sekarang semua sender pakai text-only         |
| `status`              | `text`        | `PENDING` / `SENT` / `FAILED` / `SKIPPED` (CHECK)        |
| `provider`            | `text`        | `smtp` (Nodemailer aktif) atau `noop` (dev fallback)     |
| `provider_message_id` | `text`        | Message-ID dari SMTP MTA                                 |
| `error_message`       | `text`        | Diisi kalau `status='FAILED'`                            |
| `metadata`            | `jsonb`       | `{ kind, ...contextual }` — dipakai filter di UI ops     |
| `created_at`          | `timestamptz` |                                                          |
| `sent_at`             | `timestamptz` | Diisi hanya saat `status='SENT'`                         |

**Why an outbox?** Rules §20 — setiap email attempt wajib **auditable**,
walaupun SMTP sedang degraded. Baris ini adalah source-of-truth untuk
menjawab "kenapa user X tidak menerima email Y".

**Writer semantics (state per 2026-08-12).** `sendEmail()` di
`src/lib/notify/mailer.ts` mengembalikan `EmailResult` — writing ke
`email_outbox` **eksplisit dilakukan caller** (bukan mailer). Caller
yang saat ini sudah patuh:

- `POST /api/cron/digest` — insert baris `status='SENT'`/`'FAILED'` per
  penerima.
- `POST /api/cron/settlement-reminders` — insert per notification email
  yang dikirim.
- `POST /register-org` (verify + confirmation) — insert setelah signup
  step.

**Tidak ada retry cron** saat ini. `SKIPPED` = SMTP belum
dikonfigurasikan; `FAILED` = transient error yang tidak di-retry
otomatis (ops harus resend manual dari UI, atau kirim ulang dari cron).
Baseline yang berlaku, bukan aspirational. Retry loop / bounce
detection direncanakan sebagai backlog di [`../../TODO.md`](../../TODO.md).

**Templates**: Bahasa Indonesia default, dikonstruksi inline oleh
helper renderer per-kind (mis. `renderSignupVerificationEmail()`,
`renderDigestEmail()`) — bukan lewat i18n JSON. Deep-link URL selalu
absolute per tenant subdomain (`https://{slug}.controldesk.app/...`).

### Realtime

Supabase Realtime channel:
- `tenant:{tenant_id}:approvals` — untuk unified approval inbox.
- `tenant:{tenant_id}:notifications:{user_id}` — untuk bell badge count.
- `tenant:{tenant_id}:insights` — untuk AI badge.

Client component subscribe pakai `@supabase/supabase-js` realtime API,
trigger `router.refresh()` (bukan optimistic update — mempertahankan
RSC as source of truth).

### Digest (aggregate emails)

Cron `/api/cron/digest` (harian 08:00 WIB) kirim digest email untuk:

- **HR Admin**: pending HR requests > 24 jam.
- **Lead Finance**: pending approvals > 24 jam + petty cash low balance.
- **Tenant Admin**: secret rotation due/overdue, retention warnings.
- **SLA officer** (biasanya OM/GM): SLA breach risk warnings dari AI.

Format: satu email per role per tenant, subject `[ControlDesk] Daily
Digest — {tenant_name}`.

### User preferences

Tabel `public.notification_preferences`:

| Kolom           | Tipe                | Note                                                 |
| --------------- | ------------------- | ---------------------------------------------------- |
| `user_id`       | `uuid`              |                                                      |
| `kind`          | `notification_kind` |                                                      |
| `in_app`        | `boolean`           | Default `true`                                       |
| `email`         | `boolean`           | Default per-kind (approvals: true, digests: opt-in)  |
| `email_digest`  | `boolean`           | Include di daily digest (default `true`)             |

Kontrol UI: `/settings/notifications`. User bisa toggle per kind.
Beberapa kind tidak bisa di-off (misal `SECRET_ROTATION_OVERDUE` untuk
Admin) — enforced di Server Action.

## Part 3 — Messaging channels (Telegram + WhatsApp)

Selain in-app + email, ControlDesk support 2 messenger channel opsional:

| Channel                  | Aktivasi                                      | Detail                                                              |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------------------- |
| **Telegram** (per-tenant bot) | Admin `/settings/integrations/telegram-bot` + user opt-in di `/settings/preferences` | [`../integrations/telegram-bot.md`](../integrations/telegram-bot.md) |
| **WhatsApp** (via Fonnte)     | Admin `/settings/integrations/whatsapp-business` + user OTP verify di preferences | [`../integrations/whatsapp-fonnte.md`](../integrations/whatsapp-fonnte.md) |

Setiap channel mengikuti pattern **per-tenant config**:
- Tabel `tenant_<channel>_configs` untuk bot/device token (encrypted).
- Tabel `user_<channel>_links` untuk pairing per-user (chat_id / phone).
- Server Action `withSecureAction` + PDP check (`decideTelegramBotConfig`, `decideWhatsAppConfig`).
- Adapter di `src/lib/integrations/<channel>/client.ts` — return `{ ok: false, code, error }` tanpa throw.
- CLI smoke test via `pnpm test:tg` / `pnpm test:wa` — lihat [`../dev-tools.md`](../dev-tools.md).

### Notification service fan-out

Kalau row `notifications` di-insert dengan `channels: ['in_app', 'email', 'telegram', 'whatsapp']` (subset), worker `notification-drain` cron loop akan:

1. Cek `user_notification_preferences` — user opt-in untuk kind ini di channel ini?
2. Kalau ya, load `user_<channel>_links` row.
3. Call `send<Channel>Message()` helper.
4. Update `notification.delivered_at` per channel.

**Fail-open**: kalau salah satu channel gagal (mis. Telegram bot di-block user), channel lain tetap fire. Kalau semua channel gagal, in-app tetap muncul di bel notifikasi.

## Where to look next

- Environment vars → [`../env-reference.md#ai-analytics-engine`](../env-reference.md).
- Integration setup + troubleshooting → [`../integrations/`](../integrations/).
- CLI dev tools → [`../dev-tools.md`](../dev-tools.md).
- Observability + logging AI errors → [`../ops/observability.md`](../ops/observability.md).
- Cron endpoints (`digest`, `ai-insights-sweep`, `settlement-reminders`,
  `retention`, `google-calendar-drain`, `issues-sla-sweeper`, dsb.) →
  [`../api-reference.md`](../api-reference.md).
