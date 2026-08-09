# ControlDesk documentation

Selamat datang. Index ini adalah cara tercepat untuk masuk ke bagian
codebase yang Anda butuhkan. Semua doc di-versioned di repo supaya
tetap sinkron dengan kode.

**Product + engineering source of truth** adalah [`.cursorrules`](../.cursorrules).
Docs di tree ini menjelaskan "bagaimana" — cara menjalankan, mengembangkan,
dan mengoperasikan ControlDesk. `.cursorrules` adalah "apa" dan "kenapa".

## Baca dulu berdasarkan role Anda

| Role Anda                                    | Mulai di sini                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Business / Product owner**                 | [`product/overview.md`](product/overview.md) → [`product/roles-and-permissions.md`](product/roles-and-permissions.md) → [`product/approval-workflows.md`](product/approval-workflows.md) |
| **End user (Employee / PM / Finance / HR)**  | [`user-guides/internal-users.md`](user-guides/internal-users.md) — cari section role Anda. |
| **Client eksternal (Portal user)**           | [`user-guides/client-portal-users.md`](user-guides/client-portal-users.md)          |
| **Engineer baru**                            | [`getting-started.md`](getting-started.md) → [`architecture.md`](architecture.md) → [`development.md`](development.md) |
| **Security / compliance auditor**            | [`security-model.md`](security-model.md) → [`ops/data-retention.md`](ops/data-retention.md) → [`ops/secret-rotation.md`](ops/secret-rotation.md) |
| **On-call engineer**                         | [`ops/`](ops/) — semua runbooks.                                                    |
| **QA / QC / Tester**                         | [`qa/`](qa/) — testing strategy, E2E playbook, test catalog, manual smoke, flake triage, a11y, bug reporting. |
| **Trainer / Program Manager**                | [`training/README.md`](training/README.md) → [`training/curriculum.md`](training/curriculum.md) → [`training/facilitator-guide.md`](training/facilitator-guide.md) |
| **Tenant Admin (baru di ControlDesk)**       | [`getting-started.md`](getting-started.md) + [`user-guides/internal-users.md#tenant-admin`](user-guides/internal-users.md#tenant-admin) + [`training/README.md`](training/README.md) |

## Product / business

Konteks bisnis & fungsional. Baca ini kalau Anda perlu memahami APA
yang dilakukan ControlDesk dan KENAPA sebelum masuk ke kode.

| Doc                                                                              | Isi                                                                        |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`product/overview.md`](product/overview.md)                                     | Product overview, personas, feature matrix, non-goals, tech overview.     |
| [`product/glossary.md`](product/glossary.md)                                     | Istilah bisnis + teknis + akronim (bilingual EN/ID).                       |
| [`product/roles-and-permissions.md`](product/roles-and-permissions.md)           | 10-role legacy vs 7-role canonical, capability matrix per resource.        |
| [`product/approval-workflows.md`](product/approval-workflows.md)                 | Threshold matrix, approval chains, state machines per module.              |

## Business modules

Doc bisnis + teknis per modul — struktur folder, state machine, business
rules, dan tautan ke Server Actions.

| Doc                                                                              | Isi                                                                          |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`modules/clients-and-portal.md`](modules/clients-and-portal.md)                 | Client master, BPO contracts, SLA, Client Portal.                            |
| [`modules/projects.md`](modules/projects.md)                                     | Projects, assignments, milestones, issues (SLA + escalation), PM handover.  |
| [`modules/finance.md`](modules/finance.md)                                       | Expenses, Cash Advance (General + Field Ops), Petty Cash, Budget Requests.  |
| [`modules/hris-and-payroll.md`](modules/hris-and-payroll.md)                     | Employee master (encrypted PII), shifts/roster, HR requests, timesheets, payroll. |
| [`modules/ai-and-notifications.md`](modules/ai-and-notifications.md)             | AI insights (4 generators + safety), notifications (in-app + email + realtime). |

## External integrations

Konfigurasi + setup + troubleshooting untuk semua integrasi pihak ketiga
(AI provider, messaging channels, calendar). Struktur konsisten — Setup
step-by-step, arsitektur, security, troubleshooting, FAQ. Bilingual.

| Doc                                                                              | Isi                                                                                    |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [`integrations/README.md`](integrations/README.md)                               | Hub — katalog integrasi, kapan pakai apa, security summary.                            |
| [`integrations/ai-insights-gemini.md`](integrations/ai-insights-gemini.md)       | Google Gemini setup, locale-aware prompt, PII redaction, model selection, cost.        |
| [`integrations/telegram-bot.md`](integrations/telegram-bot.md)                   | Per-tenant BotFather flow, admin config, user pairing via HMAC deep link.              |
| [`integrations/whatsapp-fonnte.md`](integrations/whatsapp-fonnte.md)             | Fonnte device pairing, ToS caveat, provider-adapter pattern, self-messaging pitfall.   |
| [`dev-tools.md`](dev-tools.md)                                                   | CLI reference: `pnpm test:ai / test:tg / test:wa / fonnte:device` — smoke test tools.  |

## Reference

Data structure + state machines dalam satu tempat.

| Doc                                                                              | Isi                                                                          |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`reference/database-schema.md`](reference/database-schema.md)                   | ER diagram, migration timeline, table catalog, enum reference.               |
| [`reference/state-machines.md`](reference/state-machines.md)                     | Setiap state machine dalam satu diagram visual.                              |
| [`env-reference.md`](env-reference.md)                                           | Setiap variabel `.env`, default, dan pemilik.                                |
| [`api-reference.md`](api-reference.md)                                           | Cron + observability + health endpoints (contract + auth).                   |

## Engineering onboarding

| Doc                                                | Kapan baca                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| [`getting-started.md`](getting-started.md)         | Hari pertama. Boot app, sign in, pahami seed.                    |
| [`architecture.md`](architecture.md)               | Sebelum change non-trivial.                                      |
| [`security-model.md`](security-model.md)           | Sebelum tulis Server Action apa pun.                             |
| [`development.md`](development.md)                 | Setiap hari. Feature folder + Server Action + i18n contract.     |
| [`testing.md`](testing.md)                         | Sebelum push. Coverage gates + Playwright chain suites.          |
| [`deployment.md`](deployment.md)                   | Sebelum deploy. Docker / Vercel / Supabase + CI/CD pipeline.     |

## User guides

Panduan operasional untuk pengguna real.

| Doc                                                                              | Untuk siapa                                                                  |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`user-guides/internal-users.md`](user-guides/internal-users.md)                 | Staff internal — Employee, Supervisor, PM, OM, Director, Finance, HR Admin, Tenant Admin. |
| [`user-guides/client-portal-users.md`](user-guides/client-portal-users.md)       | Klien eksternal yang login via `/portal`.                                    |

## QA / testing (`qa/`)

Panduan lengkap dari perspektif QA, tester, dan release manager. Semua
komplemen [`testing.md`](testing.md) (engineer-facing).

| Doc                                                                        | Isi                                                                        |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`qa/README.md`](qa/README.md)                                             | Index QA docs — masuk sesuai role Anda.                                    |
| [`qa/testing-strategy.md`](qa/testing-strategy.md)                         | Test pyramid, quality gates, risk-based approach, coverage philosophy.     |
| [`qa/e2e-playbook.md`](qa/e2e-playbook.md)                                 | Setup + run + debug + extend Playwright, selector best practices.          |
| [`qa/test-catalog.md`](qa/test-catalog.md)                                 | Matrix lengkap: 52 Vitest + 15 Playwright specs vs feature coverage map.   |
| [`qa/test-data.md`](qa/test-data.md)                                       | Seed data + demo users + fixtures + isolation contracts.                   |
| [`qa/manual-smoke-scripts.md`](qa/manual-smoke-scripts.md)                 | Per-module manual smoke + pre-merge + release checklist (staging + prod). |
| [`qa/flake-triage.md`](qa/flake-triage.md)                                 | 10 kategori flake + fix pattern + quarantine policy.                       |
| [`qa/accessibility-testing.md`](qa/accessibility-testing.md)               | WCAG 2.2 AAA verification: contrast, keyboard, ARIA, motion, screen reader. |
| [`qa/bug-reporting.md`](qa/bug-reporting.md)                               | Bug filing template, severity guide, repro playbook, ready-to-use templates. |

## Training (`training/`)

Materi persiapan program **training pengguna** ControlDesk — onboarding
tenant baru, upskill karyawan lama, refresher setelah rilis fitur besar.
Struktur: hub + silabus + lab hands-on + panduan trainer + rubric evaluasi.

| Doc                                                                        | Isi                                                                          |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`training/README.md`](training/README.md)                                 | Hub — tujuan program, audiens, 4 role tracks (T1–T4), timeline 2-hari.       |
| [`training/curriculum.md`](training/curriculum.md)                         | Silabus 6 sesi (S1 Foundation → S6 Admin & Governance) × 4 tracks.           |
| [`training/user-guide-workflows.md`](training/user-guide-workflows.md)     | User guide visual — alur harian per role + 12 scenario end-to-end (Mermaid). |
| [`training/hands-on-labs.md`](training/hands-on-labs.md)                   | 12 lab praktik: login, WBS+Gantt, expense/CA chain, petty cash, integrations. |
| [`training/facilitator-guide.md`](training/facilitator-guide.md)           | Panduan trainer: setup sandbox, timing, contingency, pelaporan akhir.        |
| [`training/evaluation.md`](training/evaluation.md)                         | Rubric assessment: quiz 25 soal + hands-on scenario per track + 30-day check. |

## Ops runbooks (`ops/`)

On-call reading. Print, tab, dan follow literally saat insiden.
Mapping 1:1 ke section `.cursorrules` yang butuh operational surface.

| Runbook                                                 | Coverage                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| [`ops/data-retention.md`](ops/data-retention.md)        | 10-year retention, cold archive layout, restore procedure.  |
| [`ops/observability.md`](ops/observability.md)          | Sentry / Axiom configuration, redaction, request IDs.       |
| [`ops/secret-rotation.md`](ops/secret-rotation.md)      | 90-day rotation calendar + automation cron.                 |

## Community + repo files

| File                                                | Purpose                                                       |
| --------------------------------------------------- | ------------------------------------------------------------- |
| [`../README.md`](../README.md)                      | Top-level overview + first-run.                               |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md)          | Cara open PR yang akan di-merge.                              |
| [`../SECURITY.md`](../SECURITY.md)                  | Vulnerability disclosure policy + response SLAs.              |
| [`../CHANGELOG.md`](../CHANGELOG.md)                | Setiap perubahan user-visible, dimapping ke `.cursorrules`.   |
| [`../.github/CODEOWNERS`](../.github/CODEOWNERS)    | Review routing per surface.                                   |

## Doc map (visual)

```
docs/
├── README.md                            (Anda di sini)
│
├── product/                             ← Business + product context
│   ├── overview.md
│   ├── glossary.md
│   ├── roles-and-permissions.md
│   └── approval-workflows.md
│
├── modules/                             ← Per-module business + tech docs
│   ├── clients-and-portal.md
│   ├── projects.md
│   ├── finance.md
│   ├── hris-and-payroll.md
│   └── ai-and-notifications.md
│
├── integrations/                        ← External integration playbooks
│   ├── README.md
│   ├── ai-insights-gemini.md
│   ├── telegram-bot.md
│   └── whatsapp-fonnte.md
│
├── reference/                           ← Structured references
│   ├── database-schema.md
│   └── state-machines.md
│
├── user-guides/                         ← End-user operational guides
│   ├── internal-users.md
│   └── client-portal-users.md
│
├── ops/                                 ← On-call runbooks
│   ├── data-retention.md
│   ├── observability.md
│   └── secret-rotation.md
│
├── qa/                                  ← QA / QC / Tester playbooks
│   ├── README.md
│   ├── testing-strategy.md
│   ├── e2e-playbook.md
│   ├── test-catalog.md
│   ├── test-data.md
│   ├── manual-smoke-scripts.md
│   ├── flake-triage.md
│   ├── accessibility-testing.md
│   └── bug-reporting.md
│
├── training/                            ← Persiapan program training pengguna
│   ├── README.md                        (hub + role tracks)
│   ├── curriculum.md                    (silabus 6 sesi)
│   ├── user-guide-workflows.md          (alur harian per role + 12 sequence diagram)
│   ├── hands-on-labs.md                 (12 lab praktik)
│   ├── facilitator-guide.md             (guide untuk trainer)
│   └── evaluation.md                    (rubric assessment + quiz)
│
├── architecture.md                      ← Engineering deep-dive
├── security-model.md
├── development.md
├── testing.md
├── deployment.md
├── getting-started.md
├── env-reference.md
├── api-reference.md
└── dev-tools.md                         ← CLI smoke test tooling
```

## Contributing to docs

Docs adalah first-class artifact — patch ke docs kena review yang sama
seriusnya dengan patch ke kode. Aturan:

1. **Struktur folder** — kalau menambah doc baru, pilih folder yang
   tepat (product / modules / reference / user-guides / ops) dan
   update index ini.
2. **Dwibahasa** — istilah bisnis boleh + preferred pakai Bahasa
   Indonesia. Istilah teknis (Server Action, RSC, RLS, dst) tetap
   English. Kalau ragu, lihat [`product/glossary.md`](product/glossary.md).
3. **Grounded pada kode** — kalau doc mendeskripsikan flow, sertakan
   link ke file + function name. Kalau flow berubah, patch doc di PR
   yang sama.
4. **Mermaid untuk diagram** — semua state machine + flow diagram pakai
   Mermaid, bukan external image. Rendered di GitHub + banyak markdown
   viewer.
5. **Test snippet** — kalau ada code sample, sample harus **valid** —
   yang dieksekusi di test atau kutipan dari kode nyata di repo.

Untuk lint doc + broken links check, ada workflow `.github/workflows/docs.yml` (planned).
