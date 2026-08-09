# QA & Testing docs

Panduan lengkap dari perspektif **QA / QC / Tester** untuk ControlDesk.
Doc ini melengkapi [`../testing.md`](../testing.md) (engineer-facing:
Vitest + Playwright config + coverage gates) dengan konten yang
berfokus pada:

- Strategi testing (test pyramid, quality gates, risk-based approach)
- E2E playbook operasional (run, debug, extend, best practices)
- Test catalog (apa yang di-test di mana)
- Test data + fixtures management
- Manual smoke scripts + release checklist
- Flake triage + selector conventions
- Accessibility testing (WCAG 2.2 AAA)
- Bug reporting + repro playbook

## Baca berdasarkan role Anda

| Role Anda                          | Mulai di sini                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------- |
| **QA Lead / Test Manager**         | [`testing-strategy.md`](testing-strategy.md) → [`test-catalog.md`](test-catalog.md) → [`manual-smoke-scripts.md#release-checklist--staging`](manual-smoke-scripts.md#release-checklist--staging) |
| **QA Engineer (hands-on)**         | [`e2e-playbook.md`](e2e-playbook.md) → [`test-data.md`](test-data.md) → [`flake-triage.md`](flake-triage.md) |
| **Manual Tester**                  | [`e2e-roleplay.md`](e2e-roleplay.md) → [`manual-smoke-scripts.md`](manual-smoke-scripts.md) → [`bug-reporting.md`](bug-reporting.md) |
| **PM / Product Owner (walkthrough demo)** | [`e2e-roleplay.md`](e2e-roleplay.md) → [`../product/approval-workflows.md`](../product/approval-workflows.md) |
| **Onboarding QA / dev baru**       | [`e2e-roleplay.md`](e2e-roleplay.md) → [`test-data.md`](test-data.md) |
| **Accessibility Auditor**          | [`accessibility-testing.md`](accessibility-testing.md)                             |
| **Developer nulis test baru**      | [`../testing.md`](../testing.md) + [`e2e-playbook.md#extending-tests`](e2e-playbook.md#extending-tests) |
| **Release Manager**                | [`manual-smoke-scripts.md#release-checklist--production`](manual-smoke-scripts.md#release-checklist--production) |

## Doc catalog

| Doc                                                    | Isi                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| [`testing-strategy.md`](testing-strategy.md)           | Test pyramid, quality gates, risk-based testing philosophy, coverage targets. |
| [`e2e-playbook.md`](e2e-playbook.md)                   | Setup, run, debug, extend Playwright suites; selector best practices; parallel vs serial. |
| [`e2e-roleplay.md`](e2e-roleplay.md)                   | Persona-driven E2E walkthroughs — 11 internal + 3 portal user acted out, cross-role chain scripts, denial matrix. |
| [`test-catalog.md`](test-catalog.md)                   | Test matrix — setiap Vitest + Playwright suite dan apa yang di-cover.     |
| [`test-data.md`](test-data.md)                         | Seed data structure, demo users, fixture patterns, tenant isolation contract. |
| [`manual-smoke-scripts.md`](manual-smoke-scripts.md)   | Manual smoke test per module + release checklist per environment.          |
| [`flake-triage.md`](flake-triage.md)                   | Common flake patterns + remediation + selector playbook.                   |
| [`accessibility-testing.md`](accessibility-testing.md) | WCAG 2.2 AAA verification: contrast, keyboard, ARIA, motion, screen reader. |
| [`bug-reporting.md`](bug-reporting.md)                 | Bug filing template, minimal repro, artifacts required, severity guide.    |

## Quality gates (WAJIB sebelum merge)

Empat gate otomatis di CI yang **HARUS hijau** sebelum PR bisa
di-merge ke `main`. Full detail: [`testing-strategy.md#quality-gates`](testing-strategy.md#quality-gates).

| Gate                                | Workflow                                        | Blocker jika gagal |
| ----------------------------------- | ----------------------------------------------- | ------------------ |
| Lint + typecheck + unit + build     | [`ci.yml`](../../.github/workflows/ci.yml)      | Yes                |
| Playwright chromium (E2E)           | [`e2e.yml`](../../.github/workflows/e2e.yml)    | Yes                |
| CodeQL security scan                | [`security.yml`](../../.github/workflows/security.yml) | Yes         |
| Coverage floor 80 % `src/lib/security/**` | Gated di [`ci.yml`](../../.github/workflows/ci.yml) via `pnpm test:coverage` | Yes  |

## The numbers (current state, 2026-08)

- **373 Vitest tests** di 52 file (unit + integration Node-side).
- **38 Playwright tests** di 15 chain suite (chromium desktop).
- **80% coverage floor** di `src/lib/security/**` — enforced.
- **~7-10 menit** total E2E turnaround di CI (Supabase boot + build + test).
- **11 demo users** di seed (satu per role internal + client portal).
- **1 demo tenant** (`demo`) dengan 3 demo clients + 5 demo projects.

## Related docs

- [`../testing.md`](../testing.md) — engineer-side testing (Vitest config, Playwright config).
- [`../architecture.md`](../architecture.md) — arsitektur high-level (paham dulu sebelum debug E2E).
- [`../security-model.md`](../security-model.md) — 4-lapis security (untuk RBAC/RLS test coverage).
- [`../product/approval-workflows.md`](../product/approval-workflows.md) — state machines yang di-test di chain suites.
- [`../product/roles-and-permissions.md`](../product/roles-and-permissions.md) — matriks role × resource yang di-test di PDP tests.
