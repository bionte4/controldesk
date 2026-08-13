# ControlDesk

A multi-tenant BPO / Managed Services ERP built on **Next.js 16**,
**Supabase**, **Shadcn UI**, and the **Vercel AI SDK**. Everything is
tenant-per-subdomain, RSC-first, and gated by a four-layer security
model (Proxy → Auth → PDP → RLS).

> **New here?** Start at [`docs/getting-started.md`](docs/getting-started.md).
> **Building a feature?** Read [`docs/development.md`](docs/development.md).
> **On call?** [`docs/ops/`](docs/ops/) has the runbooks.

## Table of contents

- [Highlights](#highlights)
- [Documentation index](#documentation-index)
- [Tech stack](#tech-stack)
- [First run](#first-run)
- [Local subdomain routing](#local-subdomain-routing)
- [Commands](#commands)
- [Directory map](#directory-map)
- [Contributing + Security](#contributing--security)
- [License](#license)

## Highlights

- **Multi-tenant by construction.** Every request resolves a tenant
  slug from its subdomain, and every mutation is checked against the
  JWT's `tenant_id` claim + RLS in Postgres.
- **Enterprise-grade security posture.** PDP/PEP + immutable audit
  trail + Redis rate limiting + at-rest encryption for HRIS PII +
  PII redaction on AI prompts + 90-day secret rotation.
- **RSC-first + Server Actions.** `withSecureAction()` wraps every
  mutation with auth → Zod → PDP → mutation → audit in one call site.
- **Observable and operable.** Structured JSON logs, pluggable
  Sentry / Axiom sinks, client crash reporter, request-ID
  propagation, cold-storage archive registry with SHA-256
  verification, weekly rotation reminder cron.
- **A11y-first UI.** Shadcn (base-nova) + Tailwind v4 + Framer Motion
  with `useReducedMotion()` guards. Light + dark. `id` / `en` locale
  toggle. Command Palette (Cmd+K). Slide-over drawers for Unified
  Approval Inbox + Cash Advance settlements.
- **Battle-tested.** 373 Vitest tests, 38 Playwright tests across 9
  chain suites, 80 % coverage floor on `src/lib/security/**`.

## Documentation index

Fastest entry point: **[`docs/README.md`](docs/README.md)** — indexed by
audience (business owner / end user / engineer / auditor / on-call).

### Product & business

| Doc                                                                              | Read when                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`docs/product/overview.md`](docs/product/overview.md)                           | Understand what ControlDesk is and who it's for.       |
| [`docs/product/glossary.md`](docs/product/glossary.md)                           | Bilingual EN/ID business + technical terms.            |
| [`docs/product/roles-and-permissions.md`](docs/product/roles-and-permissions.md) | 10-role legacy vs 7-role canonical, capability matrix. |
| [`docs/product/approval-workflows.md`](docs/product/approval-workflows.md)       | Threshold matrix + state machines per module.          |

### Business modules

| Doc                                                                              | Read when                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`docs/modules/clients-and-portal.md`](docs/modules/clients-and-portal.md)       | Client master, BPO contracts, Client Portal.           |
| [`docs/modules/projects.md`](docs/modules/projects.md)                           | Projects, assignments, issues, PM handovers.           |
| [`docs/modules/finance.md`](docs/modules/finance.md)                             | Expenses, Cash Advance, Petty Cash, Budget Requests.   |
| [`docs/modules/hris-and-payroll.md`](docs/modules/hris-and-payroll.md)           | HR requests, timesheets (daily + weekly), payroll.     |
| [`docs/modules/ai-and-notifications.md`](docs/modules/ai-and-notifications.md)   | AI insights + notifications system.                    |

### Reference

| Doc                                                                              | Read when                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`docs/reference/database-schema.md`](docs/reference/database-schema.md)         | Schema overview, migration timeline, enums.            |
| [`docs/reference/state-machines.md`](docs/reference/state-machines.md)           | All state machines in one visual page.                 |
| [`docs/env-reference.md`](docs/env-reference.md)                                 | Every `.env` variable, default, and owner.             |
| [`docs/api-reference.md`](docs/api-reference.md)                                 | Cron + health + observability endpoints.               |

### User guides

| Doc                                                                              | Read when                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`docs/user-guides/internal-users.md`](docs/user-guides/internal-users.md)       | Panduan per role internal (Employee / PM / Finance / HR / Admin). |
| [`docs/user-guides/client-portal-users.md`](docs/user-guides/client-portal-users.md) | Panduan untuk klien eksternal yang login via `/portal`. |

### Engineering + ops

| Doc                                                            | Read when                                               |
| -------------------------------------------------------------- | ------------------------------------------------------- |
| [`docs/getting-started.md`](docs/getting-started.md)           | First day, boot the app, sign in.                       |
| [`docs/architecture.md`](docs/architecture.md)                 | Before any non-trivial change.                          |
| [`docs/security-model.md`](docs/security-model.md)             | Before writing any Server Action.                       |
| [`docs/development.md`](docs/development.md)                   | Every day. Feature folder + Server Action contract.     |
| [`docs/testing.md`](docs/testing.md)                           | Before you push. Vitest + Playwright + coverage.        |
| [`docs/qa/README.md`](docs/qa/README.md)                       | QA / QC / Tester playbooks — strategy, E2E, catalog, manual, flake, a11y, bug reporting. |
| [`docs/deployment.md`](docs/deployment.md)                     | Before you deploy. Vercel + Supabase + CI/CD pipeline.  |
| [`docs/ops/data-retention.md`](docs/ops/data-retention.md)     | On-call, retention + archive + restore.                 |
| [`docs/ops/observability.md`](docs/ops/observability.md)       | On-call, Sentry / Axiom configuration.                  |
| [`docs/ops/secret-rotation.md`](docs/ops/secret-rotation.md)   | Quarterly, secret rotation runbook.                     |
| [`CONTRIBUTING.md`](CONTRIBUTING.md)                           | Before your first PR.                                   |
| [`SECURITY.md`](SECURITY.md)                                   | Reporting a vulnerability.                              |
| [`CHANGELOG.md`](CHANGELOG.md)                                 | What changed lately.                                    |
| [`.cursorrules`](.cursorrules)                                 | **Product + engineering source of truth.**              |

## Tech stack

| Layer               | Choice                                                 |
| ------------------- | ------------------------------------------------------ |
| Framework           | Next.js 16 (App Router + RSC, `output: standalone`)    |
| Language            | TypeScript (strict)                                    |
| Styling             | Tailwind CSS v4 + Shadcn UI (`base-nova`)              |
| Motion              | Framer Motion (with `useReducedMotion` guards)         |
| Charts              | Recharts + Tremor                                      |
| Data + Auth         | Supabase (Postgres 17, RLS, GoTrue, custom JWT hook)   |
| Forms               | React Hook Form + Zod                                  |
| i18n                | `next-intl` (Bahasa Indonesia default, English)        |
| Dates               | `date-fns` + `date-fns-tz` (tenant-scoped TZ)          |
| AI                  | Vercel AI SDK (`generateObject`) + PII redact + cost cap |
| Cache / Rate limit  | Redis (docker-compose service)                         |
| Email               | Nodemailer + `email_outbox` audit trail                |
| Testing             | Vitest + `@vitest/coverage-v8` + Playwright            |
| Container           | Multi-stage Node 20 Alpine → standalone runtime        |
| Package manager     | pnpm 9                                                 |
| Observability       | Structured JSON logs + Sentry / Axiom sink             |

## First run

```bash
# 1. Install deps.
pnpm install

# 2. Boot the local Supabase stack (Postgres + GoTrue + Storage + Studio).
pnpm db:start

# 3. Copy env and paste the anon / service_role keys from `supabase status`.
cp .env.local.example .env.local
# → set NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#   APP_ENCRYPTION_KEY (>=32 hex chars, random), CRON_SECRET.

# 4. Apply migrations + demo seed.
pnpm db:reset

# 5. Regenerate DB types (optional but recommended).
pnpm db:types

# 6. Run the app.
pnpm dev                           # Next.js dev (recommended)
docker compose --env-file .env.local up -d --build   # OR the full production-shape stack
```

Open **[http://demo.localhost:3000](http://demo.localhost:3000)** and
sign in. See [`docs/getting-started.md`](docs/getting-started.md) for
the seeded user list + troubleshooting.

## Local subdomain routing

macOS + Linux resolve `*.localhost` → `127.0.0.1` out of the box, so
`demo.localhost:3000`, `acme.localhost:3000`, etc. all Just Work. On
Windows without WSL, add entries to
`C:\Windows\System32\drivers\etc\hosts`.

Cross-tenant isolation is enforced by
[`proxy.ts`](proxy.ts) — the JWT carries `tenant_id`, `tenant_slug`,
`role`, `employee_id` claims (see
[supabase/migrations/0003_rls_helpers.sql](supabase/migrations/0003_rls_helpers.sql)),
and mismatches force a sign-out.

## Commands

| Command                        | Description                                                        |
| ------------------------------ | ------------------------------------------------------------------ |
| `pnpm dev`                     | Start Next.js dev server (Turbopack).                              |
| `pnpm build`                   | Production build (emits `.next/standalone`).                       |
| `pnpm start`                   | Serve the standalone bundle.                                       |
| `pnpm lint`                    | Run ESLint.                                                        |
| `pnpm typecheck`               | `tsc --noEmit`.                                                    |
| `pnpm test`                    | Run Vitest suites once.                                            |
| `pnpm test:watch`              | Vitest in watch mode.                                              |
| `pnpm test:coverage`           | Vitest with v8 coverage (`src/lib/security/**` floor 80 %).        |
| `pnpm test:e2e`                | Playwright chain suites (requires a fresh `pnpm db:reset`).        |
| `pnpm test:e2e:ui`             | Playwright UI mode for debugging.                                  |
| `pnpm db:start`                | `supabase start` — spin up Postgres + Studio + Inbucket.           |
| `pnpm db:stop`                 | Stop the local Supabase stack.                                     |
| `pnpm db:reset`                | Drop + reapply all migrations + reload seed.                       |
| `pnpm db:types`                | Regenerate `src/types/database.ts` from the local DB.              |
| `pnpm db:diff -f <name>`       | Snapshot pending schema changes to a new migration.                |
| `docker compose --env-file .env.local up -d --build` | Build + run the containerised stack (`app` + `redis` + `mailpit`). `--env-file` is required because `NEXT_PUBLIC_*` values are baked at build-time and Compose doesn't read `.env.local` for `build.args` by default. |

## Directory map

```text
controldesk/
├── proxy.ts                            # Next 16 tenant guard + request-id
├── Dockerfile                          # Multi-stage Node 20 Alpine → standalone
├── docker-compose.yml                  # app + redis + mailpit
├── vercel.json                         # Cron schedules
├── .github/                            # Workflows + templates + CODEOWNERS
├── docs/                               # This tree — everything below README
├── e2e/*.spec.ts                       # Playwright chain suites (9 files, 38 tests)
├── supabase/
│   ├── migrations/0001..0018_*.sql     # Landed migrations — never edit in place
│   └── seed.sql                        # Demo tenant + one user per role
├── messages/{id,en}.json               # next-intl dictionaries — parity-tested
└── src/
    ├── app/
    │   ├── (auth)/{login,register}/    # Auth pages + Server Actions
    │   ├── (app)/                      # Signed-in shell
    │   │   ├── layout.tsx              # Sidebar + Topbar + Command palette
    │   │   ├── dashboard/
    │   │   ├── clients/, projects/, team/
    │   │   ├── finance/{expenses, cash-advances, petty-cash, budgets}/
    │   │   ├── hr/{roster, timesheets, requests, payroll}/
    │   │   ├── handovers/
    │   │   ├── approvals/, insights/, reports/
    │   │   └── settings/{archives, secrets}/
    │   └── api/
    │       ├── cron/{digest, retention, archive, rotation-check}/
    │       ├── observability/report/
    │       ├── health/, ready/, version/
    │       └── auth/callback/
    ├── components/
    │   ├── i18n/language-toggle.tsx
    │   ├── shell/{app-sidebar, app-topbar, command-palette, ai-insights-badge, ...}
    │   ├── theme/
    │   └── ui/                         # Shadcn primitives
    ├── lib/
    │   ├── security/                   # pdp, action-wrapper, audit, rate-limit, crypto, rotation
    │   ├── observability/              # log, sink, client-report
    │   ├── retention/                  # config, archive, verify
    │   ├── ai/                         # schemas, generators, cost-cap, last-seen, redact
    │   ├── format/                     # money, date
    │   ├── i18n/                       # config, request, actions
    │   ├── nav/config.ts               # Role-filtered sidebar sections
    │   └── validation/                 # Module-scoped Zod schemas
    └── types/database.ts               # Regenerated by `pnpm db:types`
```

## Contributing + Security

- **PRs** — read [`CONTRIBUTING.md`](CONTRIBUTING.md). Every PR uses
  the [PR template](.github/pull_request_template.md) and must pass
  [`ci.yml`](.github/workflows/ci.yml) + [`e2e.yml`](.github/workflows/e2e.yml).
- **Bug reports** — use the [issue template](.github/ISSUE_TEMPLATE/bug_report.yml).
- **Security issues** — private disclosure only, see [`SECURITY.md`](SECURITY.md).
- **Dependency updates** — Dependabot opens grouped PRs weekly per
  [`dependabot.yml`](.github/dependabot.yml).

## License

Proprietary. All rights reserved.
