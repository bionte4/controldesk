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
