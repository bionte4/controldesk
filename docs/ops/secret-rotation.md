# Secret Rotation — Ops Runbook

Related rules: §3 (Enterprise Security), §22 (Data retention), §21
(Observability), §15 (AI cost cap).

ControlDesk enforces a **90-day rotation** across every long-lived secret.
This runbook lists every credential, why it exists, where it lives, and
the exact steps to rotate without downtime.

## Rotation calendar

Every calendar quarter, on the first Monday, run through this list:

| Priority | Secret | Where it's used | Downtime? |
| --- | --- | --- | --- |
| P0 | `APP_ENCRYPTION_KEY` | HRIS PII columns (salary, KTP, NPWP, bank_account). | Requires re-encryption migration. |
| P0 | `SUPABASE_SERVICE_ROLE_KEY` | Server actions, cron workers, storage uploads. | Zero if rolled during deploy. |
| P0 | `CRON_SECRET` | `/api/cron/*` Bearer auth. | Zero. |
| P1 | `SENTRY_DSN` / `AXIOM_TOKEN` | Observability sink (rules §21). | Zero (only affects error telemetry). |
| P1 | `OPENAI_API_KEY` (or provider equivalent) | AI Insights (rules §15). | Zero (falls back to `mock` provider). |
| P1 | `SMTP_PASS` | Digest emails (rules §20). | Zero (falls back to `SKIPPED` state per outbox). |
| P2 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + proxy tenant guard. | Requires deploy. |

**Never rotate a P0 and a P1 secret in the same window** — leaves you
without a rollback path if the deploy fails.

## Change-management checklist

Before you rotate anything:

1. Open a ticket that references this runbook. Assign a **primary** and
   a **buddy** engineer.
2. Announce a 30-min maintenance window in the ops channel.
3. Verify the current secret still works via a smoke test (see per-secret
   sections below).
4. Snapshot the current value into your team's secret manager (1Password,
   Vault, AWS Secrets Manager) tagged `superseded-YYYY-MM-DD` — you may
   need to roll back within the retention window.

After the rotation:

1. Delete superseded values from `.env.local` (never commit).
2. Update the "last rotated" tag in the secret manager.
3. Close the ticket with links to the CI + monitoring dashboards.

## Per-secret procedures

### `APP_ENCRYPTION_KEY` (rules §3)

Used by `src/lib/security/crypto.ts` + pgcrypto to encrypt PII columns.
**Rotating this alone will not re-encrypt existing rows.** You must run
an offline re-encryption migration.

1. Generate a new 64-hex-char key locally:
   ```bash
   openssl rand -hex 32
   ```
2. Deploy a version of the app with both keys set:
   ```env
   APP_ENCRYPTION_KEY="new-key…"
   APP_ENCRYPTION_KEY_PREV="old-key…"
   ```
3. Run the re-encryption migration:
   ```bash
   pnpm supabase migration new reencrypt_hris_pii
   # write a DO $$ … $$ block that:
   #   select id, encrypted_pii from employees;
   #   decrypt with APP_ENCRYPTION_KEY_PREV
   #   re-encrypt with APP_ENCRYPTION_KEY
   #   update employees set encrypted_pii = <new>;
   pnpm db:push
   ```
4. Confirm zero rows still use the old key by running the migration in
   dry-run mode a second time (must report `0 rows updated`).
5. Deploy a version that removes `APP_ENCRYPTION_KEY_PREV`.

Smoke test: `pnpm test src/lib/security/crypto` — encrypt/decrypt
roundtrip must pass against the new key.

### `SUPABASE_SERVICE_ROLE_KEY` (rules §3, §22)

Server-only credential for `createServiceRoleClient()`. Reset in the
Supabase dashboard → **Settings → API**. Rotation is atomic — the old
key stops working the moment the new one is issued.

1. In Supabase → Settings → API → **Roll service role key**.
2. Copy the new key into your platform secret store (Vercel, GH Actions,
   Docker Secrets).
3. Redeploy. The next deploy picks up the new key.
4. Watch `/api/cron/retention` and `/api/cron/digest` for the next
   scheduled run — `cron_run_log.status` must show `SUCCESS`.

Smoke test:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-tenant>/api/cron/digest?dry_run=true
# expect: { "status": "success", "dry_run": true, … }
```

### `CRON_SECRET` (rules §20, §22)

Shared secret between the scheduler (Vercel Cron / external) and
`/api/cron/*`. Generate:
```bash
openssl rand -hex 32
```

1. Update the platform env var (Vercel → Project Settings → Environment
   Variables). Set for **Production** first, then Preview, then Dev.
2. Redeploy Production.
3. Wait for the next natural cron tick; verify `cron_run_log` shows
   `SUCCESS`.
4. If Vercel Cron misses a run (401 from the app), the platform will
   retry with the new secret automatically.

### `SENTRY_DSN` / `AXIOM_TOKEN` (rules §21)

Rotate independently — the sink resolver caches at process start.

**Sentry**
1. Project Settings → **Client Keys (DSN)** → **Generate New Key** →
   **Delete Old Key** *after* the redeploy.
2. Update `SENTRY_DSN` in the platform secret store.
3. Redeploy.
4. Trigger a smoke error and confirm it lands in Sentry:
   ```bash
   curl -s -X POST https://<tenant>/api/observability/report \
     -H "content-type: application/json" \
     -H "referer: https://<tenant>/" \
     -d '{"level":"error","msg":"post-rotation smoke test"}'
   ```

**Axiom**
1. Axiom → **Settings → API Tokens** → **New Token** with `ingest` scope
   for the target dataset.
2. Deploy with the new token; delete the old token from the Axiom UI
   after `cron_run_log` shows one successful cycle.

### `OPENAI_API_KEY` (rules §15)

Only used by AI Insights. If AI is not wired for a tenant, this rotation
is a no-op — the provider selector falls back to `mock`.

1. Provider dashboard → rotate key.
2. Update platform env.
3. Redeploy.
4. Trigger a manual insight generation from `/insights` to smoke-test.

**Cost cap check** — after rotation, verify Redis `ai_tokens:<tenant>:<date>`
counter is still incrementing to catch any silent 401s that would look
like "AI is working" but never bill.

### `SMTP_PASS` (rules §20)

Transactional email (digest, approval notifications).

1. Provider dashboard (Resend, Postmark, SES) → rotate SMTP credentials.
2. Update platform env.
3. Redeploy.
4. Wait for the next 08:00 WIB digest tick, then check `email_outbox`
   for `status = 'SENT'` rows.

If the provider is misconfigured, `sendEmail()` returns `SKIPPED` — the
outbox will show `SKIPPED` status per row rather than failure. Fix the
provider config and re-trigger the digest manually via
`?dry_run=false&target_tenant=<uuid>` (TODO — currently the digest runs
all tenants).

### `NEXT_PUBLIC_SUPABASE_ANON_KEY` (rules §3)

Publicly-exposed but tenant-scoped via RLS. Rotate on Supabase's own
schedule (usually 12+ months). Rotating this key **requires a deploy**
because the value is baked into the client bundle at build time.

## Emergency rotation (compromise)

If any secret is suspected compromised:

1. Immediately rotate in the provider dashboard.
2. **Do not** wait for the standard deploy window — force-deploy.
3. Audit `security_audit_logs` for the last 90 days:
   ```sql
   select actor_role, action_type, resource_name, created_at, ip_address
   from public.security_audit_logs
   where tenant_id = '<tenant>'
     and created_at > now() - interval '90 days'
   order by created_at desc;
   ```
4. Rotate every dependent secret in the same category (e.g. if
   `SUPABASE_SERVICE_ROLE_KEY` leaked, rotate `CRON_SECRET` too, since
   they share the same runtime).
5. Post-mortem: publish a compliance note within 72 hours. Indonesian
   PDP / UU ITE requires disclosure to affected data subjects if PII was
   accessed.

## Automation

Rotation compliance is enforced by two moving pieces landed in migration
`0018_secret_rotations.sql`:

### 1. `public.secret_rotations` registry

A cross-tenant table listing every tracked secret with `last_rotated_at`,
`priority`, `rotation_interval_days` (default 90), and `purpose`. Seed
rows match the table at the top of this runbook. The table is INSERT +
UPDATE only — deletes are blocked by a trigger, so an accidental
`delete from secret_rotations` cannot destroy the compliance trail. RLS
gives SELECT to TENANT_ADMIN + GENERAL_MANAGER and UPDATE to
TENANT_ADMIN only.

### 2. `/api/cron/rotation-check` cron endpoint

Runs weekly (Monday 09:00 WIB — `0 2 * * 1` UTC in `vercel.json`).
Every invocation:

1. Reads `secret_rotations` and computes `severity`:
   `OK` when ≥15 days remain, `WARN` when ≤14, `OVERDUE` when past due.
2. Records a `cron_run_log` row with the WARN + OVERDUE names and
   day counters (never the values).
3. Enqueues a `SYSTEM` notification to every ACTIVE TENANT_ADMIN with a
   deep-link to `/settings/secrets`.

Query params:

- `?dry_run=true` — compute + log only, no notifications.

Auth: `Authorization: Bearer $CRON_SECRET` **or**
`x-vercel-cron-signature: $CRON_SECRET`.

### 3. `/settings/secrets` ops UI

TENANT_ADMIN + GENERAL_MANAGER can view the registry at
`/settings/secrets`. The page shows summary badges (Overdue / Warn / OK),
per-row severity + priority, days-until-due, and — for TENANT_ADMIN — a
"Mark rotated" dialog that bumps `last_rotated_at = now()` and records
`last_rotated_by`. Every mark writes an `UPDATE` audit log row on
`secret_rotations`.

### Roadmap

- **Sentry / Axiom bot integration** — auto-generate rotation tickets
  from `cron_run_log` details when OVERDUE ≥ 1.
- **Secret-manager sync** — reconcile `last_rotated_at` against the
  team secret manager's rotation history via a nightly sync job.
- **Slack digest** — mirror the Monday cron result to `#ops-alerts` for
  team-wide visibility.
