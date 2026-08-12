# ControlDesk end-to-end tests

These Playwright tests exercise critical user flows against a running
ControlDesk instance. Read this doc before you run or extend them.

## Prerequisites

1. **Local Supabase** running with the migrations applied and `supabase/seed.sql`
   loaded. Bring it up with:

   ```bash
   pnpm db:start
   pnpm db:reset      # applies migrations + seeds
   ```

2. **Local Next.js app** on `http://demo.localhost:3000`. On macOS,
   subdomain routing (see `proxy.ts`) works out of the box because
   `*.localhost` resolves to `127.0.0.1`. On Linux you may need to add:

   ```
   127.0.0.1 demo.localhost
   ```

   to `/etc/hosts`.

3. **Playwright browsers** installed once:

   ```bash
   pnpm exec playwright install --with-deps chromium
   ```

## Running

The `webServer` block in `playwright.config.ts` will run `pnpm dev`
automatically for you. Just:

```bash
pnpm exec playwright test
```

If you already have `pnpm dev` running, tests will reuse it (outside CI).

To skip the auto-spawned server (for example when running against a
production build), set:

```bash
PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=https://staging.controldesk.app pnpm exec playwright test
```

## Fixtures

- Demo credentials come from `supabase/seed.sql`. The tenant slug is `demo`
  and demo passwords are all `ControlDesk#2026`.
- Roles you can log in as: `admin`, `gm`, `hm`, `om`, `pm`, `pm2`,
  `supervisor`, `employee`, `finance`, `hr`, `pettycash`.

## Available suites

| File | Coverage | Serial? |
| --- | --- | --- |
| `auth-login.spec.ts` | Password login happy-path + wrong-password guard. | No |
| `landing.spec.ts` | Public marketing page renders CTAs. | No |
| `approvals-inbox.spec.ts` | Unified approvals inbox visibility per role. | No |
| `handovers.spec.ts` | PM handover list visibility (OM vs employee). | No |
| `cash-advance-chain.spec.ts` | Full CA lifecycle: submit → L1 → L2 → L2.5 → disburse → settle → accept. | **Yes** |
| `petty-cash-chain.spec.ts` | Custodian request replenishment → Finance approve → disburse. | **Yes** |
| `hr-requests-chain.spec.ts` | SICK single-hop + OVERTIME mid-chain (PM → OM → HR). | **Yes** |
| `hr-leave-chain.spec.ts` | LEAVE full 4-hop chain: Supervisor → PM → OM → HR admin. | **Yes** |
| `pm-handover-chain.spec.ts` | Handover lifecycle: OM approve → HM approve → execute + project PM swap verified. | **Yes** |

## Serial suites & re-runs

Some suites walk stateful chains (`cash-advance`, `petty-cash`,
`hr-requests`). They rely on specific seeded IDs being in specific
starting states. **After running a serial suite, you must re-seed before
re-running it**:

```bash
pnpm db:reset
pnpm exec playwright test cash-advance-chain --project=chromium
```

Independent suites (`auth-login`, `landing`, `approvals-inbox`,
`handovers`) can be re-run any number of times without a reset.

## Adding tests

- Prefer role-based scenarios (e.g. "Supervisor approves a pending expense").
- Use `data-testid` selectors where UI is stable; otherwise fall back to
  role/text selectors from ARIA labels — the app is accessibility-first
  (rules §23), so ARIA queries are reliable.
- If your test mutates seeded data, mark the describe block
  `test.describe.configure({ mode: "serial" })` and register the file in
  the table above so contributors know to re-seed before re-running.
