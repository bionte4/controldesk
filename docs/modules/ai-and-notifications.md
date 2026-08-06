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
AI_PROVIDER=openai   # 'openai' | 'anthropic' | 'google' | 'mock'
AI_MODEL_ID=gpt-4o-mini
OPENAI_API_KEY=sk-...
```

**Default: `mock`** — kalau `OPENAI_API_KEY` unset, semua generator
pakai `src/lib/ai/mock/*.ts` yang return deterministic dummy insights.
Ini memudahkan onboarding dan development tanpa cost.

### Dashboard integration

`/dashboard` menampilkan **AI Insights Badge** di topbar (bel kedua di
sebelah notifikasi umum). Badge dot muncul kalau ada insight
`severity = ACTION_REQUIRED` yang belum dibaca.

`/insights` adalah full page — filter by kind, severity, scope, date
range. Mark-as-read individual atau bulk.

## Part 2 — Notifications system

Tiga surface paralel:

1. **In-app bell** — badge topbar + full page `/notifications`.
2. **Email** — via `email_outbox` + nodemailer.
3. **Realtime** — Supabase Realtime `postgres_changes` untuk auto-refresh UI.

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

Dipakai dari triggers + Server Actions. Fanned out via internal insert
+ email_outbox row (kalau user opt-in email untuk kind ini di
`notification_preferences`).

Contoh trigger (approval state change):

```sql
CREATE TRIGGER expense_notify_on_state_change
AFTER UPDATE OF status ON public.expenses
FOR EACH ROW
WHEN (NEW.status != OLD.status)
EXECUTE FUNCTION public.trg_expense_state_notify();
```

### Email outbox

Tabel `public.email_outbox`:

| Kolom              | Tipe                | Note                                              |
| ------------------ | ------------------- | ------------------------------------------------- |
| `id`               | `uuid`              |                                                   |
| `tenant_id`        | `uuid`              |                                                   |
| `to_email`         | `text`              |                                                   |
| `subject`          | `text`              |                                                   |
| `body_html`        | `text`              |                                                   |
| `body_text`        | `text`              |                                                   |
| `notification_id`  | `uuid`              | FK → `notifications.id`                           |
| `status`           | `email_status`      | `PENDING` / `SENT` / `FAILED` / `BOUNCED`         |
| `attempts`         | `int`               | Retry counter (max 3, then FAILED)                |
| `sent_at`          | `timestamptz`       |                                                   |
| `error_message`    | `text`              |                                                   |

**Why an outbox?** Rules §20 — email attempt harus **auditable**, bahkan
saat SMTP degraded. Sending logic via `nodemailer` + backoff retry
policy.

Cron `/api/cron/email-flush` (setiap 5 menit) pick up `PENDING` +
transient `FAILED` (attempts < 3) rows dan retry send. `SENT` dan hard
`FAILED` (attempts ≥ 3, bounced, etc.) di-preserve untuk audit.

**Templates**: Bahasa Indonesia default, dengan i18n key `emails.*` di
`messages/id.json` + `messages/en.json`. Deep-link URL selalu absolute
per tenant subdomain.

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

## Where to look next

- Environment vars → [`../env-reference.md#ai-analytics-engine-rules-15`](../env-reference.md#ai-analytics-engine-rules-15).
- Observability + logging AI errors → [`../ops/observability.md`](../ops/observability.md).
- Cron endpoints (digest, insights, email-flush) → [`../api-reference.md`](../api-reference.md).
