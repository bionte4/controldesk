# Getting started

Boot ControlDesk locally in ~10 minutes.

## Prerequisites

| Tool          | Minimum                | Install                                            |
| ------------- | ---------------------- | -------------------------------------------------- |
| Node.js       | 20.10                  | `brew install node@20` / [nvm](https://github.com/nvm-sh/nvm) |
| pnpm          | 9.0                    | `corepack enable && corepack prepare pnpm@9.12.0 --activate` |
| Docker        | 24 (Docker Desktop, OrbStack, or Colima) | Vendor site — required for `supabase start`. |
| Supabase CLI  | 2.20                   | `brew install supabase/tap/supabase`                |

Confirm they resolve:

```bash
node --version   # v20.x
pnpm --version   # 9.x
docker info      # daemon reachable
supabase --version
```

## First-run script

```bash
git clone git@github.com:<owner>/controldesk.git
cd controldesk
pnpm install

# 1. Boot local Supabase (Postgres + GoTrue + Storage + Studio).
pnpm db:start

# 2. Fill in the local env file.
cp .env.local.example .env.local
# Then paste the anon / service_role keys from:
supabase status
# and set APP_ENCRYPTION_KEY (64 hex chars) + CRON_SECRET.

# 3. Apply every migration + load the demo seed.
pnpm db:reset

# 4. Regenerate the DB TypeScript types (optional, but recommended
#    after every migration change).
pnpm db:types

# 5. Run the dev server.
pnpm dev
```

Open **http://demo.localhost:3000** and log in with the seeded users.

## Seeded demo users

Password for all seeded accounts: `ControlDesk#2026`.

| Role                 | Email                                       |
| -------------------- | ------------------------------------------- |
| Tenant Admin         | `admin@demo.controldesk.app`                |
| General Manager      | `gm@demo.controldesk.app`                   |
| Head Manager         | `hm@demo.controldesk.app`                   |
| Operations Manager   | `om@demo.controldesk.app`                   |
| Project Manager      | `pm@demo.controldesk.app`                   |
| Project Manager 2    | `pm2@demo.controldesk.app`                  |
| Supervisor           | `supervisor@demo.controldesk.app`           |
| Employee             | `employee@demo.controldesk.app`             |
| Lead Finance         | `finance@demo.controldesk.app`              |
| HR Admin             | `hr@demo.controldesk.app`                   |
| Petty Cash Custodian | `pettycash@demo.controldesk.app`            |

Each user is on the demo tenant (`demo`). Try the flows:

- Approvals inbox — sign in as `supervisor@` or `pm@` and open
  `/approvals`.
- Cash Advance chain — `finance@` → `/finance/cash-advances`.
- HR requests — `hr@` → `/hr/requests`.
- AI Insights — `admin@` → `/insights` (uses the mock provider when
  `OPENAI_API_KEY` is unset).
- Cold-archive registry — `admin@` → `/settings/archives`.
- Secret rotation — `admin@` → `/settings/secrets`.

To create a fresh workspace, open the apex-domain register page:
**http://localhost:3000/register**. Subdomain-scoped register is
admin-invitation-only per rules §6.

## Local subdomain routing

macOS + Linux resolve `*.localhost` → `127.0.0.1` out of the box, so
`demo.localhost:3000`, `acme.localhost:3000`, etc. all route to the same
Next.js dev server. On Windows without WSL, add entries to
`C:\Windows\System32\drivers\etc\hosts`.

Cross-tenant guard: [`proxy.ts`](../proxy.ts) verifies the JWT's
`tenant_slug` claim matches the host on every request. Mismatch → the
session is signed out. This is enforced independently of RLS as a
defence-in-depth layer.

## Common workflows

### Reset the local DB

`pnpm db:reset` — drops + reapplies every migration + reloads the seed.
Use this whenever a Playwright serial suite has run to completion, since
those suites mutate the seed.

### Add a migration

```bash
pnpm db:diff -f my_new_feature
# writes supabase/migrations/NNNN_my_new_feature.sql
```

Edit the generated file, add a rollback header, and re-run
`pnpm db:reset` to apply. See [`development.md`](development.md) for the
full migration checklist.

### Trigger a cron endpoint manually

```bash
# Retention job (default: dry run)
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  http://demo.localhost:3000/api/cron/retention?dry_run=true

# Archive job for 2024 audit logs
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "http://demo.localhost:3000/api/cron/archive?target=security_audit_logs&year=2024"

# Rotation reminder cron
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  http://demo.localhost:3000/api/cron/rotation-check
```

See [`api-reference.md`](api-reference.md) for the full endpoint list.

### Switch language

Toggle 🇮🇩 / 🇬🇧 in the topbar. Preference persists in the `NEXT_LOCALE`
cookie for one year.

## Troubleshooting

### `supabase start` fails with "Docker daemon not reachable"

Start Docker Desktop (macOS/Win) or `colima start` (macOS CLI). Then
`docker info` should print a daemon line.

### `pnpm db:reset` hangs on "Applying migrations"

Usually a migration syntax error or an earlier migration that depends
on the `pgcrypto` extension. Check `supabase logs db` and confirm the
first migration (`0001_extensions.sql`) landed.

### Login returns "Invalid login credentials" after a Docker restart

Symptom: you can reach `demo.localhost:3000/login`, the form renders,
but every seeded account (`admin@demo.controldesk.app` /
`ControlDesk#2026`) is rejected as **Invalid login credentials**.

Root cause: the `supabase_db_controldesk` container was recycled
(Docker Desktop update, `supabase stop && start`, laptop restart, or a
manual `docker compose down`) and re-initialised with an empty volume.
Migrations replay automatically, but **`supabase/seed.sql` does not** —
so `auth.users` and `public.employees` come back at 0 rows.

Verify with:

```bash
docker exec supabase_db_controldesk psql -U postgres -d postgres -tAc \
  "select count(*) from auth.users; select count(*) from public.employees;"
```

Both should be `14` after seeding. If they're `0`, run one of:

```bash
# Preferred — replays every migration and re-seeds (~5-10 s).
pnpm db:reset

# Or, when migrations are already applied and you only need the seed
# (much faster, ~1 s, does not touch schema):
docker exec -i supabase_db_controldesk psql -U postgres -d postgres \
  < supabase/seed.sql
```

Then re-test the auth endpoint before opening the browser:

```bash
curl -s -X POST 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@demo.controldesk.app","password":"ControlDesk#2026"}' \
  -o /dev/null -w "http: %{http_code}\n"
# Expect: http: 200. A 400 with error_code=invalid_credentials means the
# seed has not landed yet.
```

**Recovery credentials (all seeded accounts share this password):**

| Field    | Value                                        |
| -------- | -------------------------------------------- |
| Email    | `admin@demo.controldesk.app` (Tenant Admin)  |
| Password | `ControlDesk#2026`                           |
| Tenant   | `demo` → open `http://demo.localhost:3000`   |

See the [Seeded demo users](#seeded-demo-users) table above for the
full role → email mapping.

### Post-login navigation feels slow on `pnpm dev`

Symptom: after clicking **Sign in**, the browser hangs on the loading
spinner for 5–20 seconds before the dashboard renders. Subsequent
navigations feel snappy.

Root cause: **Turbopack compiles routes on demand.** The first request
to each route (`/dashboard`, `/finance/expenses`, `/settings/**`, etc.)
after a fresh `pnpm dev` — or any restart with `rm -rf .next` — triggers
a synchronous compile of the route's module graph plus the proxy
middleware. Next.js dev logs report this compile time inside the
`proxy.ts:` and `application-code:` buckets, which makes it look like
the app is slow, when in reality the timer is bounded by Turbopack.

Typical timing profile of a cold dev server:

| Hit                     | `proxy.ts` | `application-code` | Total    |
| ----------------------- | ---------- | ------------------ | -------- |
| 1st hit `/dashboard`    | 7.3 s      | 9.3 s              | ~17 s    |
| 2nd hit `/dashboard`    | 1.5 s      | 1.6 s              | ~1.7 s   |
| Warm hit `/dashboard`   | 16 ms      | 344 ms             | ~400 ms  |

Once every route in the user's flow is compiled once, it stays cached
until code changes invalidate it.

**Option 1 — accept it (default).** Cold-compile penalty is unavoidable
in dev mode. Live-reload is worth the trade-off while writing code.

**Option 2 — warm up the dev server with a one-shot curl loop.** Run
this once right after `pnpm dev` reports `Ready`:

```bash
for path in / /login /dashboard \
            /finance/expenses /finance/cash-advances /finance/budgets \
            /projects /hr/requests /timesheets \
            /approvals /insights \
            /settings /settings/integrations \
            /settings/integrations/ai /settings/integrations/smtp \
            /settings/integrations/telegram-bot \
            /settings/integrations/whatsapp-business \
            /settings/preferences; do
  curl -s -o /dev/null -H "Host: demo.localhost" \
    "http://127.0.0.1:3000${path}" \
    -w "${path}: %{time_total}s\n"
done
```

The first pass takes ~30–60 s; every user request after that is < 500 ms.
Protected routes will 307-redirect to `/login` — that's fine, the
compile still happens.

**Option 3 — use the pre-built prod container on `:3001`.** For
testing / demo (not coding), `docker compose --profile prod up` boots a
Next.js standalone build where every route is compiled at image-build
time. Cold hit ≈ 200 ms, warm hit ≈ 150 ms. Same Supabase, same seed —
just swap the port:

- Dev (Turbopack, HMR): **http://demo.localhost:3000**
- Prod (pre-built, no HMR): **http://demo.localhost:3001**

See [`development.md`](development.md) for the full dev vs prod matrix.

### The subdomain doesn't resolve

Windows without WSL is the common culprit. Add:

```
127.0.0.1  demo.localhost
127.0.0.1  acme.localhost
```

to `C:\Windows\System32\drivers\etc\hosts` and restart the browser.

### `pnpm test:e2e` fails with "connection refused"

Playwright starts `pnpm dev` for you but only if the server isn't
already up. If a previous `pnpm dev` is running with a broken build,
`playwright test` will hit an error page. Kill the dev server first,
then re-run.

### `Cannot find module 'server-only'` in a test

The `vitest.config.ts` aliases `server-only` to an empty stub. If a new
test file imports a server-only module transitively, the alias should
still apply. If it doesn't, add the module path to the alias block.

## Next reads

- [`architecture.md`](architecture.md) — how the pieces fit.
- [`development.md`](development.md) — how to add a feature.
- [`security-model.md`](security-model.md) — how to write a Server Action.
