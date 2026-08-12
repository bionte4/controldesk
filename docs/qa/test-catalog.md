# Test catalog

Matriks lengkap **apa yang di-test di mana**. Dipakai untuk:

- Cek coverage gap sebelum menerima PR.
- Cari test yang relevan saat regression debug.
- Onboarding QA baru — 1 place to see everything.

Terakhir di-verify: **2026-08-07** (52 Vitest files, 15 Playwright specs).

## Vitest (unit + integration)

### Security (`src/lib/security/**` — 80% coverage floor)

| File                                           | Cover apa                                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `security/pdp.test.ts`                         | PDP decisions untuk semua legacy 10-role × action × resource (expense, cash_advance, hr_request, project, budget, dst). Cross-tenant DENY. |
| `security/pdp-canonical.test.ts`               | PDP decisions untuk canonical 7-role (PM, OM, FINANCE, DIRECTOR, ADMIN + SUPERVISOR, EMPLOYEE). GAS-aligned modules. |
| `security/rotation.test.ts`                    | Secret rotation status math — window buckets (OK, WARN, OVERDUE) + threshold days.          |

### Validation (Zod schemas — target 90% coverage)

| File                                              | Cover apa                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `validation/auth.test.ts`                         | Login + register schemas (implicit via other tests).                   |
| `validation/budget.test.ts`                       | Budget submission + line items.                                        |
| `validation/budget-request.test.ts`               | Discriminated union INCREASE/DECREASE/TRANSFER + amount + justification. |
| `validation/cash-advance.test.ts`                 | Legacy CA submission.                                                  |
| `validation/cash-advance-canonical.test.ts`       | Canonical CA (`ca_type`, settlement due date logic).                   |
| `validation/client.test.ts`                       | Client master fields (slug uniqueness, contact).                       |
| `validation/expense.test.ts`                      | Expense submission (project, category, amount, receipt).               |
| `validation/handover.test.ts`                     | PM handover submission (outgoing, incoming, date, reason).             |
| `validation/hris.test.ts`                        | HR request base (kind, dates, reason).                                 |
| `validation/hr-schedule.test.ts`                  | LEAVE date range logic, OT hours bounds.                               |
| `validation/issue.test.ts`                        | Project issue (title, severity, description).                          |
| `validation/milestone.test.ts`                    | Project milestone (name, due date, status).                            |
| `validation/petty-cash.test.ts`                   | Petty cash voucher (amount, category, receipt req).                    |
| `validation/portal-auth.test.ts`                  | Client portal login schema.                                            |
| `validation/portal-change-password.test.ts`      | Password change (min 10 chars, letter+digit, confirm match, different from current). |
| `validation/project.test.ts`                     | Project create/update (code, name, dates, budget).                     |
| `validation/timesheet-week.test.ts`               | Weekly timesheet packet (ISO Monday, entries array).                   |

### State machines (per module)

| File                                             | Cover apa                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `budget-requests/state.test.ts`                  | State transitions: DRAFT → PENDING_PM? → PENDING_FINANCE → PENDING_DIRECTOR? → APPROVED → APPLIED. Reject paths. |
| `budget-requests/apply.test.ts`                  | Terminal `APPLIED` transaction — INCREASE/DECREASE/TRANSFER math + total_planned update. |
| `budgets/state.test.ts`                          | Budget submission chain state.                                                    |
| `cash-advance/state.test.ts`                     | Legacy CA state transitions.                                                     |
| `cash-advance/state-canonical.test.ts`           | Canonical CA state — General vs Field Ops, disburse, settle, revision.           |
| `cash-advance/inbox.test.ts`                     | CA inbox filtering by canonical role slot.                                       |
| `expenses/state.test.ts`                         | Expense state — legacy 5-level chain based on amount.                            |
| `handover/state.test.ts`                         | PM handover — DRAFT → PENDING_OM → PENDING_DIRECTOR → APPROVED → APPLIED.        |
| `hris/state.test.ts`                             | HR request state per kind (LEAVE/OT chain vs SICK short chain) + `hrChainForKind`. |
| `issues/state.test.ts`                           | Project issue — OPEN → IN_PROGRESS → RESOLVED → CLOSED → REOPENED loop.          |
| `issues/sla.test.ts`                             | SLA business-hours calc: severity → hours, respect timezone + business days.     |
| `issues/escalation.test.ts`                      | Escalation ladder Supervisor → PM → OM → Director, no double-escalate.          |
| `milestones/state.test.ts`                       | Milestone — PLANNED → IN_PROGRESS → DONE / AT_RISK / CANCELLED.                 |
| `timesheets/state.test.ts`                       | Daily timesheet transitions.                                                     |
| `timesheets/week-state.test.ts`                  | Weekly packet state + cascade to daily entries.                                  |

### RBAC + rules

| File                                             | Cover apa                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `rbac/roles.test.ts`                             | `toCanonicalRole()` fold mapping, `roleRank()`, `isStaffRole()`, `canApproveThreshold()`, `canonicalCanApprove()`. |
| `rbac/thresholds.test.ts`                        | Threshold matrix per resource: expense chain, budget, CA General, CA Field Ops, budget request. |

### Money + time + format

| File                                             | Cover apa                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `format/money.test.ts`                           | IDR format via `Intl.NumberFormat`. Zero decimals, thousands separator, no float drift. |
| `payroll/direct-labor.test.ts`                   | Direct Labor Cost formula: hours × rate + OT × rate × multiplier + allowances. |
| `payroll/compute.test.ts`                        | Payroll period aggregation across employees + provenance (weekly vs daily).    |

### AI + observability

| File                                             | Cover apa                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `ai/redact.test.ts`                              | PII redaction: names → hash, salary → range, bank → last-4, KTP dropped, tokens redacted. Deep nested payload. |
| `ai/schemas.test.ts`                             | Zod schemas for structured AI output (4 generators).                            |
| `ai/cost-cap.test.ts`                            | Per-tenant daily token cap via Redis counter, quota exceeded response.          |
| `ai/last-seen.test.ts`                           | AI insight read tracking per user.                                              |
| `observability/sink.test.ts`                     | Redaction sink — long hex/base64/JWT-shaped tokens scrubbed before dispatch.    |
| `notify/mailer.test.ts`                          | Email outbox + template rendering + retry policy.                               |

### Retention + i18n

| File                                             | Cover apa                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `retention/config.test.ts`                       | Retention window config per table (7yr audit, 10yr financial, 5yr HR anon).    |
| `retention/archive.test.ts`                      | Archive batch NDJSON export + gzip + SHA-256.                                   |
| `retention/verify.test.ts`                       | Archive checksum recomputation + status transitions.                            |
| `i18n/config.test.ts`                            | **PARITY test**: every key di `id.json` ada di `en.json`, dan sebaliknya. Runs fast, catches missed translation. |

### Portfolio + digest

| File                                             | Cover apa                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `portfolio/snapshot.test.ts`                    | Executive dashboard snapshot aggregation per tenant.                            |
| `digest/builder.test.ts`                         | Daily digest email content (per role: HR admin, finance, admin).                |

### Portal

| File                                             | Cover apa                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `portal/crypto.test.ts`                          | `hashPassword` scrypt, `verifyPassword`, session token gen + hash (SHA-256), `generateTempPassword`. |

## Playwright E2E (chain suites + isolation)

### Auth & routing

| Spec                             | Coverage                                                                            | Serial? |
| -------------------------------- | ----------------------------------------------------------------------------------- | ------- |
| `auth-login.spec.ts`             | Login happy path, wrong password reject, cross-tenant guard, role gating menu.     | No      |
| `landing.spec.ts`                | Public marketing page renders CTAs.                                                | No      |

### Approval chains (serial)

| Spec                             | Chain walked                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `cash-advance-chain.spec.ts`     | Legacy CA: Supervisor L1 → PM L2 → Finance L2.5 → Disburse → Settlement submit → Finance accept → SETTLED. Plus access-control denials (employee, supervisor cannot disburse). |
| `canonical-cash-advance.spec.ts` | Canonical CA (post-GAS align): General + Field Ops paths dengan `ca_type` decision + settlement SLA. |
| `petty-cash-chain.spec.ts`       | Custodian voucher submit → auto-approve tiers → Replenishment request → Finance approve → disburse. |
| `hr-requests-chain.spec.ts`      | SICK single-hop (Supervisor → HR) + OVERTIME mid-chain (PM → OM → HR).             |
| `hr-leave-chain.spec.ts`         | LEAVE full 4-hop: Supervisor L1 → PM L2 → OM L3 → HR final. Plus employee + finance denials. |
| `pm-handover-chain.spec.ts`      | Handover request → OM approve → Director approve → Apply → project PM swap verified. |
| `weekly-timesheet.spec.ts`       | Employee submit weekly packet → PM approve → cascade to daily entries APPROVED.    |

### View / inbox (parallel-safe)

| Spec                             | Coverage                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `approvals-inbox.spec.ts`        | Unified inbox — per role visibility (Supervisor sees L1, Finance sees Finance gate, dst). Realtime badge count. |
| `handovers.spec.ts`              | PM handover list visibility per role — OM sees pending, employee sees nothing.     |

### Portal (parallel-safe + serial for state)

| Spec                             | Coverage                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `portal.spec.ts`                 | Portal login (positive + negative), dashboard, project detail, milestones timeline, **cross-client isolation** (Nusa vs Indo — accessing other client project = 404), portal notifications feed + bell, financials section, force-change-password redirect + happy path. |
| `portal-users-admin.spec.ts`     | Tenant admin invite portal user (temp password reveal once), reset password (revoke sessions), enable/disable toggle. |

## Coverage map by feature

Silang-referensi dari **fitur** ke **test** yang cover — untuk audit
gap coverage per fitur.

### Client + Project management

| Feature                              | Vitest                                                     | Playwright                          |
| ------------------------------------ | ---------------------------------------------------------- | ----------------------------------- |
| Client master CRUD                   | `validation/client.test.ts`                                | (manual smoke — no E2E)             |
| Project create/update                | `validation/project.test.ts`                               | (manual smoke)                      |
| Project milestone status transitions | `milestones/state.test.ts`                                 | `portal.spec.ts` (verify done pill) |
| Project issue lifecycle              | `issues/state.test.ts`                                     | (manual smoke — no E2E)             |
| SLA business-hours calc              | `issues/sla.test.ts`                                       | (manual — cron behavior)            |
| SLA auto-escalation ladder           | `issues/escalation.test.ts`                                | (manual — cron behavior)            |
| PM assignment (allocation ≤ 100%)    | (rules embedded in `hris.test.ts` + Server Action)         | (manual smoke)                      |
| PM Handover apply transaction        | `handover/state.test.ts`                                   | `pm-handover-chain.spec.ts`         |

### Finance

| Feature                          | Vitest                                                          | Playwright                          |
| -------------------------------- | --------------------------------------------------------------- | ----------------------------------- |
| Expense chain (legacy 5-level)   | `expenses/state.test.ts`, `rbac/thresholds.test.ts`             | (planned — currently `cash-advance-chain` covers similar) |
| CA General chain                 | `cash-advance/state.test.ts`                                    | `canonical-cash-advance.spec.ts`    |
| CA Field Ops chain               | `cash-advance/state-canonical.test.ts`, `rbac/thresholds.test.ts`| `canonical-cash-advance.spec.ts`, `cash-advance-chain.spec.ts` |
| CA settlement + variance         | `cash-advance/state.test.ts`                                    | `cash-advance-chain.spec.ts` (settlement + refund verify) |
| CA settlement SLA (10 hari)      | (cron — manual test)                                            | (manual)                            |
| Petty Cash decision matrix       | `validation/petty-cash.test.ts`, `rbac/thresholds.test.ts`      | `petty-cash-chain.spec.ts`          |
| Petty Cash replenishment         | (state via Server Action)                                       | `petty-cash-chain.spec.ts`          |
| Budget submission                | `budgets/state.test.ts`, `validation/budget.test.ts`            | (manual smoke)                      |
| Budget Request apply             | `budget-requests/apply.test.ts`, `budget-requests/state.test.ts`| (manual smoke)                      |
| Approval Inbox realtime          | (integration — hard)                                            | `approvals-inbox.spec.ts`           |

### HRIS

| Feature                              | Vitest                                                     | Playwright                          |
| ------------------------------------ | ---------------------------------------------------------- | ----------------------------------- |
| Employee master (encrypted PII)      | (crypto helpers — Vitest + code review)                    | (manual smoke)                      |
| HR Request LEAVE 4-hop chain         | `hris/state.test.ts`                                       | `hr-leave-chain.spec.ts`            |
| HR Request OVERTIME 4-hop chain      | `hris/state.test.ts`                                       | `hr-requests-chain.spec.ts`         |
| HR Request SICK 2-hop chain          | `hris/state.test.ts`                                       | `hr-requests-chain.spec.ts`         |
| Leave date validation                | `validation/hr-schedule.test.ts`                           | (manual)                            |
| Daily timesheet approve              | `timesheets/state.test.ts`                                 | (via weekly packet indirectly)      |
| Weekly timesheet packet approve      | `timesheets/week-state.test.ts`                            | `weekly-timesheet.spec.ts`          |
| Direct Labor Cost calc               | `payroll/direct-labor.test.ts`, `payroll/compute.test.ts`  | (manual smoke)                      |
| Payroll lock + export CSV            | (state via Server Action)                                  | (manual smoke)                      |

### AI + Observability

| Feature                          | Vitest                                                     | Playwright                          |
| -------------------------------- | ---------------------------------------------------------- | ----------------------------------- |
| PII redaction before LLM         | `ai/redact.test.ts`                                        | (implicit — no E2E)                 |
| AI structured output schemas     | `ai/schemas.test.ts`                                       | (implicit)                          |
| Per-tenant daily token cap       | `ai/cost-cap.test.ts`                                      | (manual — Redis integration)        |
| Insight last-seen tracking       | `ai/last-seen.test.ts`                                     | (manual smoke)                      |
| Observability redaction sink     | `observability/sink.test.ts`                               | (manual)                            |
| Email outbox + retry             | `notify/mailer.test.ts`                                    | (manual — mailpit)                  |

### Retention + Compliance

| Feature                          | Vitest                                                     | Playwright                          |
| -------------------------------- | ---------------------------------------------------------- | ----------------------------------- |
| Retention window config          | `retention/config.test.ts`                                 | (cron manual)                       |
| Archive batch export             | `retention/archive.test.ts`                                | (manual — bucket verify)            |
| Archive checksum verify          | `retention/verify.test.ts`                                 | (manual)                            |
| HR employee anonymization        | (SQL function — integration test planned)                  | (manual — 5 yr retention drill)     |
| Secret rotation status           | `security/rotation.test.ts`                                | (manual — settings UI)              |

### Client Portal

| Feature                              | Vitest                                                     | Playwright                          |
| ------------------------------------ | ---------------------------------------------------------- | ----------------------------------- |
| Password hash (scrypt)               | `portal/crypto.test.ts`                                    | (implicit)                          |
| Session token gen + hash             | `portal/crypto.test.ts`                                    | (implicit)                          |
| Password change validation           | `validation/portal-change-password.test.ts`                | `portal.spec.ts` (force change)     |
| Portal login (positive + negative)   | `validation/portal-auth.test.ts`                           | `portal.spec.ts`                    |
| Cross-client isolation               | (impossible unit — needs DB)                               | `portal.spec.ts` (Nusa vs Indo)     |
| Portal notifications trigger         | (DB trigger — integration test planned)                    | `portal.spec.ts` (notification feed) |
| Financials section (no expense leak) | (contract — code review)                                   | `portal.spec.ts` (verify no expense list) |
| Admin CRUD portal users              | (via Server Action)                                        | `portal-users-admin.spec.ts`        |

### i18n + accessibility

| Feature                          | Vitest                                                     | Playwright                          |
| -------------------------------- | ---------------------------------------------------------- | ----------------------------------- |
| i18n key parity ID ↔ EN          | `i18n/config.test.ts`                                      | (manual — visual toggle)            |
| ARIA / keyboard / focus          | (no unit)                                                  | (manual — [`accessibility-testing.md`](accessibility-testing.md)) |
| Reduced motion respect            | (no unit)                                                  | (manual)                            |
| Color contrast (WCAG AAA)         | (no unit — Storybook / axe planned)                        | (manual)                            |

## Gaps + planned coverage

Yang **belum ada** tapi should exist:

| Gap                                | Priority | Planned solution                                              |
| ---------------------------------- | -------- | ------------------------------------------------------------- |
| Expense chain full E2E             | Medium   | New spec `e2e/expense-chain.spec.ts` (mirror CA chain style)  |
| Budget Request chain full E2E      | Medium   | New spec `e2e/budget-request-chain.spec.ts`                   |
| Project Issues + SLA cron E2E      | Low      | Manual smoke — hard to test cron in-suite                     |
| Insights page role gate E2E        | Low      | Spec `insights-page.spec.ts` planned                          |
| RLS SQL tests (pg_prove)           | Medium   | `supabase/tests/*.sql` runners at CI                          |
| Mutation testing (stryker)         | Low      | Once coverage stable                                          |
| Visual regression (percy)          | Low      | If UI stops iterating rapidly                                 |
| Load / performance                 | Low      | k6 / artillery once realistic traffic profile emerges         |
| Real device / cross-browser        | Low      | Manual pre-release Safari + Firefox smoke                     |
| Accessibility axe-core automation  | Medium   | `@axe-core/playwright` plugin in E2E suite                    |

Kalau Anda menemukan gap yang tidak listed, open issue dengan label
`test-gap` + attach ke rulebook § yang cover behavior tersebut.

## Where to look next

- Cara run test → [`e2e-playbook.md`](e2e-playbook.md).
- Cara add test → [`e2e-playbook.md#extending-tests`](e2e-playbook.md#extending-tests).
- Test data → [`test-data.md`](test-data.md).
