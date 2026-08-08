# Changelog

All notable changes to ControlDesk are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every entry that ships user-facing behaviour or an ops-facing surface
MUST include the `.cursorrules` section it maps to.

## [Unreleased]

### Added

- **AI Insights — Google Gemini live provider + locale-aware output**
  (rules §15, §18). Default provider AI Analytics Engine sekarang bisa
  di-switch dari `mock` ke `google` untuk output naratif live per tenant:
  - `src/lib/ai/generators.ts` — bump `PROMPT_VERSION` ke `"v2-locale"`.
    Semua 4 generator (`predictExpenseImpact`, `analyzeResourceUtilization`,
    `analyzeClientHealth`, `analyzeSlaBreach`) sekarang menerima parameter
    `locale: Locale = DEFAULT_LOCALE`. Helper `languageDirective(locale)`
    inject directive bilingual di awal system prompt (Bahasa Indonesia
    formal untuk `id`, professional English untuk `en`). Nama proyek /
    klien / karyawan tetap dipertahankan apa adanya. Helper `pick()`
    memastikan fallback (mock) output juga bilingual.
  - `src/app/(app)/insights/actions.ts` — `resolveInsightLocale()` baca
    cookie `NEXT_LOCALE` via `next/headers` cookies() dan pass ke
    `runInsight()`. Insight yang di-generate cocok dengan UI locale user
    tanpa manual toggle.
  - Provider slot Gemini di `resolveModel()` — dynamic import
    `@ai-sdk/google` (Vercel AI SDK ≥ 1.0). Support `AI_MODEL_ID`
    `gemini-flash-latest` (recommended), `gemini-3.6-flash`,
    `gemini-3.5-flash-lite`, dll. Format API key `AQ.Ab...` (per
    migrasi Google Juni 2026, sunset `AIza...` September 2026).
  - `scripts/test-ai-insight.ts` — CLI smoke test dengan flag
    `--locale=id|en`. Dynamic-import package provider, panggil
    `generateObject()` dengan Zod schema 3-field, print latency +
    token usage. Support prompt override via positional arg.
  - `package.json` — script `pnpm test:ai`. `tsx` runtime + custom
    `scripts/tsconfig.json` dengan path alias `server-only` →
    stub kosong (supaya import `src/lib/*` yang gate `server-only`
    tidak throw di luar Next.js runtime).
- **Telegram Bot — per-tenant integration with self-serve admin UI**
  (rules §5, §17, §20). Setiap tenant admin bisa create bot via
  @BotFather + wire ke ControlDesk tanpa engineering handoff:
  - Migration `0069_telegram_integration.sql` — tabel
    `tenant_telegram_bots` (per-tenant bot token, encrypted AES-256-GCM
    via `token-crypto.ts`) + `user_telegram_links` (per-user chat_id +
    display info). Kedua tabel RLS `no_direct` policy — hanya
    service-role client yang boleh access.
  - `src/lib/integrations/telegram/` — client (sendMessage +
    verifyTelegramBotToken via `getMe`), repository (encryption I/O),
    link-token (HMAC-SHA256 signed deep link untuk `/start` pairing,
    10-menit expiry).
  - Admin form `/settings/integrations/telegram-bot` — RSC page +
    client form (RHF + Zod). Server Action `saveTelegramBotAction`
    verify token via `getMe` sebelum save; kalau Telegram tolak,
    tidak persist. `deactivateTelegramBotAction` soft-disable (row tetap
    ada untuk audit).
  - Webhook `POST /api/telegram/webhook` — parse inbound update
    (`/start <hmac_token>`), verify HMAC signature, upsert row di
    `user_telegram_links`, reply konfirmasi "Terhubung ✅".
  - PDP additions — `decideTelegramBotConfig()` di
    `src/lib/security/pdp.ts` restrict read/create/update/delete ke
    `TENANT_ADMIN` + `GENERAL_MANAGER`. `ResourceType` extended dengan
    `"telegram_bot_config"`. Audit action `AuditActionType` mapping
    baru untuk `configure`.
  - `scripts/test-telegram.ts` + `pnpm test:tg` — CLI smoke test:
    verify config, panggil `/getMe`, list pending chats via
    `/getUpdates` kalau tidak ada `chat_id` arg, atau kirim message
    via `sendTelegramMessage()`. Bahasa error-message Indonesia.
  - i18n keys baru di `messages/{id,en}.json` (`telegramAdmin.*`) +
    runbook 5-step di halaman admin. `LANG_CACHE_BUST_TAG` di
    `src/lib/i18n/request.ts` bumped ke `v11` untuk force pickup.
- **WhatsApp — Fonnte integration (unofficial gateway)** (rules §5, §17,
  §20). Notifikasi WA per-user via provider Fonnte (asal Indonesia).
  Compliance caveat: Fonnte unofficial, ada ToS risk WhatsApp; slot
  provider resmi (Meta Cloud, Twilio) sudah reserved untuk migrasi
  masa depan:
  - Migration `0070_whatsapp_integration.sql` — tabel
    `tenant_whatsapp_configs` + `user_whatsapp_links`. Kolom
    `provider text` dengan CHECK constraint `('TWILIO', 'META_CLOUD')`
    initially.
  - Migration `0071_fonnte_whatsapp_provider.sql` — expand CHECK
    constraint untuk include `'FONNTE'`. Migration ini idempotent —
    drop-if-exists sebelum add.
  - `src/lib/integrations/whatsapp/client.ts` — adapter pattern
    `sendWhatsAppMessage()` internal switch berdasarkan provider.
    `sendViaFonnte()` handle Fonnte quirks: header `Authorization: <token>`
    (tanpa `Bearer`), body `application/x-www-form-urlencoded`,
    `countryCode: "62"` eksplisit, `target` tanpa `+`. `verifyWhatsAppCredentials()`
    branch FONNTE call `GET /device` untuk cek device pairing +
    quota + expiry. 5-detik timeout via `AbortSignal.timeout(5000)`.
  - `src/lib/validation/whatsapp-admin.ts` — Zod schema simplified
    ke FONNTE-only literal (dropped Twilio + Meta form fields untuk
    menghindari confusion). 10 unit test cases di
    `whatsapp-admin.test.ts` cover valid + invalid input.
  - Admin form `/settings/integrations/whatsapp-business` — RSC +
    client form (RHF). Server Action `saveWhatsAppConfigAction` verify
    device dulu via `/device` sebelum persist encrypted token.
  - `scripts/test-whatsapp-fonnte.ts` + `pnpm test:wa` — CLI smoke test
    load config, decrypt token, cek device via `/device`, kirim message
    via helper produksi. Auto-normalize nomor (`0881…` → `62881…`).
  - `scripts/fonnte-device-status.ts` + `pnpm fonnte:device` — raw
    dump `/device` response untuk debugging kalau pesan accept tapi
    tidak delivered (paling sering: self-messaging, HP airplane mode,
    quota habis).
  - PDP additions — `decideWhatsAppConfig()` mirror pattern
    Telegram. `ResourceType` extended dengan `"whatsapp_config"`.
- **Developer CLI toolkit** — `tsx` runtime dengan custom
  `scripts/tsconfig.json`:
  - Path alias `@/*` → `src/*` (mirror Next.js).
  - Path alias `server-only` → `scripts/server-only-stub.ts` (stub
    kosong) supaya modul di `src/lib/integrations/**/repository.ts`
    yang import `server-only` tidak throw ketika di-run via `tsx`
    (`server-only` hanya bisa di-import di Server Component context;
    di runtime `tsx` package aslinya throw eksplisit).
  - Semua 4 CLI script di-wire di `package.json`:
    - `pnpm test:ai [--locale=id|en] [prompt]`
    - `pnpm test:tg [chat_id] [message] [--tenant=<uuid>]`
    - `pnpm test:wa "<nomor>" [message] [--tenant=<uuid>]`
    - `pnpm fonnte:device [--tenant=<uuid>]`
  - Menggunakan `node --env-file=.env.local` (Node 20 native) —
    tidak butuh `dotenv` package.
- **Docs — Integrations playbook + CLI reference** (rules §17, §21).
  Struktur folder baru `docs/integrations/` + `docs/dev-tools.md`
  dengan pattern Diátaxis (Tutorial + How-To + Reference + Explanation).
  Bilingual (Bahasa Indonesia sebagai lead, istilah teknis English).
  Setiap doc: prasyarat → setup langkah-demi-langkah → verifikasi via
  CLI + UI → arsitektur (Mermaid sequence diagram) → security → env
  var → troubleshooting → FAQ.
  - `docs/integrations/README.md` — hub katalog + kapan pakai apa +
    security summary + roadmap slot.
  - `docs/integrations/ai-insights-gemini.md` — Gemini setup end-to-end,
    model selection guide (per Aug 2026 API), PII redaction, cost
    estimate, provider alternatif (OpenAI/Anthropic/Ollama).
  - `docs/integrations/telegram-bot.md` — BotFather flow, admin config,
    HMAC deep-link user pairing, HTML injection escape guidance.
  - `docs/integrations/whatsapp-fonnte.md` — Fonnte device setup,
    compliance caveat (ToS risk), self-messaging pitfall, provider
    adapter pattern.
  - `docs/dev-tools.md` — CLI reference lengkap untuk 4 script +
    guide "cara nambah tool baru".
  - Updates ke `docs/README.md` (Integrations section + doc map),
    `docs/env-reference.md` (Gemini format modern + messaging env
    vars), `docs/modules/ai-and-notifications.md` (locale-aware Part 1
    + Messaging channels Part 3 cross-link).

- **Projects — Google Calendar publisher (outbox pattern)** (rules §7, §18,
  §22). The `sync_calendar` toggle on the wizard now actually feeds a
  publisher pipeline:
  - Migration `0039_google_calendar_integration.sql` adds
    `google_calendar_credentials` (per-tenant OAuth refresh token) and the
    `project_calendar_events` outbox table with `calendar_event_kind`
    (`PROJECT_CREATED|UPDATED|DELETED`, `MILESTONE_*`) and
    `calendar_event_status` (`PENDING|SENT|FAILED|SKIPPED`). Follow-ups
    `0040..0042` fixed the pgcrypto schema path and then pivoted to
    Node-side AES-256-GCM (`src/lib/security/token-crypto.ts`, 6 unit
    tests) because Supabase's pooled connections cannot reliably set the
    `app.enc_key` GUC.
  - Publisher interface `CalendarPublisher` at
    `src/lib/integrations/google-calendar/` with two implementations:
    `NoopCalendarPublisher` (dev / CI default — logs + synthetic
    `noop-<id>` event id) and `GoogleCalendarPublisher` (real
    `googleapis` client behind a dynamic import; activated when
    `GOOGLE_CALENDAR_CLIENT_ID/_SECRET` are set). Factory in
    `index.ts` picks between them with a `__setCalendarPublisherForTests`
    hook mirroring `mailer.ts`.
  - Server action `createProjectAction` now enqueues one `PROJECT_CREATED`
    + one `MILESTONE_CREATED` per milestone into the outbox when
    `sync_calendar=true`. Enqueue failures are logged but non-fatal:
    the project and milestones stay durable because calendar sync is
    eventually-consistent.
  - Drain endpoint `POST /api/cron/google-calendar-drain` (registered in
    `vercel.json` at `*/10 * * * *`) hydrates project + milestone state,
    resolves and decrypts tenant credentials Node-side, dispatches to
    the active publisher, and marks each row `SENT / FAILED / SKIPPED`
    with exponential-backoff (`2^attempts` minutes, capped at 6 hours).
    12 Vitest cases covering empty batches, missing credentials,
    `sync_calendar=false` guard, dry-run, retryable vs non-retryable
    failure classification, milestone hydration, multi-tenant fan-out,
    and full end-to-end with `NoopCalendarPublisher`. Additional 15
    Vitest cases exercise the Google event builder (all-day event span,
    endDate fallback, milestone one-day event, HTTP code extraction).
- **Topbar Bell — per-`notification_kind` icons + tone map** (rules §20).
  `NotificationsBell` (`src/components/shell/notifications-bell.tsx`)
  now renders each row with a `lucide-react` icon and a tenant-branded
  tone class instead of a plain dot: `CalendarClock` for
  `PROJECT_CONTRACT_EXPIRING`, `UserRoundCog` for
  `EMPLOYEE_CONTRACT_EXPIRING` + `HR_REQUEST_UPDATE`, `Wallet` for cash
  advance / petty-cash kinds, etc. Unread items keep a small primary-
  coloured dot in the top-right of the icon. Fully typed against
  `notification_kind` so any future enum extension is a compile-time
  todo.
- **Projects — 3-step creation wizard + auto-numbering + priority-driven SLA**
  (rules §7, §17, §29). The `/projects` "New project" CTA now opens a
  guided sheet whose steps match the internal PM intake process:
  1. *Info* — client, project name, priority, PM, project type, status,
     location, description.
  2. *Timeline & budget* — start / end dates (with computed duration),
     contract value + currency (IDR-only per §14), free-form notes, and
     a "Sync to Google Calendar" toggle whose flag is persisted for a
     future publisher.
  3. *Milestones* — optional inline add / remove with per-row weighting
     (`weight_pct`). When left blank or all zero, the wizard falls back
     to even weighting inside the server action.
  - Migration `0036_projects_wizard_fields.sql` — new enum
    `project_priority` (CRITICAL / HIGH / MEDIUM / LOW), extends
    `project_status` with `DRAFT`, adds `priority`, `location`,
    `contract_value` (`numeric(18,2)`, IDR-only), `currency`, `notes`,
    `sync_calendar` columns on `public.projects`, and installs the
    `project_numbering_sequence` table + BEFORE-INSERT trigger that
    assigns `project_number = PRJ-{YYYY}-{seq:04}` per tenant per year.
  - Migration `0037_projects_number_collision_safe.sql` — backfills the
    sequence from any pre-existing `PRJ-YYYY-####` rows (seed data,
    imports) and makes the trigger loop past already-taken numbers so
    manual inserts never break autonumbering.
  - `priority` on the parent project feeds the default severity for new
    `project_issues`, wiring the business-hours SLA (CRITICAL=1h,
    HIGH=4h, MEDIUM=8h, LOW=24h; see 0029). Set via
    `NewIssueSheet.defaultSeverity` from `ProjectIssuesSection`.
  - New Playwright suite `e2e/projects-wizard.spec.ts` covering the
    happy path (auto-numbered `PRJ-YYYY-####` visible in the list row)
    and the Step-1 validation gate. Vitest updates in
    `src/lib/validation/project.test.ts` (13 cases) exercise the
    milestone-weight refinements.
- **Projects — contract-expiry reminders** (rules §7, §20). New
  `POST /api/cron/project-contract-reminders` sweep enqueues in-app
  notifications 30 / 14 / 7 / 3 days ahead of `end_date` for projects
  whose status is DRAFT / PLANNING / ACTIVE / ON_HOLD. Notifications
  fan out to the ACTIVE `PRIMARY_PM` and to Head Manager / GM / Tenant
  Admin (dedupe on `(user_id, employee_id)`). Idempotency: skip when a
  matching `(project_id, threshold_days)` notification was created in
  the last 26 hours. Migration `0038_project_contract_expiring_notif.sql`
  adds the `PROJECT_CONTRACT_EXPIRING` enum value; Vercel cron scheduled
  at `15 1 * * *` (08:15 WIB) to stagger from the employee variant.
- **HR — Employees directory + contract-expiry reminders** (rules §6, §12, §20).
  New `/hr/employees` page + "New employee" sheet matching the reference
  screenshot: First / Last name, Email, Phone, Department (dropdown),
  Position (dropdown), Join date, Employment type, End date, Availability,
  Date of birth (Permanent only).
  - Migration `0034_employees_extended.sql` — new enums `employment_type`
    (PERMANENT / CONTRACT / PROBATION / INTERN / OUTSOURCE / OUTTASK) and
    `employee_availability` (AVAILABLE / ASSIGNED / ON_LEAVE / INACTIVE);
    new columns on `employees` (`first_name`, `last_name`, `phone`,
    `department`, `position_title`, `date_of_birth`, `join_date`,
    `employment_type`, `contract_end_date`, `availability`); `tenants` gains
    `retirement_age` (default 55, statutory pensiun); CHECK constraints
    force non-PERMANENT rows to supply `contract_end_date` and forbid end
    date preceding join date; BEFORE trigger auto-derives
    `contract_end_date = date_of_birth + retirement_age` for PERMANENT
    rows when the end date is blank; new notification kind
    `EMPLOYEE_CONTRACT_EXPIRING`. `employees.user_id` becomes NULLABLE so
    HR admins can register employees before they activate a system account.
  - `src/lib/validation/employee.ts` — Zod schema with `superRefine` for
    the "end date required for non-PERMANENT" rule + join-date coherence
    check + DOB sanity guard (17 y ≤ age ≤ 90 y); 16 unit tests.
  - `src/app/(app)/hr/employees/*` — RSC list page (contract expiry badge
    turns amber ≤ 30 days, rose after expiry) + slide-over form with
    conditional required-marker on End date; server actions
    `createEmployeeAction` / `updateEmployeeAction` /
    `setEmployeeAvailabilityAction` wrapped in `withSecureAction`
    (PDP `employee/create` = HR_ADMIN + TENANT_ADMIN).
  - `src/app/api/cron/employee-contract-reminders/route.ts` — daily cron
    (08:00 WIB) sweeping non-PERMANENT contracts at 30 / 14 / 7 / 1 day
    horizons, notifying every active HR_ADMIN + TENANT_ADMIN via the
    in-app bell. Idempotent per (employee, threshold) within a 26-hour
    window; dry-run mode supported. Vercel Cron entry added.
  - Sidebar nav: new "Karyawan / Employees" item in the People section
    (icon Users). Full i18n keys in `messages/{id,en}.json`.
  - `src/lib/notifications/service.ts` + `src/lib/auth/session.ts`
    narrowing updated to keep the rest of the codebase type-safe now that
    `employees.user_id` can be `null` (employees without an auth account
    are silently skipped by the notification fan-out).

- **Fix — `<DropdownMenuLabel>` outside `<Menu.Group>` caused Base UI
  error #31 crashing every page that mounted the app topbar or language
  toggle**. Refactored `DropdownMenuLabel` in `src/components/ui/dropdown-menu.tsx`
  to render a plain `<div role="presentation">` instead of
  `MenuPrimitive.GroupLabel`, which required a `MenuGroupContext` parent.
  Existing call sites (topbar user menu, language toggle, project issue
  row menu) continue to work with no changes.

- **Documentation — QA / QC / Tester playbooks** (rules §21 testing,
  §23 accessibility). Adds nine new docs under `docs/qa/` yang
  complement engineer-facing `docs/testing.md` dengan perspektif
  QA/tester-centric — testing strategy, E2E playbook operasional, test
  catalog lengkap, test data + fixtures, manual smoke scripts, release
  checklists, flake triage, WCAG 2.2 AAA testing, dan bug reporting
  playbook. New docs:
  - `docs/qa/README.md` — QA docs index (routes by role: QA Lead, QA Engineer, Manual Tester, A11y Auditor, Release Manager).
  - `docs/qa/testing-strategy.md` — test pyramid (Vitest 50 % / integration 30 % / Playwright 15 % / manual 5 %), 4 CI quality gates, risk-based coverage, bug severity guide.
  - `docs/qa/e2e-playbook.md` — comprehensive Playwright how-to: setup, run, debug, trace reading, extending tests, selector best practices (getByRole > testid > text > label > CSS), serial vs parallel, CI vs local differences, troubleshooting.
  - `docs/qa/test-catalog.md` — full matrix of 52 Vitest specs + 15 Playwright specs mapped to feature coverage; gaps + planned coverage table.
  - `docs/qa/test-data.md` — seed data structure, 11 internal demo users + 3 portal users, deterministic UUID pattern (`11111111-...` tenants → `99999999-...` timesheets), fixture patterns (inline / shared), 4 isolation contracts.
  - `docs/qa/manual-smoke-scripts.md` — per-module smoke scripts (auth, clients, projects, CA chain, LEAVE chain, weekly timesheet, portal isolation, force-change-password, insights) + pre-merge + release checklists (staging + production) + cross-browser + device.
  - `docs/qa/flake-triage.md` — 10 kategori flake (timing, race condition, cold compile, auth race, seed drift, realtime, locale, cache, date-dependent, prod-only) dengan fix pattern; quarantine policy; anti-flake best practices.
  - `docs/qa/accessibility-testing.md` — WCAG 2.2 AAA verification: axe DevTools, Lighthouse, `@axe-core/playwright` (planned), manual keyboard + screen reader audit checklist per page, common fixes (icon button aria-label, contrast, focus trap, reduced-motion, form error binding).
  - `docs/qa/bug-reporting.md` — bug filing template, S0-S3 severity guide with question tree, 5-step reproduction workflow (isolate → minimize → capture artifacts → cross-check docs → hypothesis), verification workflow, ready-to-use templates (S0, S1-S3, a11y, flake).
  - `docs/README.md` updated dengan section QA baru + role routing; root `README.md` + `docs/testing.md` cross-link.
- **Documentation — Full product + module + user-guide expansion** (rules
  §1 code standards, §17 feature folder). Adds thirteen new docs under
  `docs/{product,modules,reference,user-guides}` covering audiences
  yang sebelumnya kurang tercover (business owners, end users, external
  clients, auditors). New docs:
  - `docs/product/overview.md` — product overview, personas, feature matrix, non-goals.
  - `docs/product/glossary.md` — bilingual EN/ID business + technical terms.
  - `docs/product/roles-and-permissions.md` — 10-role legacy vs 7-role canonical, capability matrix per resource.
  - `docs/product/approval-workflows.md` — full threshold matrix + Mermaid state machines for every approvable resource.
  - `docs/modules/clients-and-portal.md` — clients, BPO contracts, SLA, Client Portal (auth, isolation contract, notifications, login events audit).
  - `docs/modules/projects.md` — project lifecycle, assignments (100% allocation guard), milestones, issues (SLA business-hours + escalation ladder), PM handover.
  - `docs/modules/finance.md` — expenses, Cash Advance (General + Field Ops + 10-day settlement SLA), Petty Cash (Imprest Fund + decision matrix), Budgets + Budget Requests.
  - `docs/modules/hris-and-payroll.md` — encrypted PII master, shifts + roster, HR requests (3 kinds), daily + weekly timesheets, payroll DLC formula.
  - `docs/modules/ai-and-notifications.md` — four AI generators + safety (PII redaction, per-tenant token cap), notifications (in-app + email outbox + realtime).
  - `docs/reference/database-schema.md` — ER diagram, migration timeline 0001-0033, table catalog by concern, enum reference.
  - `docs/reference/state-machines.md` — every state machine in one visual reference.
  - `docs/user-guides/internal-users.md` — panduan operasional per role internal.
  - `docs/user-guides/client-portal-users.md` — panduan untuk klien eksternal.
  - `docs/README.md` restructured as audience-first index; root `README.md` links updated.
- **CI/CD — GitHub Actions hardening + branch protection** (rules §2, §21,
  §22). All four workflows (`ci.yml`, `e2e.yml`, `security.yml`,
  `docker.yml`) now: (1) let `pnpm/action-setup@v4` read the version
  from `package.json`'s `packageManager` field (single source of
  truth, kills the `Multiple versions of pnpm specified` error), (2)
  target Node **22** (Node 20 is deprecated on GH-hosted runners), (3)
  pass `NEXT_PUBLIC_*` build args to the Docker workflow so the
  multi-stage image builds without a running Supabase. E2E now runs
  Playwright against `pnpm build && pnpm start` (production bundle)
  instead of `pnpm dev` — the dev server's cold compiles caused
  intermittent `waitForURL` timeouts when the whole suite raced. The
  Supabase teardown step is guarded with `command -v supabase` so an
  early-fail run doesn't turn the job red on shutdown. Branch
  protection on `main` requires 1 approving review + all three CI
  checks green (`lint · typecheck · test · build`, `playwright
  chromium`, `CodeQL / javascript-typescript`), auto-dismisses stale
  reviews, blocks force-push and branch deletion, and requires all
  PR conversations resolved. Repo admins retain a bypass valve for
  emergency hotfixes per rules §22. Dependabot **security updates**,
  vulnerability alerts, secret scanning, and push protection are all
  enabled on the repo. GitHub Environments `staging` and `production`
  are pre-created (production is locked to `main`). Full contract is
  documented in [`docs/deployment.md`](docs/deployment.md#cicd-github-actions).
- **Platform — Next.js 16 header-propagation pattern on (app) branch of
  proxy** (rules §5, §3). The `(app)` branch of `src/proxy.ts` now
  mirrors the pattern already used by the portal branch: mutations to
  request headers happen against a single cloned `Headers`, cookie
  refreshes from the Supabase auth client are buffered into a
  `pendingCookies` array, and the final response is built ONCE at the
  end via `NextResponse.next({ request: { headers: requestHeaders } })`
  with all buffered cookies flushed onto it. This is the documented
  Next.js 16 contract for making request-header mutations reach RSC +
  Server Actions in both dev and production runtimes — previously
  we were relying on in-place mutation, which is a silent no-op on
  the Edge runtime and would have broken quietly once we moved out of
  Node. Verified against `pnpm typecheck` + full Vitest suite
  (887/887 passing).
- **HR — Compact approval-chain visual in list view** (rules §12, §14).
  The HR requests list (`/hr/requests`) gains a new `Chain` column that
  renders the compact variant of `ApprovalChainProgress`, mirroring the
  detail page. Approval slots come from the shared `hrChainForKind()`
  helper so LEAVE / OVERTIME (Supervisor → PM → OM → HR Admin) and SICK
  (Supervisor → HR Admin) chains stay in lock-step with the detail
  timeline. Terminal statuses (APPROVED / REJECTED / CANCELLED) render
  with no active slot; in-flight statuses highlight the current slot in
  place. i18n keys `hrRequests.columns.chain` added in
  `messages/{en,id}.json`.
- **Portal admin — Portal login events lens** (rules §3 audit trail, §21,
  §28). The `/clients/[id]/portal-users` admin page now renders a
  "Recent login events" table sourced from `portal_login_events`
  (migration 0032, append-only, 7-year retention). Shows the last 25
  events across all portal users of the client with typed badges
  (SUCCESS, FAILURE_BAD_PASSWORD, FAILURE_LOCKED, LOGOUT,
  SESSION_EXPIRED), resolved user email, IP (`inet`), UA, and localised
  timestamp. New read helper `listClientPortalLoginEvents()` verifies
  client-tenant membership via the RLS-bound Supabase client BEFORE
  falling through to the service-role fetch, and scopes results to the
  client's own `client_user_id`s (never leaks tenant-wide UNKNOWN_USER
  attempts). i18n keys `clients.portalUsers.events.*` added in
  `messages/{en,id}.json`.
- **Portal — Notification bell near-realtime refresh** (rules §20, §28).
  `PortalBellRefresh` is a visibility-aware `router.refresh()` loop
  mounted next to `PortalBell` in the portal topbar. It re-runs the
  parent RSC (which reads `getPortalUnreadCount()`) every 45 s while the
  tab is visible and pauses via the Page Visibility API when hidden,
  triggering one immediate refresh on tab-focus. Chosen over Supabase
  Realtime `postgres_changes` because portal users don't hold a Supabase
  JWT (RLS on `portal_notifications` is service-role-only, so anon
  subscribers would receive nothing), and over broadcast/SSE because the
  polling approach carries zero extra security surface. Refresh cadence
  is configurable via `intervalMs` per-mount.
- **Portal — Force change-password on first sign-in** (rules §3, §21, §28).
  Newly-invited portal users (and users whose password was reset by an
  admin) are now forced through a permanent password rotation before any
  other portal route becomes reachable. Highlights:
  - `client_users.status = 'PENDING_ACTIVATION'` is now the single signal
    for "must rotate before use". `resetClientPortalUserPasswordAction`
    always sets the status back to `PENDING_ACTIVATION`.
  - `getCurrentPortalSession()` recognises `PENDING_ACTIVATION` as an
    authenticated (but restricted) session; `requirePortalSession()`
    redirects such visitors to `/portal/change-password` unless the caller
    explicitly opts in via `{ allowPendingActivation: true }` (used only
    by the change-password page itself, to break the loop).
  - New Zod schema `src/lib/validation/portal-change-password.ts` enforces
    the password policy (min 10 chars, ≥1 letter + ≥1 digit, must differ
    from current, matching confirmation). Unit-tested.
  - New server action `portalChangePasswordAction` verifies the current
    password, hashes and stores the new one, flips status to `ACTIVE`,
    resets `failed_login_count` / `locked_until`, and revokes every OTHER
    portal session for that user (the current cookie stays valid — no
    surprise re-login for the actor).
  - New page `/portal/change-password` with an accessible form
    (`Correct-horse-9` style hint, `aria-describedby` on errors, honours
    `prefers-reduced-motion` via the reused button component).
  - Seed extended with a `client-new@demo.controldesk.app` demo user in
    `PENDING_ACTIVATION` so the E2E and manual QA both have a starting
    point without touching production data.
  - i18n keys `portal.changePassword.*` in `messages/{en,id}.json`.
- **Portal admin — cron cleanup of expired sessions** (rules §22, §28).
  New endpoint `POST /api/cron/portal-sessions-cleanup` purges rows from
  `client_user_sessions` whose `expires_at` (or `revoked_at`) is older
  than the 30-day forensic tail. `portal_login_events` audit rows are
  intentionally NOT touched — they carry the same 7-year retention as
  `security_audit_logs`. Endpoint follows the retention-cron auth pattern
  (`Authorization: Bearer $CRON_SECRET`, falls open in dev), logs to
  `cron_run_log`, supports `?dry_run=true`, and is wired into
  `vercel.json` at `0 4 * * *`.
- **HR request detail — Approval chain visualisation** (rules §12, §14).
  The `/hr/requests/[id]` page now renders a top-level "Approval chain"
  card via the shared `ApprovalChainProgress` component, adapted with
  kind-aware slots (`LEAVE`/`OVERTIME` → L1 → L2 → L3 → HR;
  `SICK` → L1 → HR). Reject/cancel states derive the completed steps
  from the audit log so the visual doesn't lie about how far the request
  had actually travelled. Added `hrChainForKind` helper +
  `HR_CHAIN_SLOT_LABEL` label map in `src/lib/hris/state.ts` with unit
  coverage. i18n key `hrRequests.detail.approvalChainTitle` (EN + ID).
- **E2E — Portal notifications, financials, change-password, admin CRUD**
  (rules §21). `e2e/portal.spec.ts` grew three new suites: notification
  bell render + mark-read + mark-all-read; financials section renders on
  project detail without leaking internal `project_expenses`; and the
  PENDING_ACTIVATION redirect + happy-path change-password loop.
  A brand-new spec `e2e/portal-users-admin.spec.ts` covers the admin
  invite → temp-password one-time reveal → row-level reset + disable /
  enable flows against a demo tenant.

- **Client Portal — B.4 Notifications feed** (GAS §28, rules §20, §28).
  Portal users now have an in-portal inbox for milestone and project
  updates. Highlights:
  - Migration `0033_portal_notifications.sql` adds a dedicated
    `portal_notifications` table (client_user-targeted, service_role RLS
    because portal callers have no JWT), a `portal_notification_kind`
    enum (`MILESTONE_UPDATE`, `PROJECT_UPDATE`, `ANNOUNCEMENT`, `SYSTEM`),
    a SECURITY DEFINER helper `enqueue_portal_notification()` that fans
    a single row out to every ACTIVE `client_user` of the target client,
    and two AFTER-UPDATE triggers:
    - `project_milestones.status → {DONE, AT_RISK, CANCELLED}` emits
      one `MILESTONE_UPDATE` per active client user.
    - `projects.status → COMPLETED` emits a `PROJECT_UPDATE`.
    Other transitions (e.g. `PLANNED → IN_PROGRESS`) are intentionally
    silent to keep the feed signal-heavy.
  - `src/lib/portal/notifications.ts` — `listPortalNotifications` +
    `getPortalUnreadCount`. Both scope by `(tenant_id, client_user_id)`
    at the app layer (defence-in-depth per rules §28 security contract).
  - `src/app/(portal)/actions.ts` gains `markPortalNotificationRead(id)`
    and `markAllPortalNotificationsRead()` — service-role updates with
    session-bound `client_user_id` guard so a poisoned client can't
    acknowledge another user's notifications.
  - **Topbar bell** (`src/app/(portal)/portal-bell.tsx`) — server
    component with unread count badge and accessible aria-label
    (`"3 unread notifications"`). Rendered inside the portal layout.
  - **Feed page** `/portal/notifications` — kind-aware icon + tone chip,
    per-row "Mark read" + bulk "Mark all as read" server-action forms,
    optional deep-link when `action_url` is set. Empty state uses the
    same design language as the rest of the portal.
  - Seed adds 4 demo notifications (3 for PT Nusa's Rina — one read,
    two unread; 1 unread AT_RISK for PT Indo's Sandi) so the bell
    renders content out-of-the-box.
  - i18n keys `portal.notifications.*` + `portal.notificationKind.*`
    added in both `messages/{en,id}.json`.

- **Client Portal — B.5 Project financials (contracts + budget)**
  (GAS §28, rules §5, §14, §28). The project detail page now includes a
  **Financials** card:
  - `src/lib/portal/data.ts` grows `listPortalClientContracts()` and
    `getPortalProjectFinance()`. The latter returns the per-project
    `project_budgets` row (allocated + spent + currency) plus every
    ACTIVE/DRAFT `bpo_contract` on the same client whose window
    overlaps the project (start ≤ project.end AND end ≥ project.start,
    with open-ended contracts treated as overlapping).
  - UI section: utilisation progress bar with tone tiers (emerald < 75%,
    amber 75–90%, rose ≥ 90%), three-stat grid (allocated / spent /
    remaining — remaining goes rose if negative), a contract list with
    contract number, MRR (formatted via `formatIDR`), term window, and
    ACTIVE/DRAFT status pill.
  - Deliberately does NOT expose the underlying `project_expenses` rows
    (internal cost structure). Includes a privacy footnote in the UI:
    "Individual cost items are not shared."
  - i18n keys `portal.projectFinance.*` added in both locales.

- **Tenant admin — Client Portal user CRUD** (rules §17, §28 B.4 admin).
  Ops-high (OM+ / TENANT_ADMIN) can now invite, disable, and rotate
  passwords for portal users from the client detail page.
  - New PDP resource `client_portal_user` in `src/lib/security/pdp.ts`:
    OM+ / TENANT_ADMIN can create + update; GM / TENANT_ADMIN can
    delete. Standard read policy allows anyone within the tenant.
  - `src/lib/portal/crypto.ts` grows `generateTempPassword(length=12)`
    — 12-char rejection-sampled from a look-alike-free alphabet
    (no `0/O/I/l/1`) so admins can retype without ambiguity.
  - Server actions in
    `src/app/(app)/clients/[id]/portal-users/actions.ts`:
    - `createClientPortalUserAction` — creates the row, hashes the
      generated temp password with scrypt, returns the plaintext ONCE
      via the action result (never audited, never logged).
    - `resetClientPortalUserPasswordAction` — rotates the password and
      **revokes every active session** for the user.
    - `updateClientPortalUserStatusAction` — toggles ACTIVE/DISABLED;
      DISABLE also revokes sessions.
    - `listClientPortalUsers` — read helper for the admin page.
    All mutations go through `withSecureAction` so the PDP + audit
    contract (rules §17) is enforced.
  - Admin page `/clients/[id]/portal-users` (server component) shows a
    table of registered portal users with status pill, last sign-in
    timestamp, and per-row actions. Client component
    `portal-users-manager.tsx` renders three dialogs: **Invite**
    (email + full_name), **Reset password** (confirm → shows temp
    password once), **Enable/Disable** (confirm). Temp password panel
    has a "Copy" button and a bright warning that the value won't be
    shown again.
  - Client detail page (`/clients/[id]`) gains a "Manage portal users"
    button next to contact info.
  - i18n keys `clients.portalUsers.*` (+ `detail.managePortalUsers`)
    added in both `messages/{en,id}.json`.

- **Client Portal — B.3 Project detail + cross-client isolation E2E**
  (GAS §28, rules §28, §21). Closes the read-only slice of the portal:
  - New page `/portal/projects/[id]` shows the client-scoped project
    header (code, name, status badge, description), a summary card
    (progress bar + start/end/contract type) and a **milestone
    timeline** grouped by seq with per-status pills (PLANNED /
    IN_PROGRESS / AT_RISK / DONE / CANCELLED), planned window, and
    weight-basis-points converted to percent. Uses `getPortalProject` +
    `listPortalMilestones` from `src/lib/portal/data.ts` — both apply
    `.eq("tenant_id", …).eq("client_id", …)`, so a client requesting
    another tenant's project id gets `notFound()` (404 body, no data
    leak — we deliberately do NOT return "forbidden" so id existence is
    not disclosed).
  - Seeded a **second portal user** `client-indo@demo.controldesk.app`
    against PT Indo Retail Ceria (same tenant, different client) so
    isolation can be verified end-to-end. Same password hash reused.
  - `e2e/portal.spec.ts` — 9 Playwright tests covering: unauth redirects
    (`/portal`, `/portal/projects` → `/portal/login`), invalid password
    + unknown email keep user on `/portal/login` with a `role="alert"`
    banner, Nusa client sees own dashboard + own project code (`NUSA-CS`)
    on both dashboard and list, Nusa client can open the detail page
    and see the milestone timeline, cross-client isolation on the list
    (`INDO-HELP` MUST NOT appear when logged in as Nusa), direct URL
    access to another client's project id returns HTTP 404 with no
    leaked code, and the mirror case for Indo client.
  - i18n keys `portal.projectDetail.*` and `portal.milestoneStatus.*`
    added for both `messages/en.json` and `messages/id.json`.

- **Client Portal — B.1 Foundation + B.2 Shell** (GAS §28, rules §28, §21,
  §22). External clients (e.g. Rina at PT Nusa Digital) now sign in to a
  read-only portal at `/portal/login` on their tenant subdomain and see
  their own projects + progress. Highlights:
  - Migration 0032 adds `portal_login_events` (append-only, indexed by
    tenant + email + client_user; 7y retention alongside `security_audit_logs`)
    and a SECURITY DEFINER helper `resolve_tenant_id_by_slug()` grant-anon
    so the proxy can resolve tenant_id BEFORE the visitor authenticates
    (enumeration-safe: exposes only the id, no PII, no other columns).
  - `src/lib/portal/crypto.ts` — Node stdlib scrypt (N=16384, r=8, p=1)
    password hasher + opaque session tokens (32-byte base64url, sha256
    fingerprint stored). 10 unit tests covering happy path, unique-salt,
    corruption resistance, and token uniqueness.
  - `src/lib/portal/session.ts` — request-cached session lookup with hard
    TTL + soft revoke gate; `requirePortalSession()` redirects to
    `/portal/login` when anonymous.
  - `src/app/(portal)/actions.ts` — `portalLoginAction` (Zod-validated,
    lockout at 5 failures × 15min, uniform "incorrect credentials" reply
    to prevent user enumeration, audit-logged) and `portalLogoutAction`
    (revokes DB session + clears cookie + audits).
  - `src/lib/portal/data.ts` — RSC-safe helpers `listPortalProjects`,
    `getPortalProject`, `listPortalMilestones`, `getPortalDashboardStats`.
    Every helper enforces `.eq("tenant_id", ...)` AND `.eq("client_id", ...)`
    in one place — RLS cannot help here since portal callers have no JWT,
    so the app-layer filter is the ONLY tenant isolation guard (documented
    in a security contract at the top of the file).
  - `proxy.ts` grows a `/portal/*` branch: skips Supabase auth entirely,
    still resolves the tenant via the anon RPC so `getTenantContext()`
    works inside portal Server Actions.
  - Route group `(portal)` with `/portal/portal/*` on disk (nested one
    level to avoid Next.js route-group collision with `(app)/projects`
    and `(auth)/login`). Pages: `/portal/login`, `/portal` (dashboard
    with KPI tiles + recent projects), `/portal/projects` (full list
    with progress bars).
  - Portal layout: lightweight topbar (brand + workspace slug + sign-out
    + language/theme toggles), no sidebar. Read-only, mobile-first,
    prefers-reduced-motion respected.
  - Seed adds demo user `client@demo.controldesk.app` /
    `ControlDesk#2026` (scrypt hash precomputed, idempotent upsert)
    linked to PT Nusa Digital's 2 projects.
  - i18n: full `portal.*` namespace in `messages/{en,id}.json`
    (login, dashboard, project list, status labels).
  - `pnpm exec vitest run` → **879/879 passing** (+15 new: 10 crypto + 5
    portal-auth schema).
  - Deferred to Slice B.3: `/portal/projects/[id]` milestone timeline,
    Playwright coverage for cross-client isolation, invoice/expense
    visibility.
- **Reusable `<ApprovalChainProgress />` component** (rules §9, §23).
  New `src/components/approvals/approval-chain-progress.tsx` consolidates
  three previously-duplicated inline chain renderings (approvals inbox,
  budget-requests list, cash-advance new-sheet preview) into a single
  accessible component with `compact` and `preview` variants. Rendered as
  `<ol role="list">` with `aria-current="step"` on the active slot;
  optional `completed` set renders in emerald tone. All three call sites
  migrated with unchanged visuals.
- **Payroll weekly-approved provenance badge** (rules §14 · closes GAS
  §27 payroll loop). Each period card on `/hr/payroll` now shows a
  `{pct}% weekly` badge indicating the share of the period's APPROVED
  hours sourced from an APPROVED weekly packet vs. legacy per-day
  approvals. Emerald ≥75%, amber ≥25%, muted otherwise. Tooltip shows
  absolute weekly-hours vs. daily-only-hours. Query bounded by
  `[minStart, maxEnd]` of the last 12 periods and capped at 20k rows.
- **Playwright E2E for weekly timesheet flow** (rules §21). New
  `e2e/weekly-timesheet.spec.ts` walks a 4-step serial chain: employee
  sees seeded SUBMITTED packet (readonly), PM sees weekly section in
  approvals inbox, PM approves the packet via the inbox link,
  employee re-verifies APPROVED status. Login fixture hardened to select
  inputs by `type=` (shadcn `FormLabel` isn't reliably resolved by
  `getByLabel` when the input's accessible name comes from its
  placeholder). Global test timeout bumped to 120s to accommodate cold
  Next.js dev-server compiles.
- **Project Direct Labor Cost view** (rules §14 · closes GAS §27 loop).
  New `/projects/[id]` "Direct Labor Cost" card aggregates the current
  calendar month's APPROVED timesheet hours × per-employee `hourly_rate`
  (overtime at 1.5x) and displays per-employee breakdown with a
  weekly-approved provenance share (share of hours sourced from
  APPROVED `timesheet_weeks` packets vs. legacy daily approvals). Pure
  aggregation in `src/lib/payroll/direct-labor.ts` (11 unit tests,
  including an invariance test proving weekly-approved and daily-approved
  rows produce identical DLC totals). RSC helper
  `getProjectDirectLaborCost` performs a single join query wrapped in
  `React.cache()`. Payroll `generatePayrollPeriodAction` continues to
  filter `status='APPROVED'` — the weekly-approval cascade already flips
  child daily rows so the payroll aggregation transparently includes
  weekly-approved hours (documented inline).
- **Weekly Timesheet module** (GAS §27 · rules §14 · Fase 2). Migration
  `0031` introduces `timesheet_weeks` (one row per employee per ISO Monday,
  reusing the existing `timesheet_status` enum) + a nullable `week_id` FK on
  `public.timesheets` + an append-only `timesheet_week_approval_logs` audit
  trail. New `/hr/timesheets/weekly` list page and
  `/hr/timesheets/weekly/[weekStart]` grid editor let an employee fill Mon-Sun
  hours (optionally per project) and submit the whole week in one packet;
  Supervisor/PM/OM/HM/GM/HR then approve or reject the packet with cascade to
  every attached daily row. Approvals inbox now includes a weekly-timesheets
  section with realtime updates (Supabase channel added on
  `public.timesheet_weeks`) and the dashboard "Pending approvals" KPI counts
  submitted weekly packets. Zod schemas enforce a length-7 Mon..Sun packet
  with 2-decimal hours ≤ 24; ISO-week helpers (`weekStartFromDate`,
  `weekDatesFromStart`) are pure and UTC-safe. 23 unit tests for the state
  machine + week helpers, 11 for the Zod schemas. Seed materialises one
  SUBMITTED (current week) + one APPROVED (previous week) packet on demo
  tenant. i18n: `timesheets.weekly.*` in `messages/{en,id}.json`.
- **Project Issues SLA sweeper cron** (rules §26). `/api/cron/issues-sla-sweeper`
  (Vercel cron `*/15 * * * *`) climbs the Supervisor → PM → OM → Director
  escalation ladder for every active (`OPEN|IN_PROGRESS|REOPENED`) issue past
  its business-hours SLA. First breach emits `SLA_BREACHED` + `ESCALATED`
  events, subsequent climbs are gated by a 15-minute cooldown, and level 3
  emits one final `SLA_BREACHED` note (no notification spam). New assignee is
  resolved from `project_assignments` (PM / OM) or from tenant-wide Director
  roles (GENERAL_MANAGER, HEAD_MANAGER, DIRECTOR). `SLA_BREACH_WARNING`
  notifications go to the new assignee + reporter (on first breach). Pure
  decision logic in `src/lib/issues/escalation.ts` (11 unit tests). Supports
  `?dry_run=true` and records every run in `public.cron_run_log`.
- **CI + repository documentation.** GitHub Actions workflows for CI
  (typecheck / lint / test / build with coverage upload), E2E (boots
  Supabase local + walks every Playwright chain), Docker image
  verification, and Security (`pnpm audit` + CodeQL weekly).
  `dependabot.yml` grouped by ecosystem. Full `docs/` directory
  (`getting-started`, `architecture`, `security-model`, `development`,
  `testing`, `deployment`, `env-reference`, `api-reference`) plus
  `CONTRIBUTING.md`, `SECURITY.md`, `CODEOWNERS`, PR + issue templates,
  and this changelog.
- **LEAVE full-chain E2E** (`e2e/hr-leave-chain.spec.ts`, 6 tests) —
  closes the last E2E gap: Supervisor → PM → OM → HR admin. Rules §12.
- **Secret Rotation automation** (rules §22) — migration `0018` adds
  `public.secret_rotations` cross-tenant registry (with a no-delete
  trigger + `secret_rotation_status()` helper function) and seeds 8
  known secrets. `/api/cron/rotation-check` (Vercel cron `0 2 * * 1`,
  Monday 09:00 WIB) dispatches `SYSTEM` notifications to every ACTIVE
  `TENANT_ADMIN` for any secret in WARN (≤14 d remaining) or OVERDUE
  buckets. New `/settings/secrets` ops UI shows the registry with
  summary badges + a TENANT_ADMIN-only "Mark rotated" dialog that bumps
  `last_rotated_at` + `last_rotated_by`. PDP resource `secret_rotation`
  with role gates: read for TENANT_ADMIN + GM, update for TENANT_ADMIN
  only. +21 unit tests.
- **Archive restore UI** (rules §22) — `/settings/archives` lists the
  `data_archives` registry with per-row **Download** (300 s signed URL)
  and **Verify** (server-side gunzip + SHA-256 recompute → marks
  `restore_verified_at`). PDP resource `data_archive`, admin + GM.
  +20 unit tests. Runbook `docs/ops/data-retention.md` updated with
  the UI fast path.
- **AI Insights auto-refresh badge** — topbar Sparkles button with
  realtime count. `useSyncExternalStore` reads a per-`(tenant, user)`
  last-seen key from `localStorage`, cross-tab sync via `storage`
  event, auto-mark-as-read on navigate to `/insights`. Role-gated to
  management + finance. +11 unit tests.
- **PM Handover lifecycle E2E** (`e2e/pm-handover-chain.spec.ts`) —
  OM approve → HM approve → execute + verifies `PRIMARY_PM` swap
  reflects on the project detail page.
- **Observability sink** (rules §21) — pluggable `warn`/`error`/`fatal`
  dispatch supporting Sentry (raw envelope API) and Axiom (ingest API),
  with PII redaction, client crash reporter (`/api/observability/report`
  with Redis rate limit + same-origin check), and root + segment error
  boundaries. `x-request-id` propagation via `proxy.ts`.
- **Data retention cold-archive layer** — migration `0017` adds
  `data_archives` registry + `tenant-archives` Storage bucket + the
  `purge_archived_audit_logs` SECURITY DEFINER helper. Weekly cron
  `/api/cron/archive` exports rows past `archive_after_days` into
  gzip'd NDJSON with a SHA-256 checksum. Retention worker only purges
  after ARCHIVED registry row exists.
- **Cash Advance settlement acceptance flow** — Finance can accept
  submitted settlements with a Dialog + Return-for-corrections
  workflow. `SettlementReviewButtons` client component wired into the
  CA detail page.
- **E2E chain suites for Cash Advance, Petty Cash, and HR requests** —
  covers submit → approval → disbursement / settlement for the entire
  Finance stack + SICK and OVERTIME approval hops.

### Changed

- **Retention cron** now delegates to `purge_archived_audit_logs()` for
  audit-log purges so the immutability trigger stays in force. Only
  rows with a matching ARCHIVED `data_archives` row are eligible.
- **Nav config** gains a `settings` section (TENANT_ADMIN + GM only)
  with archives + secrets entries.

### Fixed

- **Critical — proxy silently disabled in Next.js 16 (Turbopack)** (rules
  §1, §3, §28). Discovered while running the Playwright audit for the
  client-portal suite: `proxy.ts` at repository root was being ignored
  by the dev server because Next 16 requires the proxy file to sit
  **next to the `app/` directory**. In this project `app/` lives under
  `src/`, so the correct location is `src/proxy.ts`. With the file at
  root, tenant + auth resolution silently no-op'd for every request:
  Server Actions saw `getTenantContext() → { id: null, slug: null }` and
  returned `TENANT_UNKNOWN`, which is what portal E2E tests were hitting.
  Fixed by relocating to `src/proxy.ts`. Documented in the file header
  (pointing to `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`)
  so a future refactor won't move it back.
- Portal `proxy.ts` tenant-id header propagation follows the Next 16
  documented pattern: clone `request.headers`, mutate the clone, and
  pass to `NextResponse.next({ request: { headers } })`. Mutating
  `request.headers` after `NextResponse.next({ request })` is a silent
  no-op for downstream RSC / Server Actions in Node runtime.
- Playwright `test.info().annotations.push()` was called at module
  level in `e2e/auth-login.spec.ts`, breaking
  `playwright test --list`. Moved inside a `beforeEach` hook.

## [0.1.0] — 2026-08-01

Initial platform skeleton. See the [README](README.md) for the full
list of shipped modules at this tag.

[Unreleased]: https://github.com/{{OWNER}}/controldesk/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/{{OWNER}}/controldesk/releases/tag/v0.1.0
