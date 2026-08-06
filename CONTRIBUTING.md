# Contributing to ControlDesk

Thanks for wanting to improve ControlDesk. This guide covers the mechanical
+ conventional bits. The **product + engineering rules** are in
[`.cursorrules`](.cursorrules) — read it before your first PR, because it
is enforced in review.

## Quickstart

```bash
git clone git@github.com:<owner>/controldesk.git
cd controldesk
pnpm install
pnpm db:start        # local Supabase stack
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
# APP_ENCRYPTION_KEY (>=32 hex chars), CRON_SECRET
pnpm db:reset        # applies migrations + seed
pnpm dev             # http://demo.localhost:3000
```

See [`docs/getting-started.md`](docs/getting-started.md) for the long
version + troubleshooting.

## Before you start coding

1. **Read `.cursorrules`.** All 24 sections are load-bearing. The PR
   template forces you to cross off which sections your change touches.
2. **Skim the ops runbooks** if your change touches financial data,
   observability, or secrets:
   - [`docs/ops/data-retention.md`](docs/ops/data-retention.md)
   - [`docs/ops/observability.md`](docs/ops/observability.md)
   - [`docs/ops/secret-rotation.md`](docs/ops/secret-rotation.md)
3. **Open an issue first** for anything larger than a small bug fix. The
   feature-request template is designed to make product alignment fast.

## Feature folder contract (rules §17)

Every new business module MUST follow this layout:

```
src/app/(app)/[module]/
├── page.tsx                    # RSC list / detail
├── loading.tsx                 # optional
├── error.tsx                   # optional segment error boundary
├── actions.ts                  # Server Actions, all wrapped in withSecureAction()
├── new-[module]-sheet.tsx      # optional client component
├── [module]-action-buttons.tsx # optional client component
└── ...
src/lib/validation/[module].ts  # Zod schemas — single source of truth
src/lib/data/[module].ts        # optional cached query helpers
src/lib/[module]/state.ts       # optional state machine helper
```

### Server Action contract

```ts
"use server";
import { withSecureAction } from "@/lib/security/action-wrapper";
import { mySchema } from "@/lib/validation/my-module";

export const createFooAction = withSecureAction({
  schema: mySchema,
  resource: "foo",                 // must be a ResourceType in pdp.ts
  action: "create",
  auditAction: "CREATE",
  auditResourceName: "foos",
  resolveAttributes: async (input, ctx) => ({
    tenantId: ctx.actor.tenantId,
    projectId: input.project_id,
  }),
  handler: async (input, ctx) => {
    // ... mutation ...
    return {
      result: { id: inserted.id },
      auditResourceId: inserted.id,
      auditNewValues: { /* snapshot */ },
    };
  },
});
```

Return type is always `ActionResult<T>` — never throw errors up to the
client. See `src/lib/security/action-wrapper.ts` for the wrapper source.

## Migrations (rules §22)

- Filename: `NNNN_short_snake_case.sql` (4-digit increment, no gaps).
- **Never edit a migration that has landed on `main`.** Ship a new one
  instead. The retention runbook enforces this — the compliance trail
  breaks if migrations are edited in place.
- Header comment MUST include a rollback SQL block.
- New tenant-scoped tables MUST include: `tenant_id uuid not null`,
  `enable row level security`, at least one policy predicating on
  `public.current_tenant_id()`, and an index on `(tenant_id, ...)`.
- Global infrastructure tables (`secret_rotations`, `cron_run_log`,
  `data_archives`) are the exception — justify in the PR body.

After adding a migration:

```bash
pnpm db:reset      # verify it applies cleanly against a fresh DB
pnpm db:types      # regenerate src/types/database.ts
```

## Money / time / locale hygiene (rules §18)

- **Money** — never use JS `number` for currency. Use `bigint` cents or
  the helpers in `src/lib/format/money.ts`. All DB columns are
  `numeric(18,2)`.
- **Time** — DB is `timestamptz` (UTC). UI uses `formatInTz()` /
  `formatIsoDateInTz()` from `src/lib/format/date.ts`. Never
  `new Date().toISOString().split('T')[0]` for business dates.
- **Locale** — no hardcoded user-facing strings in JSX. Add keys to
  both `messages/id.json` and `messages/en.json` and reference them via
  `useTranslations()` / `getTranslations()`. Key parity is enforced
  by `src/lib/i18n/config.test.ts`.

## Tests (rules §21)

Every PR that touches business logic MUST add or update tests.

- **Unit** — `src/**/*.test.ts` using Vitest. Fast, no I/O. Coverage
  gate: 80 % floor on `src/lib/security/**`.
- **Playwright** — `e2e/*.spec.ts` for critical flows (approval chains,
  auth). Runs against a real Supabase local stack in CI.

```bash
pnpm test                # unit
pnpm test:coverage       # unit + coverage (enforces the 80% gate)
pnpm test:e2e            # Playwright (needs `pnpm db:reset` first)
pnpm test:e2e --ui       # Playwright UI mode for debugging
```

Serial E2E suites (all approval chains) mutate the seed data, so
re-running requires `pnpm db:reset`. This is called out at the top of
each spec file.

## Commit convention

We use Conventional Commits so the changelog + release notes stay
mostly-automatable:

```
<type>(<scope>): <short imperative summary>

<optional body — what and why, never how>
<optional footer — issue links, breaking-change notes>
```

Common types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`,
`perf`, `ci`, `build`. Scopes match the feature folders
(`finance`, `hr`, `handovers`, `settings`, `ai`, `retention`, `security`,
`observability`, `i18n`, `nav`, `ci`, `deps`).

## PR workflow

1. Branch off `main`. Push early, keep the PR draft until CI is green.
2. Fill in the PR template completely. Empty sections signal "not
   applicable" — do not delete headings.
3. CI must pass — `ci.yml` (typecheck + lint + tests + build) and
   `e2e.yml` (Playwright chains).
4. Ask for review from the surface owner listed in
   [`.github/CODEOWNERS`](.github/CODEOWNERS). At least one review is
   required on `main`.
5. Squash-merge with a Conventional Commit title. Body of the PR
   becomes the commit body.
6. If your change ships user-facing behaviour, add a line to
   [`CHANGELOG.md`](CHANGELOG.md) under `## [Unreleased]`.

## Local development tips

- `pnpm dev` runs Next.js in Turbopack mode. Turbopack is stricter than
  webpack about certain module patterns — if you see a build error only
  in dev, try `pnpm build && pnpm start` to reproduce.
- The subdomain guard in `proxy.ts` will sign you out if the JWT's
  `tenant_slug` claim mismatches the host. If you're stuck in a redirect
  loop, clear cookies for `*.localhost`.
- Supabase Studio ships at `http://127.0.0.1:54323` after
  `pnpm db:start`. Use it to inspect RLS enforcement manually.
- Mailpit runs on `http://localhost:8025` when using Docker Compose.
  All outbound email during dev lands there.

## Getting help

- **Product / rulebook** questions — comment on `.cursorrules` in a PR
  or open a `discussion`.
- **Bug** — [file an issue](../../issues/new/choose) with the bug
  template.
- **Security** — [SECURITY.md](SECURITY.md), private disclosure only.
