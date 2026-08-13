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

### "Ask ControlDesk" chatbot (Level 1 + Level 2 — Fase 2/3)

Route: `/help?tab=ask`. API: `POST /api/help/ask` (streaming text).

**Level 1 (docs-only)**: menjawab dari `docs/` yang di-manifest di
`src/lib/help/articles.ts`. Zero data-leak risk — tidak ada tool
call, tidak ada akses ke tabel bisnis tenant.

**Level 2 ("Ask my data" — RFC 0001)**: unlocked ketika client
mengirim `conversationId` + `useTools=true`. Model dapat memanggil
3 tool read-only (`list_pending_approvals`, `my_projects`,
`expense_summary_this_month`) di `src/lib/ai/tools/index.ts`. Setiap
tool ABAC-scoped ke caller (tenantId + employeeId injected dari
session, tidak bisa di-override lewat argumen model). Detail
threat-model + tool inventory ada di
[docs/rfc/0001-ask-my-data.md](../rfc/0001-ask-my-data.md).

**Pipeline**:

1. **Retrieval** — `src/lib/help/retrieval.ts`. Two-tier: embedding-first,
   keyword fallback. Query dikirim ke `gemini-embedding-001` (768-dim
   Matryoshka), cosine similarity vs index statis di
   `src/lib/help/embeddings.json` yang di-precompute via `pnpm
   help:reindex`. Kalau API key kosong / provider gagal / index kosong,
   fallback ke Fuse.js keyword search. Top-3 artikel jadi CONTEXT.
   Setiap hit di-tag `retrievalMode: "embedding" | "keyword" |
   "manifest"` untuk observability.
2. **Prompt** — `src/lib/help/chat-prompt.ts`. Sistem prompt tersegel
   dengan guardrail: locale-aware refusal, cross-tenant isolation
   ("NEVER discuss any tenant other than X"), no mutation offers, dan
   citation contract (`[slug]` → link ke `/help/{slug}`).
3. **Model** — resolve via `resolveAiModel(tenantId)` yang sudah
   dipakai insight generator, jadi tenant AI config di
   `/settings/integrations/ai` langsung berlaku untuk chatbot.
4. **Streaming** — `streamText()` dari Vercel AI SDK, di-return sebagai
   `text/plain` SSE. Client (`HelpAskPanel`) baca via
   `res.body.getReader()` tanpa dep `@ai-sdk/react`.
5. **Rate limit + cost cap** — dua Redis buckets:
   `helpChatPerUser` (6/menit) + `helpChatPerTenant` (60/menit). Token
   reservasi via `reserve()` (rules §15), commit delta pada
   `onFinish`.

**Ephemeral by design**: chat history tidak disimpan ke DB (per pilihan
user Fase 2). Message list hidup di client state; refresh → wipe.

**Citation rewrite**: assistant reply yang menulis `[overview]` di-
render sebagai link `<Link href="/help/overview">`. Slug allowlist
diambil dari manifest RSC — hallucination `[foo-bar]` yang tidak ada
di manifest tetap ditampilkan sebagai teks polos, tidak jadi link
mati.

**Telemetry**: `log.info("help_chat_reply", {...})` per reply — model
id, input/output tokens, latency, dan daftar slug yang di-retrieve
plus retrieval mode-nya. `log.info("help_retrieval_embedding", {...})`
di-log setiap kali embedding tier berhasil, dengan hit scores untuk
audit relevansi. Tidak menyentuh `ai_insights` (schema itu untuk 4
structured generator, bukan chat).

**Reindex embeddings**: setiap kali `HELP_MANIFEST` atau isi markdown
di `docs/` berubah, jalankan `pnpm help:reindex` (butuh
`HELP_EMBEDDING_API_KEY` atau `GOOGLE_GENERATIVE_AI_API_KEY`).
Content-hashed jadi idempotent — hanya artikel yang berubah yang di-
embed ulang. Output ke `src/lib/help/embeddings.json` (~400 KB, 16
artikel × 768 dims). Commit bersama perubahan doc.

### Inline AI copilot (Level 3 — Fase 2)

Route: `POST /api/ai/copilot`. Reusable client: `<AiCopilot>` di
`src/components/ai/ai-copilot.tsx`.

"AI-assist" per-field untuk form. Tombol Sparkles kecil di sebelah
label textarea → popover streaming saran → Accept / Regenerate /
Cancel. Wired ke 4 surface:

| Surface | Field | Konteks yang dikirim |
|---|---|---|
| `ca_purpose` | Cash Advance General → `purpose` | amount, project_name |
| `field_ops_justification` | Cash Advance FieldOps → `justification` | project, area, tujuan, ticket, transport, PIC |
| `expense_description` | Project Expense → `notes` | amount, project, category |
| `project_description` | Project Wizard → `description` | project, client, dates, contract value |

Registry per-surface di `src/lib/ai/copilot-surfaces.ts` — masing-
masing punya prompt template, allowlist context keys, dan
`maxOutputTokens` (≤ 240). Server-side memfilter context keys sebelum
di-render ke prompt: apa pun di luar allowlist di-drop diam-diam
(tidak diteruskan ke LLM).

**Isolation**: tenant di-pull dari session, tidak bisa di-override
lewat body. Copilot **tidak** melakukan DB read tambahan — client
mengirimkan value yang sudah dilihat user di form. Kalau tidak
kelihatan di form, LLM tidak dapat.

**Rate limit**: `aiCopilotPerUser` (12/menit) +
`aiCopilotPerTenant` (120/menit). Cost cap sama dengan chatbot —
`reserve()` sebelum call, commit delta di `onFinish`.

**Telemetry**: `log.info("ai_copilot_reply", {...})` per reply —
surface, model, input/output tokens, latency, user draft length, dan
context keys yang lolos filter.

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
4. **Email** — via `email_outbox` + Nodemailer. Per-item fan-out
   sekarang **aktif** untuk approval-relevant kinds (allowlist di
   `src/lib/notifications/categories.ts` → `EMAIL_ELIGIBLE_KINDS`).
   Dispatcher: `src/lib/notifications/email-dispatcher.ts` — dipanggil
   dari `notifyUser()` bareng Telegram + WhatsApp, best-effort, non-blocking.
   Timesheet dan bulk-import event tetap in-app only (tidak di allowlist).
   Cron digest + settlement reminders + self-signup masih menulis
   `email_outbox` sendiri dengan skeleton yang sama.

   **Tenant isolation (kritikal)**: dispatcher pakai `createServiceRoleClient()`
   untuk bisa jalan dari Server Action **dan** cron route yang tidak
   punya session cookie. RLS di-bypass, jadi isolasi tenant di-enforce
   oleh **3 layer eksplisit**:
   (1) `.eq("tenant_id", input.tenantId)` di query `employees`;
   (2) `.eq("id", input.tenantId)` di query `tenants`;
   (3) sanity check `tenant.id === input.tenantId` post-load — bail
   kalau row leak.
   CTA URL selalu di-build dari `tenant.slug` yang di-fetch pakai
   `input.tenantId`, bukan dari heuristik. Outbox row juga di-tag
   dengan `input.tenantId`, bukan `tenant.id` dari row (defensive).
   Cross-tenant regression test locked di
   [`email-dispatcher.test.ts`](../../src/lib/notifications/email-dispatcher.test.ts).

   `isChannelEnabled()` dan `loadEnabledMap()` di
   [`preferences.ts`](../../src/lib/notifications/preferences.ts) juga
   pakai `createServiceRoleClient()` — perlu supaya dispatcher bisa
   baca preferensi user LAIN (approver, subordinate). Kalau pakai
   session client, RLS scope `user_id = auth.uid()` bikin lookup
   preferensi user lain balik null → fail-open → user yang opt-out
   tetap dikirimi email (bug lama sebelum fix). Public UI reader
   (`loadPreferencesForUser`) tetap pakai session client karena
   hanya baca row user sendiri.
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

Fan-out ke `email_outbox` **aktif** untuk approval-relevant kinds
lewat `dispatchNotificationEmail()`. Kind allowlist di
`categories.ts::EMAIL_ELIGIBLE_KINDS` bertindak sebagai gate yang
lebih ketat dari user preference — kinds di luar allowlist tidak
pernah kirim email meskipun user opt-in EMAIL untuk kategori itu.
Kalau ingin nambah kind ke email (misal `PETTY_CASH_LOW_BALANCE`),
edit `EMAIL_ELIGIBLE_KINDS` di file itu dan tambahkan unit test.
Lihat "Writer semantics" di bawah untuk daftar caller lain yang
menulis outbox langsung (cron digest, settlement reminders, self-signup).

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
  yang dikirim (skeleton HTML + text).
- `POST /register-org` (verify + confirmation) — insert setelah signup
  step (skeleton HTML + text).
- `notifyUser()` via `dispatchNotificationEmail()` — per-item fan-out
  untuk `EMAIL_ELIGIBLE_KINDS` (approvals, settlement chase, contract
  expiring, monthly report ke klien, dsb.). Baris outbox berisi
  `metadata.source='notify_user'` supaya filter ops bisa memisahkan.

**Tidak ada retry cron** saat ini. `SKIPPED` = SMTP belum
dikonfigurasikan; `FAILED` = transient error yang tidak di-retry
otomatis (ops harus resend manual dari UI, atau kirim ulang dari cron).
Baseline yang berlaku, bukan aspirational. Retry loop / bounce
detection direncanakan sebagai backlog di [`../../TODO.md`](../../TODO.md).

**Templates**: Bahasa Indonesia default, dikonstruksi via
`renderEmailBody()` di [`src/lib/notify/templates/skeleton.ts`](../../src/lib/notify/templates/skeleton.ts)
— satu skeleton produce `text/plain` + `text/html` sekaligus, dengan
HTML escaping, branding eyebrow, CTA button, dan preheader. Deep-link
URL selalu absolute per tenant subdomain
(`https://{slug}.{ROOT_DOMAIN}/...`) dan `?from=email` di-append oleh
`dispatchNotificationEmail()` supaya server action approver bisa log
`via_email=true` di audit trail (Pola A one-click login-first — Pola B
signed-token magic-link belum diimplementasikan; lihat
[`../../TODO.md`](../../TODO.md) bila ingin lanjut).

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
