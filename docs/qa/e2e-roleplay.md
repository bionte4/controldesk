# E2E roleplay — persona-driven test walkthroughs

Panduan **role-based** untuk QA / Tester / PM baru yang perlu memahami
"siapa melakukan apa" di E2E ControlDesk. Setiap demo user diperlakukan
sebagai **persona / karakter cerita**, dan setiap alur bisnis (approval
chain, disbursement, settlement, portal read) ditulis sebagai **script
adegan**: siapa login, klik apa, di layar mana, dan efeknya bagaimana
di layar aktor berikutnya.

> **Kapan dipakai?**
>
> 1. Tester manual mau exercise happy-path + denial per role tanpa
>    baca kode Playwright.
> 2. Onboarding QA / PM / product owner baru — belajar model
>    approval + isolation lewat cerita, bukan tabel enum.
> 3. Bug hunting: ketika satu step gagal, doc ini menunjukkan step
>    mana yang seharusnya jalan.
> 4. Regression session sebelum release — jadikan checklist adegan.

Doc pelengkap:

- [`e2e-playbook.md`](e2e-playbook.md) — cara run / debug Playwright.
- [`test-catalog.md`](test-catalog.md) — matrix seluruh test suite.
- [`test-data.md`](test-data.md) — struktur seed + fixture.
- [`manual-smoke-scripts.md`](manual-smoke-scripts.md) — smoke test manual per module.
- [`../product/roles-and-permissions.md`](../product/roles-and-permissions.md) — legal permission per role.

## Table of contents

- [Cara menggunakan roleplay ini](#cara-menggunakan-roleplay-ini)
- [Login pattern universal](#login-pattern-universal)
- [Cast — 11 persona internal + 3 portal](#cast--11-persona-internal--3-portal)
- [Persona cards](#persona-cards)
  - [Ayu Admin — Tenant Administrator](#ayu-admin--tenant-administrator)
  - [Gita General — General Manager / Director](#gita-general--general-manager--director)
  - [Hendra Head — Head Manager / Director](#hendra-head--head-manager--director)
  - [Omar Operations — Operations Manager](#omar-operations--operations-manager)
  - [Putri PM — Project Manager (Nusa portfolio)](#putri-pm--project-manager-nusa-portfolio)
  - [Prima PM2 — Project Manager (Indo portfolio)](#prima-pm2--project-manager-indo-portfolio)
  - [Sinta Supervisor — Team Lead / Field Supervisor](#sinta-supervisor--team-lead--field-supervisor)
  - [Eko Employee — Individual Contributor](#eko-employee--individual-contributor)
  - [Fajar Finance — Lead Finance](#fajar-finance--lead-finance)
  - [Hana HR — HR Administrator](#hana-hr--hr-administrator)
  - [Pandu Petty — Petty Cash Custodian](#pandu-petty--petty-cash-custodian)
  - [Portal: PT Nusa client](#portal-pt-nusa-client)
  - [Portal: PT Indo client](#portal-pt-indo-client)
  - [Portal: Newbie client (PENDING\_ACTIVATION)](#portal-newbie-client-pending_activation)
- [Cross-role chain scripts](#cross-role-chain-scripts)
  - [Adegan 1: Cash Advance kecil (< 5jt) — Nusa CS](#adegan-1-cash-advance-kecil--5jt--nusa-cs)
  - [Adegan 2: Cash Advance settlement — refund 200rb](#adegan-2-cash-advance-settlement--refund-200rb)
  - [Adegan 3: Petty Cash replenishment — Jakarta HQ fund](#adegan-3-petty-cash-replenishment--jakarta-hq-fund)
  - [Adegan 4: Weekly timesheet approval — Eko → Putri](#adegan-4-weekly-timesheet-approval--eko--putri)
  - [Adegan 5: Portal isolation — Nusa vs Indo](#adegan-5-portal-isolation--nusa-vs-indo)
  - [Adegan 6: FIELD\_OPS canonical CA — chain preview](#adegan-6-field_ops-canonical-ca--chain-preview)
- [Access-control matrix (denial map)](#access-control-matrix-denial-map)
- [Data-recovery notes](#data-recovery-notes)
- [Extending — menulis adegan baru](#extending--menulis-adegan-baru)

## Cara menggunakan roleplay ini

**Untuk manual tester**:

1. `pnpm db:reset` dulu — seed harus fresh (banyak chain di sini
   mengonsumsi row seed yang state-nya berubah setelah dijalankan).
2. Buka doc ini + browser Chrome/Edge side-by-side.
3. Pilih satu adegan → ikuti step 1 sampai selesai → tandai
   ✅/❌/⚠️ di [`manual-smoke-scripts.md`](manual-smoke-scripts.md).
4. Kalau step gagal, catat: "Step 3 gagal — button Approve tidak
   muncul walau status PENDING\_L1". File bug pakai
   [`bug-reporting.md`](bug-reporting.md) sebagai template.

**Untuk QA engineer**:

1. Sebelum tambah Playwright spec baru, cek dulu adegan mana yang
   sudah ada di doc ini agar tidak duplikat.
2. Setiap E2E spec baru → tambahkan section adegan di doc ini
   (persona-driven), bukan cuma di [`test-catalog.md`](test-catalog.md).
3. Adegan baru harus menyebut: aktor, URL, action, expected UI outcome,
   dan state DB setelah action (jika relevan).

**Untuk developer**:

1. Doc ini adalah **contract permission** yang tester akan verify.
2. Kalau ubah UI/PDP yang bikin salah satu step "not applicable
   lagi", update doc ini di PR yang sama.
3. Untuk demo product owner — pakai adegan sebagai script walkthrough
   (contoh: Adegan 1 = "3-menit demo approval chain").

## Login pattern universal

Semua persona internal login lewat `/login`. Client portal user
lewat `/portal/login`.

Password universal (dev + demo): **`ControlDesk#2026`**.

Alur login (mirroring `e2e/fixtures.ts::loginAs`):

1. Buka `http://demo.localhost:3000/login` (internal) atau
   `http://demo.localhost:3000/portal/login` (client).
2. Tab "Password" (default). Field email + password.
3. Klik "Sign in" / "Masuk".
4. Setelah berhasil, redirect otomatis:
   - Internal → `/dashboard`
   - Portal → `/portal/dashboard`
   - Portal user status `PENDING_ACTIVATION` → paksa
     `/portal/change-password` (Adegan 5c).

Kalau login gagal:

- **Bad credentials** → toast merah "Email atau password salah".
- **Portal user login pakai `/login` internal** → tolak dengan
  pesan role mismatch (portal user tidak punya `employees` row).
- **Internal user login pakai `/portal/login`** → sama, tolak.

## Cast — 11 persona internal + 3 portal

| Slug          | Nama                | Role legacy            | Role canonical | Reporting line       |
| ------------- | ------------------- | ---------------------- | -------------- | -------------------- |
| `admin`       | Ayu Admin           | `TENANT_ADMIN`         | `ADMIN`        | (top)                |
| `gm`          | Gita General        | `GENERAL_MANAGER`      | `DIRECTOR`     | → `admin`            |
| `hm`          | Hendra Head         | `HEAD_MANAGER`         | `DIRECTOR`     | → `gm`               |
| `om`          | Omar Operations     | `OPERATIONS_MANAGER`   | `OM`           | → `hm`               |
| `pm`          | Putri PM            | `PROJECT_MANAGER`      | `PM`           | → `om`               |
| `pm2`         | Prima PM2           | `PROJECT_MANAGER`      | `PM`           | → `om`               |
| `supervisor`  | Sinta Supervisor    | `SUPERVISOR`           | `SUPERVISOR`   | → `pm`               |
| `employee`    | Eko Employee        | `EMPLOYEE`             | `EMPLOYEE`     | → `supervisor`       |
| `finance`     | Fajar Finance       | `LEAD_FINANCE`         | `FINANCE`      | → `admin` (off-ladder) |
| `hr`          | Hana HR             | `HR_ADMIN`             | `ADMIN`        | → `admin` (off-ladder) |
| `pettycash`   | Pandu Petty         | `PETTY_CASH_CUSTODIAN` | `FINANCE`      | → `admin` (off-ladder) |

Portal cast (client-facing):

| Slug     | Email                                 | Client                | Status                 |
| -------- | ------------------------------------- | --------------------- | ---------------------- |
| `nusa`   | `client@demo.controldesk.app`         | PT Nusa Digital       | `ACTIVE`               |
| `indo`   | `client-indo@demo.controldesk.app`    | PT Indo Retail Ceria  | `ACTIVE`               |
| `newbie` | `client-new@demo.controldesk.app`     | PT Nusa Digital       | `PENDING_ACTIVATION`   |

Semua persona di atas otomatis di-seed oleh `supabase/seed.sql` saat
`pnpm db:reset`. Kredensial + rincian teknis di
[`test-data.md`](test-data.md).

## Persona cards

Setiap card mengikuti struktur:

- **Identitas** — nama, email, role, reporting line.
- **Kompetensi bisnis** — apa peran real-world-nya.
- **E2E specs where I play** — daftar file spec Playwright.
- **Positif — yang saya boleh lakukan** — action yang seharusnya sukses.
- **Denial — yang saya TIDAK boleh lakukan** — action yang seharusnya
  ditolak PDP/RLS/UI.
- **Seed context** — row yang berkaitan dengan persona ini di
  `supabase/seed.sql`.

### Ayu Admin — Tenant Administrator

- **Email**: `admin@demo.controldesk.app`
- **Role**: `TENANT_ADMIN` (canonical: `ADMIN`)
- **Kompetensi**: super-admin tenant. Manage user, role, master data,
  konfigurasi threshold approval, akses semua audit log.

**E2E specs where I play**:

- `e2e/projects-wizard.spec.ts` — admin membuat proyek 3-step wizard.
- `e2e/portal-users-admin.spec.ts` — admin invite / suspend client portal user.
- `e2e/contracts.spec.ts` — admin upload contract PDF (Supabase Storage).
- `e2e/client-edit.spec.ts` — admin edit master client.

**Positif — yang saya boleh lakukan**:

- Buka `/settings/users` → invite user baru → assign role apapun.
- Buka `/projects` → klik **New project** → 3 step wizard → publish.
- Buka `/settings/integrations/telegram` → paste bot token → activate.
- Buka `/settings/integrations/whatsapp` → paste Fonnte device
  token → test send.
- Override approve/reject di level manapun (audit log tetap tercatat).
- Baca `security_audit_logs` full history (7 tahun retention).

**Denial**:

- Tetap **tidak boleh** hard-delete row financial (`project_expenses`,
  `cash_advances`, `petty_cash_vouchers`) — hanya cancel/void. Trigger
  DB block hard delete regardless of role.
- Tetap **tidak boleh** akses tenant lain — RLS filter by
  `tenant_id` di semua RPC/Storage path.

**Seed context**: baris `admin` di `supabase/seed.sql §3`.

**Roleplay — invite user portal baru**:

1. Login sebagai `admin`.
2. Buka `/settings/portal-users`.
3. Klik **Invite portal user** → isi email `newportal@example.com` +
   pilih client "PT Nusa Digital".
4. Submit → expect toast success + row baru muncul dengan status
   `PENDING_ACTIVATION`.
5. Buka mailpit (dev only) di `http://localhost:8025` → email undangan
   berisi magic link.

### Gita General — General Manager / Director

- **Email**: `gm@demo.controldesk.app`
- **Role**: `GENERAL_MANAGER` (canonical: `DIRECTOR`)
- **Kompetensi**: executive tier. Approve terminal untuk expense/CA
  ≥ 50jt. Read-all dashboard. Owner secret rotation + calendar sync
  admin config.

**E2E specs where I play**:

- `e2e/cash-advance-chain.spec.ts` — hanya di CA >= 50jt (belum di
  seeded default suite; ditambahkan saat regression khusus).
- `e2e/handovers.spec.ts` (currently skip per §13 deprecated).

**Positif**:

- Buka `/dashboard` → lihat KPI seluruh tenant (semua project, semua
  client, semua budget).
- Buka `/finance/cash-advances/:id` untuk CA >= 50jt → tombol
  **Approve L3** muncul.
- Buka `/settings/secret-rotation` → view scheduled rotation.
- Short-circuit chain di bawahnya kalau perlu — expect wajib isi
  justification ≥ 20 karakter.

**Denial**:

- CA < 50jt: **tidak** ada tombol Approve di CA yang belum sampai L3
  (chain tidak melewati Director).
- **Tidak** boleh execute PM handover (itu jatah OM/HM).
- **Tidak** boleh curate CoA (itu jatah Finance).

**Seed context**: baris `gm` di seed §3, `reports_to_employee_id = admin`.

### Hendra Head — Head Manager / Director

- **Email**: `hm@demo.controldesk.app`
- **Role**: `HEAD_MANAGER` (canonical: `DIRECTOR`)
- **Kompetensi**: portfolio-level oversight. Approve PM handover level 2
  (PENDING\_HM).

**E2E specs where I play**:

- `e2e/pm-handover-chain.spec.ts` — HM approves L2 → APPROVED.
  (Suite lifecycle chain — DEPRECATED per §13, tapi skenario tetap
  didokumentasikan untuk reference.)

**Positif**:

- Buka `/handovers/:id` yang statusnya `PENDING_HM` → tombol
  **Approve** aktif.
- Read-all pada portfolio + budget.

**Denial**:

- **Tidak** langsung execute handover — itu OM.
- **Tidak** ada tombol PM handover initiate (itu OM+).

**Seed context**: baris `hm` di seed §3.

### Omar Operations — Operations Manager

- **Email**: `om@demo.controldesk.app`
- **Role**: `OPERATIONS_MANAGER` (canonical: `OM`)
- **Kompetensi**: membawahi 2+ PM (Putri + Prima). Approver Field Ops CA
  ≥ 20jt. Initiator + executor PM handover.

**E2E specs where I play**:

- `e2e/pm-handover-chain.spec.ts` — OM approve L1 + execute.
- `e2e/approvals-inbox.spec.ts` — OM sees inbox with PM-handover pending.
- `e2e/canonical-cash-advance.spec.ts` — OM appears in FIELD_OPS chain
  saat amount ≥ 20jt.

**Positif**:

- Buka `/handovers` → lihat handover PENDING\_OM di list.
- Klik row → detail page → **Approve** → flip status ke PENDING\_HM.
- Setelah handover jadi APPROVED → OM balik lagi → **Execute** → SQL
  `finalise_pm_handover` flip PM active pada project.
- Buka `/approvals` → inbox unified untuk portfolio-nya.
- Cancel handover milik sendiri (bila jadi initiator).

**Denial**:

- **Tidak** ada tombol Disburse di CA (itu Finance).
- **Tidak** boleh HR-approval level 3 kalau `hr_requests` DEPRECATED
  (§12) — semua leave/sick sekarang lewat Timesheet.

**Seed context**: baris `om` di seed §3, plus handover
`88888888-1111-4111-8111-111111111111` menargetkan proyek Kirana pilot.

### Putri PM — Project Manager (Nusa portfolio)

- **Email**: `pm@demo.controldesk.app`
- **Role**: `PROJECT_MANAGER` (canonical: `PM`)
- **Kompetensi**: PM primary untuk NUSA-CS + NUSA-DATA. Approver
  level 2 untuk expense/CA di rentang PM threshold.

**E2E specs where I play**:

- `e2e/cash-advance-chain.spec.ts` — PM approve L2 pada CA 1.5jt.
- `e2e/weekly-timesheet.spec.ts` — PM approve packet SUBMITTED milik
  Eko Employee.
- `e2e/portal-users-admin.spec.ts` — PM read-only pada client-portal
  registry milik projectnya.

**Positif**:

- Buka `/finance/cash-advances/{CA_PENDING}` (status PENDING\_L2\_PM) →
  tombol **Approve** aktif.
- Buka `/hr/timesheets/weekly/{WEEK_START}` → review packet Eko →
  **Approve** → status APPROVED.
- Buka `/projects/{NUSA-CS}` → edit milestones + assign employee.
- Buka `/approvals` → inbox untuk portfolio Nusa.

**Denial**:

- **Tidak** ada tombol Approve pada CA milik portfolio Indo (Prima).
- **Tidak** boleh bulk-import employees / budget (itu HR/Finance/Admin).
- **Tidak** boleh execute PM handover (itu OM+).
- **Tidak** boleh Disburse CA (itu Finance).

**Seed context**: baris `pm` di seed §3. Assignment di
`project_pm_assignments` untuk NUSA-CS + NUSA-DATA.

### Prima PM2 — Project Manager (Indo portfolio)

- **Email**: `pm2@demo.controldesk.app`
- **Role**: `PROJECT_MANAGER` (canonical: `PM`)
- **Kompetensi**: PM primary untuk INDO-HELP. Digunakan sebagai target
  PM baru di skenario handover.

**E2E specs where I play**:

- `e2e/pm-handover-chain.spec.ts` — Prima menjadi PM baru setelah
  handover di-execute → project detail page harus tampilkan namanya.

**Positif**:

- Semua Putri bisa, tapi lingkupnya Indo (bukan Nusa).
- Setelah handover execute, jadi PRIMARY_PM untuk Kirana pilot.

**Denial**:

- Semua batas Putri, di-mirror ke portfolio Indo.
- **Tidak** melihat CA/expense proyek Nusa sebelum handover.

**Seed context**: baris `pm2` di seed §3.

### Sinta Supervisor — Team Lead / Field Supervisor

- **Email**: `supervisor@demo.controldesk.app`
- **Role**: `SUPERVISOR`
- **Kompetensi**: team lead on-site. Approver level 1 expense/CA
  General di bawah PM threshold. **Approver awal** semua CA Field Ops.

**E2E specs where I play**:

- `e2e/cash-advance-chain.spec.ts` — Supervisor approve L1 →
  PENDING\_L2\_PM.
- `e2e/canonical-cash-advance.spec.ts` — Supervisor submit FIELD_OPS
  request + chain preview verify.
- `e2e/approvals-inbox.spec.ts` — Supervisor sees inbox.

**Positif**:

- Buka `/finance/cash-advances/{CA_PENDING}` (status PENDING\_L1) →
  tombol **Approve**.
- Buka `/finance/cash-advances` → **New request** → pilih FIELD\_OPS →
  chain preview live update saat ubah amount.
- Submit sendiri FIELD\_OPS CA untuk site visit.

**Denial**:

- **Tidak** boleh Approve L2 (PM) atau L3 (Finance) — tombol hidden.
- **Tidak** boleh Disburse.
- Setelah L1 diteruskan ke L2, tombol Approve pada CA itu HILANG
  untuk supervisor.

**Seed context**: baris `supervisor` di seed §3, reports_to `pm`.

### Eko Employee — Individual Contributor

- **Email**: `employee@demo.controldesk.app`
- **Role**: `EMPLOYEE`
- **Kompetensi**: staf umum. Submit expense / CA / weekly timesheet.
  Baca hanya proyek yang di-assign.

**E2E specs where I play**:

- `e2e/cash-advance-chain.spec.ts` — Eko submits settlement CA-2
  (Rp 4.2jt, DISBURSED → SUBMITTED).
- `e2e/cash-advance-chain.spec.ts` — access-control denial: tidak ada
  tombol Approve/Disburse.
- `e2e/weekly-timesheet.spec.ts` — Eko sees readonly SUBMITTED packet.
- `e2e/approvals-inbox.spec.ts` — Eko sees "not an approver" empty state.
- `e2e/handovers.spec.ts` — Eko tidak lihat handover row (skip / deprecated).

**Positif**:

- Buka `/finance/cash-advances/{CA_DISBURSED}` → tombol
  **Submit settlement** aktif.
- Buka `/hr/timesheets/weekly/{WEEK_START}` → readonly view (packet
  sudah SUBMITTED).
- Buka `/dashboard` → widget KPI diri (own hours + own pending CA).

**Denial**:

- **Tidak** ada tombol Approve manapun.
- **Tidak** ada tombol Disburse.
- Buka `/approvals` → empty state "role kamu bukan approver".
- Buka CA milik orang lain (yang bukan requesternya) → 404 (RLS).
- Buka `/finance/petty-cash` → tolak (bukan custodian/finance).
- Buka `/settings/*` → 403 (bukan admin).

**Seed context**: baris `employee` di seed §3. Assigned ke NUSA-CS
via `project_employee_assignments`.

### Fajar Finance — Lead Finance

- **Email**: `finance@demo.controldesk.app`
- **Role**: `LEAD_FINANCE` (canonical: `FINANCE`)
- **Kompetensi**: gatekeeper cashflow. Approver parallel-gate untuk
  semua expense/CA. Owner petty cash disbursement. Owner Chart of
  Accounts. **Selalu di chain** approval — bukan level, tapi gate paralel.

**E2E specs where I play**:

- `e2e/cash-advance-chain.spec.ts` — Fajar approve L2.5 → APPROVED,
  lalu Disburse → DISBURSED.
- `e2e/cash-advance-chain.spec.ts` — Fajar accept settlement → SETTLED.
- `e2e/petty-cash-chain.spec.ts` — Fajar approve + disburse
  replenishment.
- `e2e/canonical-cash-advance.spec.ts` — Finance selalu muncul di
  chain preview (GENERAL + FIELD\_OPS).

**Positif**:

- Buka `/finance/cash-advances/{CA_PENDING}` (status
  PENDING\_L2.5\_FINANCE) → **Approve** → APPROVED.
- Setelah APPROVED → tombol **Disburse** aktif → isi ref
  `E2E-TRX-001` → **Confirm** → DISBURSED.
- Buka `/finance/petty-cash/{FUND_ID}` → **Approve** replenishment
  PENDING\_FINANCE → APPROVED → **Disburse** → balance restored.
- Buka `/finance/cash-advances/{CA_DISBURSED}` → **Accept**
  settlement → SETTLED.
- Buka `/finance/coa` → tambah / edit / soft-deactivate akun.

**Denial**:

- **Tidak** boleh Approve L1 (Supervisor gate) — Fajar tidak melihat
  tombol Approve saat status masih PENDING\_L1.
- **Tidak** boleh HARD DELETE row financial (soft-void only).
- **Tidak** boleh initiate PM handover.

**Seed context**: baris `finance` di seed §3.

### Hana HR — HR Administrator

- **Email**: `hr@demo.controldesk.app`
- **Role**: `HR_ADMIN` (canonical: `ADMIN` untuk HR surface)
- **Kompetensi**: manage employees master, template evaluasi, roster.
  Approver terminal untuk `hr_requests` (deprecated) — sekarang read-only
  approve fallback.

**E2E specs where I play**:

- `e2e/hr-requests-chain.spec.ts` — DEPRECATED per §12, currently
  `test.describe.skip`. Adegan tersimpan sebagai spec dokumentasi
  untuk saat modul HR request formal kembali (Fase 12+).
- `e2e/hr-leave-chain.spec.ts` — DEPRECATED sama.
- Bulk import employees: covered by integration test, bukan E2E.

**Positif**:

- Buka `/hr/employees` → invite + edit + terminate employee.
- Buka `/hr/performance/templates` → CRUD template evaluasi.
- Buka `/hr/roster` → assign shift.
- Bulk-import CSV karyawan.

**Denial**:

- **Tidak** boleh approve expense/CA (itu Finance).
- **Tidak** boleh execute handover.
- **Tidak** boleh curate CoA.

**Seed context**: baris `hr` di seed §3.

### Pandu Petty — Petty Cash Custodian

- **Email**: `pettycash@demo.controldesk.app`
- **Role**: `PETTY_CASH_CUSTODIAN` (canonical: `FINANCE` staff)
- **Kompetensi**: custodian fisik kas kecil Jakarta HQ. Request
  replenishment ke Finance. Post voucher ≤ 2jt (auto-approve < 200rb).

**E2E specs where I play**:

- `e2e/petty-cash-chain.spec.ts` — Pandu request replenishment 2jt →
  status PENDING\_FINANCE.

**Positif**:

- Buka `/finance/petty-cash/{FUND_ID}` → **Request replenishment** →
  isi 2.000.000 + alasan → **Confirm** → row baru PENDING\_FINANCE.
- Post voucher spend < 200rb → auto APPROVED → **Post** → balance
  turun.
- Post voucher ≥ 100rb → wajib attach receipt sebelum submit.
- Upload receipt PDF ke `tenant-attachments/{tenant_id}/petty_cash/{voucher_id}/`.

**Denial**:

- **Tidak** boleh Approve replenishment sendiri (itu Finance).
- **Tidak** boleh Post voucher > 2jt → validation error di UI +
  server-side reject.
- **Tidak** boleh akses fund cabang lain (satu custodian per fund).

**Seed context**: fund `77777777-1111-4111-8111-111111111111` (imprest 5jt, current balance ~3.2jt setelah voucher seed).

### Portal: PT Nusa client

- **Email**: `client@demo.controldesk.app`
- **Belongs to**: `clients` row PT Nusa Digital.
- **Status**: `ACTIVE`.
- **Login via**: `/portal/login` — bukan `/login`.

**E2E specs where I play**:

- `e2e/portal.spec.ts` — happy path login + dashboard + project detail.

**Positif**:

- Login → `/portal/dashboard` → lihat KPI: aktif project count, budget,
  milestone progress, upcoming due.
- Buka `/portal/projects/{NUSA-CS}` → milestone timeline (progress %
  auto-hitung dari milestone weight).
- Baca dokumen client-shared (attach di project by PM).
- Reset password via `/portal/forgot`.

**Denial**:

- Buka `/portal/projects/{INDO-HELP}` → **404 notFound()** (cross-client
  isolation).
- **Tidak** boleh submit expense / CA / timesheet.
- **Tidak** boleh login lewat `/login` internal.
- **Tidak** lihat detail cost/budget internal — hanya milestone
  progress + high-level dokumen.

**Seed context**: `client_users` row + link ke `clients.slug='nusa'`.

### Portal: PT Indo client

- **Email**: `client-indo@demo.controldesk.app`
- **Client**: PT Indo Retail Ceria.
- Sama seperti Nusa, tapi mirror-side untuk verifikasi cross-client
  isolation.

**Denial khusus**: buka `/portal/projects/{NUSA-CS}` → 404.

### Portal: Newbie client (PENDING_ACTIVATION)

- **Email**: `client-new@demo.controldesk.app`
- **Client**: PT Nusa Digital.
- **Status**: `PENDING_ACTIVATION`.
- **Roleplay khusus**: baru di-invite oleh Ayu Admin, belum ubah password.

**E2E specs**:

- `e2e/portal.spec.ts` — force redirect ke `/portal/change-password`
  di semua route portal kecuali change-password itu sendiri.

**Positif**:

- Login pertama kali dengan password sementara `ControlDesk#2026`
  → redirect **wajib** ke `/portal/change-password`.
- Set password baru (min 12 char, mix) → status berubah ke `ACTIVE`
  → boleh akses `/portal/dashboard`.

**Denial**:

- Skip halaman change-password → tidak bisa (middleware redirect
  ulang).
- Ganti password gagal (weak password) → toast merah + tetap di
  halaman change-password.

## Cross-role chain scripts

Adegan-adegan berikut memerlukan **≥ 2 persona** yang bergantian login.
Semua tergantung seed fresh — jalankan `pnpm db:reset` dulu.

### Adegan 1: Cash Advance kecil (< 5jt) — Nusa CS

**Referensi spec**: `e2e/cash-advance-chain.spec.ts` — describe block
"cash advance approval chain".

**Data awal**: CA seed `66666666-1111-4111-8111-111111111111`
Rp 1.500.000, status `PENDING_L1_SUPERVISOR`, project NUSA-CS.

**Chain**: Supervisor → PM → Finance → Disburse → SETTLED
(threshold matrix `< 5jt` skip L3 Director).

| Step | Aktor        | Action                                             | Status setelahnya       |
| ---- | ------------ | -------------------------------------------------- | ----------------------- |
| 1    | Sinta (SPV)  | `/finance/cash-advances/{CA_PENDING}` → **Approve** | PENDING\_L2\_PM         |
| 2    | Putri (PM)   | Same URL → **Approve**                              | PENDING\_L2.5\_FINANCE  |
| 3    | Fajar (FIN)  | Same URL → **Approve**                              | APPROVED (awaiting disburse) |
| 4    | Fajar (FIN)  | **Disburse** → ref `E2E-TRX-001` → **Confirm**      | DISBURSED (awaiting settle) |

Verifikasi manual:

- Setiap step: status badge di header berubah.
- Approval history section: baris baru dengan aktor + timestamp +
  komentar (opsional).
- Notifikasi Bell di actor berikutnya → 1 unread.
- Email di mailpit → 1 email approval-request.

**Kalau step gagal**:

- Step 3 button hilang → cek RLS `cash_advances` policy + pastikan
  status di DB memang PENDING\_L2.5.
- Step 4 amount reject → cek `disbursement_ref` validasi Zod.

### Adegan 2: Cash Advance settlement — refund 200rb

**Referensi spec**: `e2e/cash-advance-chain.spec.ts` describe
"cash advance settlement chain".

**Data awal**: CA seed `66666666-1111-4111-8111-222222222222`
Rp 4.200.000, sudah DISBURSED, requester Eko.

**Chain**: Employee → Finance → SETTLED.

| Step | Aktor        | Action                                                    | Status |
| ---- | ------------ | --------------------------------------------------------- | ------ |
| 1    | Eko (EMP)    | `/finance/cash-advances/{CA_DISBURSED}` → **Submit settlement** → total spent `4000000` → **Submit** | SUBMITTED (refund 200rb calc) |
| 2    | Fajar (FIN)  | Same URL → row settlement SUBMITTED → **Accept** → **Confirm** | SETTLED |

Verifikasi:

- Setelah step 1, `actual_amount = 4.000.000` di DB, `refund_amount
  = 200.000` di UI.
- Setelah step 2, badge status CA berubah "Settled".

### Adegan 3: Petty Cash replenishment — Jakarta HQ fund

**Referensi spec**: `e2e/petty-cash-chain.spec.ts`.

**Data awal**: fund `77777777-1111-4111-8111-111111111111`
Jakarta HQ, imprest Rp 5.000.000, current balance ~3.225.000 setelah
voucher seed.

**Chain**: Custodian request → Finance approve → Finance disburse.

| Step | Aktor       | Action                                                 | Status |
| ---- | ----------- | ------------------------------------------------------ | ------ |
| 1    | Pandu (CUS) | `/finance/petty-cash/{FUND_ID}` → **Request replenishment** → 2.000.000 + alasan → **Confirm** | PENDING\_FINANCE |
| 2    | Fajar (FIN) | Same URL → row baru PENDING\_FINANCE → **Approve** → **Confirm** | APPROVED |
| 3    | Fajar (FIN) | **Disburse** → ref `PC-E2E-TRX-001` → **Confirm**       | DISBURSED, `current_balance` naik ke ~5.2jt |

Verifikasi:

- Widget "Fund balance" di header naik setelah step 3.
- Ledger row baru di section "Replenishments" dengan ref.

### Adegan 4: Weekly timesheet approval — Eko → Putri

**Referensi spec**: `e2e/weekly-timesheet.spec.ts`.

**Data awal**: packet SUBMITTED milik Eko untuk ISO week saat ini,
40 jam total + 2 jam overtime, project NUSA-CS.

**Chain**: Employee readonly → PM inbox → PM approve.

| Step | Aktor       | Action                                                       | Efek |
| ---- | ----------- | ------------------------------------------------------------ | ---- |
| 1    | Eko (EMP)   | `/hr/timesheets/weekly/{WEEK_START}` → verifikasi readonly view + status "Pending approval" | (view only) |
| 2    | Putri (PM)  | `/approvals` → section "Weekly timesheets" → klik packet Eko | Buka editor readonly + review buttons |
| 3    | Putri (PM)  | **Approve** → **Confirm**                                    | APPROVED, packet auto-lock kalau `AUTO_LOCK_AFTER_DAYS > 0` |

Verifikasi:

- Step 2: badge count "1" di section header.
- Step 3: Eko refresh page → badge status berubah "Approved".

### Adegan 5: Portal isolation — Nusa vs Indo

**Referensi spec**: `e2e/portal.spec.ts`.

**Chain**: client-nusa login → client-indo login → cross-URL probe.

| Step | Aktor        | Action                                          | Expected |
| ---- | ------------ | ----------------------------------------------- | -------- |
| 1    | client-nusa  | `/portal/login` → login → `/portal/dashboard`   | KPI PT Nusa Digital muncul |
| 2    | client-nusa  | `/portal/projects/{NUSA-CS}`                    | Detail + milestone timeline |
| 3    | client-nusa  | `/portal/projects/{INDO-HELP}` (URL guess)     | **404 notFound** (cross-client block) |
| 4    | logout, ganti session | `/portal/login` sebagai client-indo    | KPI PT Indo Retail Ceria |
| 5    | client-indo  | `/portal/projects/{NUSA-CS}` (URL guess)       | **404 notFound** |

**Sub-adegan 5c — newbie force change password**:

| Step | Aktor         | Action                                          | Expected |
| ---- | ------------- | ----------------------------------------------- | -------- |
| 1    | client-newbie | `/portal/login` → password sementara            | Redirect ke `/portal/change-password` |
| 2    | client-newbie | Coba `/portal/dashboard` langsung               | Middleware redirect balik ke change-password |
| 3    | client-newbie | Set password baru valid (min 12, mix, uniq)     | Status → ACTIVE, redirect ke dashboard |

### Adegan 6: FIELD_OPS canonical CA — chain preview

**Referensi spec**: `e2e/canonical-cash-advance.spec.ts`.

**Chain**: Supervisor open sheet → toggle Type + Amount → verify
chain preview.

| Step | Aktor        | Action                                                  | Expected Preview |
| ---- | ------------ | ------------------------------------------------------- | ---------------- |
| 1    | Sinta (SPV)  | `/finance/cash-advances` → **New request**              | Sheet terbuka, GENERAL default |
| 2    | Sinta        | Isi amount 500.000, biarkan GENERAL                     | `[FINANCE]` (< 2jt threshold) |
| 3    | Sinta        | Toggle **Field ops**                                    | `[SUPERVISOR, FINANCE]` |
| 4    | Sinta        | Ubah amount 6.000.000                                    | `[SUPERVISOR, PROJECT MANAGER, FINANCE]` |
| 5    | Sinta        | Ubah amount 25.000.000                                   | `[SUPERVISOR, PROJECT MANAGER, OPERATIONS MANAGER, FINANCE]` |
| 6    | Sinta        | Ubah amount 60.000.000                                   | `[SUPERVISOR, PROJECT MANAGER, OPERATIONS MANAGER, FINANCE, DIRECTOR]` |
| 7    | Sinta        | Isi purpose + submit                                     | CA baru muncul di list dengan badge `FIELD_OPS` |

Verifikasi:

- Preview live update saat amount / type berubah — tidak butuh
  submit dulu.
- Badge `FIELD_OPS` warna berbeda dari `GENERAL` di list.

## Access-control matrix (denial map)

Matrix "role x route" yang jadi rujukan cepat "seharusnya boleh /
tolak". Diverifikasi lewat PDP test (`src/lib/security/pdp*.test.ts`)
+ E2E denial specs.

| Route                                     | ADM | GM  | HM  | OM  | PM  | SPV | EMP | FIN | HR  | CUS | Portal |
| ----------------------------------------- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :----: |
| `/dashboard`                              | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | ✗      |
| `/projects`                               | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | R   | R   | R   | R   | ✗      |
| `/projects/new` (wizard)                  | ✓   | ✓   | ✓   | ✓   | R   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗      |
| `/approvals`                              | ✓   | ✓   | ✓   | ✓   | ✓   | ✓   | E   | ✓   | ✓   | ✗   | ✗      |
| `/finance/cash-advances`                  | ✓   | R   | R   | ✓   | ✓   | ✓   | R\* | ✓   | R   | ✗   | ✗      |
| `/finance/cash-advances/:id` Approve L1   | ✓   | ✗   | ✗   | ✗   | ✗   | ✓   | ✗   | ✗   | ✗   | ✗   | ✗      |
| `/finance/cash-advances/:id` Approve L2   | ✓   | ✗   | ✗   | ✗   | ✓   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗      |
| `/finance/cash-advances/:id` Approve L2.5 | ✓   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✓   | ✗   | ✗   | ✗      |
| `/finance/cash-advances/:id` Approve L3   | ✓   | ✓   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗      |
| `/finance/cash-advances/:id` Disburse     | ✓   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✓   | ✗   | ✗   | ✗      |
| `/finance/petty-cash/:fundId`             | ✓   | R   | R   | R   | ✗   | ✗   | ✗   | ✓   | ✗   | ✓   | ✗      |
| `/finance/petty-cash` Request Replenish   | ✓   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✓   | ✗      |
| `/finance/petty-cash` Approve Replenish   | ✓   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✓   | ✗   | ✗   | ✗      |
| `/hr/employees`                           | ✓   | R   | R   | R   | R   | R   | ✗   | ✗   | ✓   | ✗   | ✗      |
| `/hr/timesheets/weekly/:week` Submit      | ✓   | ✗   | ✗   | ✗   | ✗   | ✓   | ✓   | ✗   | ✗   | ✓   | ✗      |
| `/hr/timesheets/weekly/:week` Approve     | ✓   | ✗   | ✗   | ✓   | ✓   | ✓   | ✗   | ✗   | ✓   | ✗   | ✗      |
| `/handovers` (module deprecated §13)      | -   | -   | -   | -   | -   | -   | -   | -   | -   | -   | -      |
| `/settings/users`                         | ✓   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | R   | ✗   | ✗      |
| `/settings/portal-users`                  | ✓   | ✗   | ✗   | ✗   | R   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗      |
| `/settings/integrations/telegram`         | ✓   | ✓   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗      |
| `/settings/integrations/whatsapp`         | ✓   | ✓   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗      |
| `/settings/integrations/calendar`         | ✓   | ✓   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗      |
| `/reports`                                | ✓   | ✓   | ✓   | ✓   | ✓   | ✗   | ✗   | ✓   | ✓   | ✓   | ✗      |
| `/ai/insights`                            | ✓   | ✓   | ✓   | ✓   | ✓   | ✗   | ✗   | ✓   | ✗   | ✗   | ✗      |
| `/portal/*`                               | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✗   | ✓      |

Legenda:

- `✓` — full access (read + tombol action muncul).
- `R` — read-only (halaman terbuka, tombol mutasi hidden).
- `E` — empty state ("kamu bukan approver").
- `R*` — read-only + hanya CA milik sendiri.
- `✗` — 403 / 404 / notFound / redirect.
- `-` — module deprecated (skip di suite).

## Data-recovery notes

Sebagian besar chain adegan mengonsumsi row seed yang state-nya
berubah setelah action. Kalau mau **re-run adegan**, harus reset:

```bash
pnpm db:reset
```

Rules umum:

- **Serial suite** (mode `serial` di Playwright) — semua chain
  (Cash Advance, Petty Cash, PM Handover) berjalan berurutan dan
  saling bergantung. Kalau test #2 fail, test #3-4 auto-skip karena
  state prasyarat rusak.
- **Parallel suite** (mode default) — hanya untuk spec yang read-only
  atau action idempoten (canonical CA, projects wizard test 2, etc).
- **Cross-adegan interference** — kalau Anda jalan Adegan 1 lalu
  Adegan 4, urutan seharusnya tidak masalah (CA state != timesheet
  state). Tapi kalau ragu → reset saja.

Cek [`e2e-playbook.md#serial-vs-parallel`](e2e-playbook.md#serial-vs-parallel)
untuk detail teknis.

## Extending — menulis adegan baru

Ketika menambah fitur baru (mis. modul `budget-request` §26 atau
`issues` §26 dari GAS-import roadmap):

1. **Tambah persona kalau perlu**. Rules §6 saat ini punya 8
   canonical roles + 1 portal role. Semua 11 slug demo user sudah
   cover mapping — jarang perlu tambah persona baru.
2. **Tulis Playwright spec dulu** (test-first). Simpan di
   `e2e/{module}.spec.ts`.
3. **Update doc ini**:
   - Kalau adegan single-role → tambah di section persona yang
     bersangkutan.
   - Kalau multi-role → tambah adegan baru di
     [Cross-role chain scripts](#cross-role-chain-scripts).
4. **Update matrix di [Access-control matrix](#access-control-matrix-denial-map)**
   kalau ada route/tombol baru.
5. **Sync [test-catalog.md](test-catalog.md)** dengan link ke spec baru.
6. **Sync [manual-smoke-scripts.md](manual-smoke-scripts.md)** kalau
   adegan cukup penting untuk masuk release checklist.

Template adegan singkat:

```markdown
### Adegan N: <Judul singkat>

**Referensi spec**: `e2e/<file>.spec.ts` describe "<name>".

**Data awal**: <seed row ids + kondisi awal>.

**Chain**: <Aktor 1> → <Aktor 2> → <status akhir>.

| Step | Aktor | Action                                | Status setelahnya |
| ---- | ----- | ------------------------------------- | ----------------- |
| 1    | ...   | `/route/...` → klik **Button**        | STATUS_1          |
| 2    | ...   | ...                                   | STATUS_2          |

Verifikasi manual:
- ...

Kalau gagal:
- ...
```

**Anti-pattern**:

- Jangan bikin adegan yang bergantung tanggal spesifik non-relative
  (misal `2026-01-15`). Pakai `date_trunc('week', current_date)` seperti
  di seed weekly-timesheet.
- Jangan hardcode UUID di doc — pakai konstanta nama (`CA_PENDING`,
  `CA_DISBURSED`, `FUND_ID`) yang mengarah ke [test-data.md](test-data.md).
- Jangan skip persona denial. Setiap positif action harus punya
  minimal 1 denial pair untuk role yang seharusnya ditolak.

---

**Last synced with codebase**: 2026-08-09 (commit `733319a`).
Setelah major refactor role/threshold, ingat re-sync matrix +
persona card sesuai kondisi baru.
