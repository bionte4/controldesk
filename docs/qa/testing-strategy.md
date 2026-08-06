# Testing strategy

Ini strategi testing top-down ControlDesk: **filosofi**, **test pyramid**,
**quality gates**, dan **risk-based approach**. Baca ini dulu sebelum
menambah test atau me-refactor test framework.

## Filosofi

> "Every bug that reaches production is a test that was missing or wrong."

Konsekuensi praktis:

- **Test-first untuk security** — PDP decisions, RLS policies, dan money
  hygiene di-test **sebelum** implementation. Regression di area ini
  berbahaya finansial + hukum (UU KUP, UU PPh).
- **Test-alongside untuk business logic** — state machine, validation,
  format helpers ditulis paralel dengan fitur, di-review bersama.
- **Test-after acceptable untuk UI-only** — component styling / animation
  boleh manual QA saja kalau tidak carry business logic.

## Test pyramid

ControlDesk mengikuti **modified test pyramid** dengan penekanan lebih
di lapisan unit + integration karena logika bisnis dominan di
`src/lib/`:

```
                    ┌────────────────────┐
                    │      Manual QA     │  ← ~5% effort (release smoke)
                    │  (per release)     │
                    └────────────────────┘
              ┌───────────────────────────────┐
              │        Playwright E2E         │  ← 15% (~38 tests, 15 suites)
              │   (critical business flows)   │
              └───────────────────────────────┘
      ┌───────────────────────────────────────────┐
      │        Vitest Integration                 │  ← 30% (state machines, RLS-safe helpers)
      │  (state.test.ts, apply.test.ts, ...)      │
      └───────────────────────────────────────────┘
┌───────────────────────────────────────────────────────┐
│                  Vitest Unit                          │  ← 50% (~373 tests, 52 files)
│    (PDP, Zod, format, redact, i18n parity, crypto)   │
└───────────────────────────────────────────────────────┘
```

### Lapisan 1: Vitest unit (~50% effort)

**Apa**: fungsi murni tanpa I/O. **1 file per 1 file source**,
colocated (`foo.ts` + `foo.test.ts`).

**Kandidat wajib**:

- **PDP decisions** (`src/lib/security/pdp.test.ts`) — 1 test per
  actor × action × resource × outcome. Ini fondasi security posture
  seluruh app.
- **Zod schemas** (`src/lib/validation/*.test.ts`) — happy path,
  boundary values, malformed input, injected control characters.
- **State machines** (`src/lib/*/state.test.ts`) — semua transisi valid
  + transisi invalid harus reject.
- **Format helpers** (`src/lib/format/money.test.ts`, `date.test.ts`) —
  no float drift, no timezone bugs, no locale drift.
- **AI redaction** (`src/lib/ai/redact.test.ts`) — cannot leak PII
  bahkan saat payload deeply nested.
- **RBAC helpers** (`src/lib/rbac/roles.test.ts`, `thresholds.test.ts`) —
  fold mapping legacy → canonical, threshold matrix per resource.
- **i18n parity** (`src/lib/i18n/config.test.ts`) — semua key di
  `id.json` ada di `en.json` dan sebaliknya.

**Karakteristik**:
- **Cepat** — < 100 ms per file, < 5 detik total.
- **Deterministic** — no time, no network, no filesystem.
- **Isolated** — 1 test = 1 concern.

### Lapisan 2: Vitest integration (~30% effort)

**Apa**: fungsi yang kombinasikan multiple helpers atau touch state
memory (fake DB / spy / mock). Tetap Node-side, tidak butuh browser.

**Kandidat**:

- **State machine + side effects** (`src/lib/budget-requests/apply.test.ts`
  simulate DB transaction, `src/lib/handover/state.test.ts`).
- **Observability sinks** dengan adversarial redaction inputs.
- **Retention verify** dengan checksum recomputation.
- **Direct labor cost compute** dengan roster + overtime edge cases.

**Karakteristik**:
- **Sedikit lebih lambat** — < 500 ms per file.
- **Boleh mock external** — Supabase client dimock, network dimock.
- **Tetap deterministic** — kalau butuh time, freeze via `vi.useFakeTimers()`.

### Lapisan 3: Playwright E2E (~15% effort)

**Apa**: browser-driven test di real Next.js server + real Supabase
local. Verifikasi **flow user end-to-end**.

**Kandidat**:

- **Approval chains** — setiap chain (Expense, CA, Budget Request,
  HR Request LEAVE / OT / SICK, PM Handover) punya chain suite serial.
- **Auth flows** — login, cross-tenant guard, role gating.
- **Client Portal** — cross-client isolation, force-change-password.
- **Realtime** — approvals inbox realtime refresh.
- **Access-control denials** — role yang tidak boleh sees no button.

**Yang JANGAN di E2E** (over-test):
- Individual button styling → visual regression tool terpisah.
- Field validation error messages → Vitest schema test cukup.
- Every enum edge case → Vitest state machine test cukup.

**Karakteristik**:
- **Lambat** — ~7-10 menit total di CI.
- **Flake risk** — network, dev-server compile, seed drift.
- **Serial-mode chain suites** — one-shot per `pnpm db:reset`.

### Lapisan 4: Manual QA (~5% effort)

**Apa**: pre-production smoke test yang dijalankan human sebelum
release ke staging / production.

**Kandidat**:
- Visual regression (yang tidak di-cover oleh Playwright screenshot).
- Cross-browser (Chromium sudah di E2E; Safari + Firefox manual).
- Mobile / responsive (E2E cuma desktop chromium).
- Real-device testing (touch, keyboard shortcuts di HP fisik).
- User journey smoke test per role.

Script: [`manual-smoke-scripts.md`](manual-smoke-scripts.md).

## Quality gates

### CI gate 1: `ci.yml` — Lint, typecheck, unit, build

**Wajib pass**. Run pada setiap commit ke PR.

```
pnpm lint          → ESLint zero-error.
pnpm typecheck     → tsc --noEmit zero-error.
pnpm test          → Vitest all suites green.
pnpm test:coverage → Coverage v8 report + threshold check.
pnpm build         → Next.js production build sukses (no runtime errors di build phase).
```

**Coverage threshold** (di `vitest.config.ts`):

```ts
thresholds: {
  "src/lib/security/**": {
    statements: 80, branches: 80, functions: 80, lines: 80,
  },
},
```

**Jika turun di bawah 80%**: CI fail. Solusi:
1. Tambah test yang cover cabang logic yang hilang.
2. Kalau kode benar-benar tidak reachable, tambah `/* v8 ignore next */` dengan komentar justifikasi.

### CI gate 2: `e2e.yml` — Playwright chromium

**Wajib pass**. Run pada setiap PR + push ke main.

Flow:
1. Boot Supabase local via `supabase start`.
2. Apply migrations + seed (`pnpm db:reset`).
3. Build Next.js production (`pnpm build`).
4. Run Playwright suite (`pnpm test:e2e --reporter=github,html`).
5. Upload HTML report + traces + videos as artifact on failure.

**Retry policy**: **2 retries di CI**, 0 lokal. Kalau test pass di
retry, dianggap flake — tapi ditrack (lihat [`flake-triage.md`](flake-triage.md)).

### CI gate 3: `security.yml` — pnpm audit + CodeQL

**Wajib pass**. Run pada setiap PR + weekly cron.

- `pnpm audit --audit-level=high` — no known high/critical vuln.
- CodeQL javascript-typescript scan — no new security findings.

### CI gate 4 (optional): `docker.yml` — Docker build

**Best-effort**. Run pada PR yang touch `Dockerfile` atau
`docker-compose.yml`. Docker build harus sukses tapi tidak execute.

## Risk-based testing

Bukan semua kode punya risiko sama. Testing effort dialokasikan
proporsional dengan **impact × likelihood**.

### High risk — WAJIB exhaustive test

| Area                        | Kenapa high risk                                       | Test strategy                                   |
| --------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| PDP decisions               | Bug = privilege escalation / data leak lintas tenant  | 1 unit test per outcome, > 90% coverage target |
| Money arithmetic            | Float error = pembukuan salah = ansi audit             | `bigint` cents only; unit test edge cases      |
| RLS policies                | Bug = cross-tenant data leak                           | Integration test via SQL (pg_prove — planned)   |
| Audit trail                 | Bug = hilang jejak = tidak comply UU PPh               | Wrapper `withSecureAction()` unit-tested       |
| Encrypted PII               | Bug = plaintext leak                                   | Unit test + code review manual                 |
| Approval chain state        | Bug = money keluar tanpa approver benar                | State machine + chain suite E2E                |
| Client Portal isolation     | Bug = client A lihat data client B                     | E2E cross-client isolation suite               |
| Cash Advance settlement     | Bug = uang hilang / double-refund                      | E2E chain + state machine                      |

### Medium risk — normal test coverage

| Area                        | Test strategy                                      |
| --------------------------- | -------------------------------------------------- |
| Zod schemas                 | Happy + boundary + malformed                       |
| UI components with logic    | Vitest kalau ada logic; Playwright kalau flow      |
| Notification triggers       | Integration test — insert row, assert notify row  |
| i18n keys                   | Parity test (unit) + smoke test (E2E)              |
| Cron endpoints              | Integration test — inject `CRON_SECRET`, assert outcome |

### Low risk — minimal / manual test

| Area                          | Test strategy                                    |
| ----------------------------- | ------------------------------------------------ |
| UI-only components (icon, badge) | Storybook / manual                            |
| Third-party lib wrappers      | Trust the lib; test our wrapper's contract only  |
| Auto-generated types          | No test (regenerate from DB truth)               |
| Marketing landing page        | E2E render check; no logic test                  |

## Bug severity guide

Setiap bug direview + di-tag severity, yang mempengaruhi urgency fix
+ apakah blocks release. Detail: [`bug-reporting.md`](bug-reporting.md).

| Severity           | Definisi                                                    | SLA fix    | Blocks release |
| ------------------ | ----------------------------------------------------------- | ---------- | -------------- |
| **S0 — Critical**  | Cross-tenant data leak / financial calc error / auth bypass | Same day   | YES            |
| **S1 — High**      | Business flow broken (chain stuck, payroll salah)          | < 24 jam   | YES            |
| **S2 — Medium**    | Feature degraded (workaround exists)                        | < 1 week   | Case-by-case   |
| **S3 — Low**       | Cosmetic, minor UX friction                                 | Backlog    | NO             |

## Coverage philosophy

**Coverage adalah metrik, bukan goal**. 80 % coverage tidak berarti
bebas bug — bisa saja semua branch di-cover tapi assertion lemah.

Fokus:

1. **Prioritas resource kritis** (security helpers, money, state machines).
2. **Coverage tinggi hanya menandakan branch tercapai** — verify assertion cukup ketat.
3. **Mutation testing** (planned via `stryker`) — inject bug secara sintetis dan lihat apakah test catch. Kalau tidak, test lemah.

Coverage report:
```bash
pnpm test:coverage
# open coverage/index.html
```

Yang di-track selain 80% floor security:

- `src/lib/**` non-security: target 60% (informational).
- `src/lib/validation/**`: target 90% (schemas critical).
- `src/lib/format/**`: target 100% (helper deterministik, tidak ada excuse).
- `src/lib/ai/redact.ts`: target 100% (PII leak hazard).

## Continuous improvement loops

### Sprint-level (per feature branch)

- Setiap PR wajib update / tambah test yang relevant.
- Coverage regression pada file yang di-touch → blocker.
- Flake yang muncul di CI PR retry → assignee patch atau file [`flake-triage`](flake-triage.md) issue.

### Release-level (bi-weekly / monthly)

- Review test catalog vs new features — apakah ada gap?
- Run [`manual-smoke-scripts.md`](manual-smoke-scripts.md) per role di staging.
- Review flake rate di CI dashboard — kalau > 3 %, prioritas fix.

### Quarterly

- Coverage floor review — mungkin dinaikkan untuk area yang matang.
- Test infra audit — Playwright version, Vitest version, Supabase CLI.
- Security regression sweep — CodeQL + manual review PDP tests.

## Non-goals

Yang **secara sengaja TIDAK** kita test:

- **Performance under load** — nanti kalau ada realistic traffic profile. Untuk sekarang manual profiling saja.
- **Visual regression exhaustive** — Playwright screenshot only-on-failure. Belum ada percy / chromatic.
- **All browsers × all OS** — Chromium desktop di CI + manual Safari/Firefox per release cukup untuk sekarang.
- **Chaos engineering** — DB failover / Redis outage skenario belum di-simulate. Manual disaster recovery drill quarterly.

Yang ini bukan berarti "unimportant" — mereka manual ownership Tech
Lead / DevOps, bukan CI-automated gate.

## Where to look next

- Concrete Playwright how-to: [`e2e-playbook.md`](e2e-playbook.md).
- Test catalog by module: [`test-catalog.md`](test-catalog.md).
- Manual scripts: [`manual-smoke-scripts.md`](manual-smoke-scripts.md).
- Engineer-side Vitest config: [`../testing.md`](../testing.md).
