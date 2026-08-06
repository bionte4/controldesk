# Testing

ControlDesk enforces the rulebook §21 testing contract:

- **Vitest** for unit + integration in Node.
- **Playwright** for browser-driven critical flows.
- **Coverage floor** on `src/lib/security/**` — 80 % or CI fails.

Everything below is what CI runs. Reproduce locally before pushing.

## The two runners at a glance

| Runner     | Command                        | Runtime | Scope                                    |
| ---------- | ------------------------------ | ------- | ---------------------------------------- |
| Vitest     | `pnpm test`                    | Node    | `src/**/*.test.ts`                       |
| Vitest+cov | `pnpm test:coverage`           | Node    | `src/**/*.test.ts` + v8 coverage report  |
| Playwright | `pnpm test:e2e`                | Chromium| `e2e/*.spec.ts`                          |

## Vitest — unit + integration

Config: [`vitest.config.ts`](../vitest.config.ts).

- Uses `vite-tsconfig-paths` so `@/…` aliases resolve exactly like at
  runtime.
- Aliases `server-only` to a stub — server-flagged modules are safe to
  import in the test runner.
- Coverage reporter is `v8`, output at `coverage/`.

### What we test with Vitest

- **Zod schemas** (`src/lib/validation/*.test.ts`) — happy path,
  boundary values, malformed input, injected control characters.
- **PDP decisions** (`src/lib/security/pdp.test.ts`) — one row per
  actor × action × resource × outcome. This is the security posture
  of the whole app — keep it exhaustive.
- **State machines** (`src/lib/*/state.test.ts`) — transitions that
  the DB constraint allows AND transitions the DB rejects.
- **Format helpers** (`src/lib/format/money.test.ts`,
  `date.test.ts`) — no float drift, no timezone bugs, no locale drift.
- **Observability sinks** (`src/lib/observability/*.test.ts`) —
  adversarial redaction inputs (nested tokens, base64, hex, JWT-shaped).
- **AI redaction** (`src/lib/ai/redact.test.ts`) — cannot leak PII
  even when the payload embeds it deep in unstructured text.
- **Retention verify** (`src/lib/retention/verify.test.ts`) —
  checksum recomputation + status transitions.
- **Rotation status** (`src/lib/security/rotation.test.ts`) —
  window math + threshold buckets.
- **i18n parity** (`src/lib/i18n/config.test.ts`) — every key in
  `id.json` exists in `en.json` and vice versa.

### Coverage gate

```ts
// vitest.config.ts (excerpt)
coverage: {
  provider: "v8",
  thresholds: {
    "src/lib/security/**": {
      statements: 80,
      branches: 80,
      functions: 80,
      lines: 80,
    },
  },
},
```

Running `pnpm test:coverage` will fail the process (and CI) if any of
the four metrics drops below 80 %. Additional per-module targets
(rules §21 recommends 60 % for business logic) are informational for
now — enforce them per-module as your domain area matures.

### Test data conventions

- Use inline objects — do not import from `supabase/seed.sql`.
- Fake data goes in the top of the test file. If the same fixture is
  reused across ≥3 files, promote to `src/**/__fixtures__/*.ts`.
- Never touch the live DB from a Vitest suite. If a test needs
  Supabase, write it as a Playwright suite instead.

## Playwright — critical flows

Config: [`playwright.config.ts`](../playwright.config.ts).

- Single project: `chromium` desktop.
- Base URL: `http://demo.localhost:3000` (uses the seeded demo
  tenant). Override with `PLAYWRIGHT_BASE_URL`.
- Web server: `pnpm dev` is auto-started unless
  `PLAYWRIGHT_SKIP_WEBSERVER=1`.
- Retries: 2 in CI, 0 locally. Full trace + screenshot + video on
  failure.

### Chain suites

Every approval chain has an end-to-end Playwright walkthrough:

| Suite                              | Chain                                                 |
| ---------------------------------- | ----------------------------------------------------- |
| `e2e/auth-login.spec.ts`           | Cross-tenant login guards, sign-out, role gating.     |
| `e2e/expense-chain.spec.ts`        | Expense submit → L1 → L2 → Finance approve.           |
| `e2e/cash-advance-chain.spec.ts`   | CA request → Finance disburse → Settlement → SETTLED. |
| `e2e/petty-cash-chain.spec.ts`     | Custodian voucher → Replenishment → Finance approve.  |
| `e2e/hr-requests-chain.spec.ts`    | OT + SICK approval paths.                             |
| `e2e/hr-leave-chain.spec.ts`       | LEAVE full chain: Sup → PM → OM → HR.                 |
| `e2e/pm-handover-chain.spec.ts`    | Handover request → OM → HM → execution + PM swap.     |
| `e2e/approvals-inbox.spec.ts`      | Unified approval inbox realtime + role filter.        |
| `e2e/insights-page.spec.ts`        | AI insight page renders + role gate.                  |

### Running Playwright locally

```bash
# 1. Reset the DB so the chain suites have a clean starting state.
pnpm db:reset

# 2. Start the dev server. Leave it running.
pnpm dev

# 3. In another shell, run the tests.
pnpm test:e2e                              # full suite
pnpm test:e2e -g "expense chain"           # narrow by name
pnpm test:e2e --ui                         # Playwright UI mode
PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm test:e2e  # against existing dev server
```

Serial suites (all chain suites) mutate the seed. Re-run requires
`pnpm db:reset`. Each chain spec's docstring calls this out.

### Playwright + CI

The [`e2e.yml`](../.github/workflows/e2e.yml) workflow does:

1. Adds `demo.localhost` → `127.0.0.1` to `/etc/hosts`.
2. Installs pnpm + Node 20 + Supabase CLI + Playwright browsers
   (cached).
3. Runs `supabase start`, extracts anon + service_role keys.
4. Runs `pnpm db:reset` (migrations + seed).
5. Runs `pnpm test:e2e --reporter=github,html`.
6. On failure, uploads the HTML report + traces + videos as an
   artifact.

Turnaround: ~7-10 minutes end-to-end.

## Adding a new test

### Unit

```bash
# 1. Colocate the test next to the code under test.
touch src/lib/foo/bar.test.ts

# 2. Import + write.
# 3. Run in watch mode.
pnpm test:watch src/lib/foo/bar.test.ts
```

Follow the "arrange / act / assert" pattern. Prefer many small
`describe` blocks over a giant one — Vitest's grep operates at the
describe level.

### Playwright

```bash
cp e2e/expense-chain.spec.ts e2e/my-flow.spec.ts
# adapt names, selectors, and assertions
pnpm db:reset
pnpm test:e2e -g "my flow"
```

Follow the existing patterns:

- Log in with a role-typed helper (`signInAs("supervisor")`).
- Use `data-testid` for stable selectors — never CSS classnames.
- Assert on both DOM state AND the audit trail row (query via
  Supabase Studio in dev — Playwright itself doesn't touch the DB
  outside auth).

## What NOT to test

- Third-party library internals (Supabase client, Next.js runtime).
- Trivial getters/setters that carry no domain logic.
- Auto-generated types (`src/types/database.ts`).

## Debugging failing tests

### Vitest: unhelpful stack trace

`pnpm test -- --reporter=verbose --no-file-parallelism` — serialises
files and prints per-test timings.

### Playwright: flake in CI, green locally

- Timing sensitivity. Add `await expect(...).toBeVisible()` instead
  of relying on `setTimeout`.
- Race condition on Supabase auth. Ensure the previous test signed
  out (or use isolated auth state via `test.use({ storageState: ... })`).
- Seed drift. Confirm `pnpm db:reset` ran and no other test polluted
  state (chain suites should be `test.describe.configure({ mode: "serial" })`).

### CI-only failure

Download the Playwright HTML report from the workflow's artifacts.
Open `playwright-report/index.html` in your browser — trace viewer
lets you scrub through the failing test frame-by-frame.
