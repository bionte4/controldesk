# HRIS & Payroll

Modul HR di ControlDesk mengelola siklus operasional karyawan:
**master data**, **shift & roster**, **request cuti/lembur/sakit**,
**timesheet** (daily + weekly), dan **payroll** (Direct Labor Cost).

Route: `src/app/(app)/hr/*`. Master employee dikelola di `/team` +
`/settings/hr` (Tenant/HR Admin only).

## 1. Employee master

Tabel: `public.employees` (migration `0002`).

### Sensitive PII handling

Kolom-kolom berikut **encrypted at rest** via `pgcrypto` + kunci
`APP_ENCRYPTION_KEY`:

- `salary` → `salary_encrypted bytea`.
- `bank_account_number` → `bank_account_number_encrypted bytea`.
- `ktp_number` → `ktp_number_encrypted bytea`.
- `npwp_number` → `npwp_number_encrypted bytea`.

**Read path**: cuma role dengan `canReadSensitive(role) === true` yang
melihat plaintext — yaitu `HR_ADMIN`, `TENANT_ADMIN`, `LEAD_FINANCE`
(canonical: `ADMIN`, `FINANCE`). Semua role lain melihat mask:

- Salary → `"REDACTED"`.
- Bank account → `"**** **** **** 1234"` (last-4 only).
- KTP → hidden entirely.
- NPWP → hidden entirely.

Helpers: `src/lib/security/crypto.ts`
`encryptedInsert()`, `decryptedSelect()`, `maskSensitive()`.

### Other columns

| Kolom                     | Tipe                | Note                                              |
| ------------------------- | ------------------- | ------------------------------------------------- |
| `id`                      | `uuid`              |                                                   |
| `tenant_id`               | `uuid`              |                                                   |
| `user_id`                 | `uuid`              | FK → `auth.users` (nullable — bisa employee tanpa login)|
| `full_name`               | `text`              |                                                   |
| `email`                   | `text`              | Sync dengan `auth.users.email` bila punya login   |
| `role`                    | `employee_role`     | Legacy 10-role enum (bisa ditulis canonical juga) |
| `reports_to_employee_id`  | `uuid`              | FK self — chain of command (rules §6)             |
| `hourly_rate`             | `numeric(18,2)`     | Untuk Direct Labor Cost                           |
| `overtime_multiplier`     | `numeric(4,2)`      | Default 1.5, tunable per employee                 |
| `hired_at`                | `date`              |                                                   |
| `terminated_at`           | `date`              | Nullable — kalau ada, employee locked             |
| `anonymized_at`           | `timestamptz`       | Setelah 5 tahun terminated, PII di-hash           |

### Anonymization (retensi HR)

Setelah 5 tahun `terminated_at`, cron `/api/cron/retention`
mengeksekusi anonymization untuk row employees terminated:

- `full_name` → `"REDACTED_" || md5(id)`.
- `email` → `null` (unique constraint dilepas via `WHERE terminated_at IS NULL`).
- `salary_encrypted`, `bank_account_number_encrypted`, `ktp_number_encrypted`, `npwp_number_encrypted` → `null`.
- FK reference tetap valid, jadi audit trail lama tidak break.
- Set `anonymized_at = NOW()`.

Rules §22 — WAJIB anonymize, bukan hard delete.

## 2. Shifts & rosters

Tabel: `public.work_shifts`, `public.employee_rosters` (migration `0015`).

### Work Shifts

Template shift yang bisa dijadwalkan ke roster.

| Kolom              | Tipe             | Note                                                  |
| ------------------ | ---------------- | ----------------------------------------------------- |
| `id`               | `uuid`           |                                                       |
| `tenant_id`        | `uuid`           |                                                       |
| `name`             | `text`           | Mis. "Morning Shift", "Night Shift"                   |
| `start_time`       | `time`           | Waktu mulai (contoh `07:00`)                          |
| `end_time`         | `time`           | Waktu selesai (contoh `15:00`) — bisa lebih kecil dari start_time untuk cross-midnight |
| `duration_interval`| `interval`       | `interval` di Postgres (bukan datetime math di TS)    |
| `is_night_shift`   | `boolean`        | Flag untuk night allowance                            |
| `weekend_allowance`| `numeric(18,2)`  | Tambahan jika di-roster hari Sabtu/Minggu             |

**Cross-midnight**: Postgres `interval` handle correctly. Kalau
`start_time = 22:00` dan `end_time = 06:00`, duration = 8 hours.
Jangan pernah hitung ini di TypeScript.

### Employee Rosters

Assignment shift ke employee di tanggal tertentu.

| Kolom              | Tipe               | Note                                                     |
| ------------------ | ------------------ | -------------------------------------------------------- |
| `employee_id`      | `uuid`             |                                                          |
| `shift_id`         | `uuid`             |                                                          |
| `roster_date`      | `date`             |                                                          |
| `status`           | `roster_status`    | `SCHEDULED` / `PRESENT` / `ABSENT` / `LEAVE` / `SICK` / `HOLIDAY` |
| `check_in_at`      | `timestamptz`      | Presence tracking (opsional, kalau ada mesin absensi)    |
| `check_out_at`     | `timestamptz`      |                                                          |

Roster auto-updated by HR Request:

- HR Request `LEAVE` approved → semua roster di rentang `LEAVE`.
- HR Request `SICK` approved → semua roster di rentang `SICK`.

UI: `/hr/roster` → heatmap 24/7 (Tremor / Recharts).

### Roster ↔ project assignment guard (baru — commit `2e8a806`)

`employee_rosters.project_id` bersifat optional. Bila diset, sistem
memvalidasi bahwa karyawan tersebut memiliki **assignment aktif** ke
project itu — baik sebagai member (`project_employee_assignments`)
atau PM (`project_pm_assignments`) — sebelum menyimpan row roster.

Guard bekerja di dua lapisan:

1. **UI**: dropdown "Project" di sheet upsert roster (`/hr/roster`)
   otomatis **mengecil** menjadi hanya project yang aktif untuk
   karyawan yang dipilih. Pilihan lama otomatis di-reset kalau
   karyawan diganti.
2. **Server action**: `rosterEmployeeAction` memanggil
   `assertEmployeeAssignedToProject()` (helper di
   `src/lib/data/assignments.ts`) sebelum INSERT/UPDATE. Kalau attempt
   ditolak, action mengembalikan error `"The selected project is not
   an active assignment for this employee."`.

Kalau seorang karyawan harus di-roster untuk project di mana ia belum
di-assign, buka **Assignments → Add member/PM** dulu, baru kembali ke
roster.

## 3. HR Requests

Tabel: `public.hr_requests`, `public.hr_approval_logs` (migration `0010`).

### Three kinds

| Kind        | Purpose                | Approval chain                                       | Special requirements                     |
| ----------- | ---------------------- | ---------------------------------------------------- | ---------------------------------------- |
| `LEAVE`     | Cuti (tahunan, penting)| Supervisor → PM → OM → HR Admin (final)              | Balance cuti tidak boleh minus           |
| `OVERTIME`  | Lembur                 | Supervisor → PM → OM → HR Admin (final)              | Multiplier applied ke DLC saat approved  |
| `SICK`      | Sakit                  | Supervisor → HR Admin (final) — chain lebih pendek   | **Surat dokter wajib** (attachment PDF)  |

Helpers: `src/lib/hris/state.ts` `hrChainForKind()`.

### Schema

| Kolom              | Tipe                    | Note                                                                    |
| ------------------ | ----------------------- | ----------------------------------------------------------------------- |
| `id`               | `uuid`                  |                                                                         |
| `employee_id`      | `uuid`                  | Submitter                                                               |
| `kind`             | `hr_request_kind`       | LEAVE / OVERTIME / SICK                                                 |
| `leave_type`       | `hr_leave_type`         | Untuk LEAVE: `ANNUAL` / `PERSONAL` / `MATERNITY` / `PATERNITY` / `UNPAID`|
| `start_date`, `end_date` | `date`            | Rentang cuti / sakit                                                    |
| `overtime_hours`   | `numeric(6,2)`          | Untuk OVERTIME                                                          |
| `reason`           | `text`                  | Justifikasi                                                             |
| `attachment_url`   | `text`                  | Surat dokter (wajib SICK, opsional lainnya)                             |
| `status`           | `hr_request_status`     | State machine                                                           |

### State machine

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> PENDING_L1_SUPERVISOR: submit()
    PENDING_L1_SUPERVISOR --> PENDING_L2_PM: approve (LEAVE/OT)
    PENDING_L1_SUPERVISOR --> PENDING_HR_ADMIN: approve (SICK)
    PENDING_L1_SUPERVISOR --> REJECTED: reject
    PENDING_L2_PM --> PENDING_L3_OM: approve
    PENDING_L2_PM --> REJECTED
    PENDING_L3_OM --> PENDING_HR_ADMIN: approve
    PENDING_L3_OM --> REJECTED
    PENDING_HR_ADMIN --> APPROVED: finalize
    PENDING_HR_ADMIN --> REJECTED
    DRAFT --> CANCELLED
```

Setelah `APPROVED`, side effects:

- **LEAVE**: employee `leave_balance -= days_requested` (via
  `hr_leave_balances` table). Kalau `PATERNITY` / `MATERNITY`, pakai
  balance khusus. Roster otomatis `LEAVE` untuk rentang.
- **OVERTIME**: kolom `overtime_hours` masuk ke timesheet karyawan hari itu
  (kalau ada) atau di-track separately untuk payroll calc.
- **SICK**: roster `SICK` untuk rentang. Kalau > 3 hari, surat dokter
  wajib re-review oleh HR (compliance BPJS).

### UI

- List: `/hr/requests` — filter by status, kind, employee. Column
  "Chain" menampilkan compact `ApprovalChainProgress`.
- Detail: `/hr/requests/[id]` — full timeline dengan visual chain +
  surat dokter preview (kalau SICK).
- New: slide-over sheet.

## 4. Timesheets

Dua mode paralel — modul HR punya keduanya.

### Daily timesheet

Tabel: `public.timesheets` (migration `0015`).

Entry per hari per employee. Approval satu-per-satu oleh PM/Supervisor.

| Kolom              | Tipe                | Note                                                        |
| ------------------ | ------------------- | ----------------------------------------------------------- |
| `employee_id`      | `uuid`              |                                                             |
| `project_id`       | `uuid`              | Nullable — kalau bukan project work (mis. training internal)|
| `work_date`        | `date`              |                                                             |
| `hours_worked`     | `numeric(4,2)`      | Regular hours                                               |
| `hours_overtime`   | `numeric(4,2)`      | Overtime hours (harus match HR Request OT yang APPROVED)    |
| `description`      | `text`              |                                                             |
| `status`           | `timesheet_status`  | `DRAFT` / `SUBMITTED` / `APPROVED` / `REJECTED`             |
| `week_id`          | `uuid`              | FK → `timesheet_weeks` bila di-submit via weekly packet     |

**Assignment guard (baru — commit `2e8a806`)**: bila `project_id`
di-set, sistem memvalidasi karyawan punya assignment aktif ke project
tersebut. UI form (`/hr/timesheets`, weekly editor
`/hr/timesheets/weekly/[weekStart]`) memfilter dropdown project agar
hanya menampilkan project yang aktif untuk karyawan sesi berjalan.
Server action `submitTimesheetAction` + `submitWeeklyTimesheetAction`
melakukan validasi ulang via `assertEmployeeAssignedToProject()`
(daily) atau `loadActiveProjectIdsByEmployee()` (weekly, batch
per-day). Karyawan **tidak dapat** log jam ke project di luar
assignment aktif — solusi: minta PM tambahkan mereka ke assignment
lewat `/assignments` sebelum mengisi timesheet.

### Weekly timesheet packet

Tabel: `public.timesheet_weeks` (migration `0031`).

Model kerja BPO seringkali punya banyak entry per minggu — approval
satu-per-satu tidak scalable. Weekly packet groups entry Senin-Minggu
ISO-8601 dan approve **satu paket sekaligus** oleh PM.

| Kolom              | Tipe               | Note                                                       |
| ------------------ | ------------------ | ---------------------------------------------------------- |
| `id`               | `uuid`             |                                                            |
| `employee_id`      | `uuid`             |                                                            |
| `week_start_date`  | `date`             | ISO-8601 Monday                                            |
| `week_end_date`    | `date`             | Sunday                                                     |
| `status`           | `timesheet_week_status` | `DRAFT` / `SUBMITTED` / `APPROVED` / `REJECTED`      |
| `total_hours_worked`| `numeric(6,2)`   | Aggregate                                                 |
| `total_hours_overtime` | `numeric(6,2)`| Aggregate                                                  |

Flow:

```mermaid
sequenceDiagram
    participant Emp as Employee
    participant App
    participant PM

    Emp->>App: fill daily entries Mon-Sun
    Emp->>App: submitWeeklyPacket()
    App->>App: create timesheet_weeks (SUBMITTED)
    App->>App: link all daily entries via week_id
    App->>PM: notify: "Weekly packet from Emp for week X"
    PM->>App: reviewPacket
    alt approve all
        PM->>App: approvePacket()
        App->>App: timesheet_weeks.status = APPROVED
        App->>App: all daily entries with same week_id → APPROVED
    else reject packet
        PM->>App: rejectPacket(reason)
        App->>App: week + all daily entries → REJECTED
        App->>Emp: notify with reason, allow re-submit
    end
```

Audit log per action: `timesheet_week_approval_logs`.

**Provenance tracking**: setelah weekly packets landing, payroll page
menunjukkan `weekly_share_pct` — % approved hours yang sourced dari
weekly packet vs daily-only. Higher weekly share = better process
compliance.

## 5. Payroll

**Route**: `/hr/payroll`. Tabel: `public.payroll_periods` (migration `0015`).

### Purpose

Compute **Direct Labor Cost (DLC)** — biaya SDM langsung untuk periode
tertentu. Bukan full payroll integrator (tidak push ke bank / BPJS API);
export CSV untuk provider payroll eksternal.

### DLC formula

```
DLC per employee per period =
  Σ(timesheet.hours_worked   × employee.hourly_rate) +
  Σ(timesheet.hours_overtime × employee.hourly_rate × employee.overtime_multiplier)
```

Hanya timesheet dengan `status = APPROVED` yang dihitung. Daily-only
approved dan weekly-packet approved keduanya masuk — tapi tercatat
provenance-nya (lihat `weekly_share_pct`).

Extension per shift:

```
+ shift.night_shift_allowance   (jika roster.shift.is_night_shift = true)
+ shift.weekend_allowance       (jika roster_date is Sat/Sun)
```

Kode: `src/lib/payroll/compute.ts` — `computePayroll(employeeId, periodStart, periodEnd)`.

### Payroll periods

| Kolom              | Tipe               | Note                                                         |
| ------------------ | ------------------ | ------------------------------------------------------------ |
| `period_start`     | `date`             | Awal periode (biasa bulan ke-N)                              |
| `period_end`       | `date`             | Akhir periode                                                |
| `status`           | `payroll_status`   | `DRAFT` / `LOCKED` (finalized) / `EXPORTED`                 |
| `total_dlc`        | `numeric(18,2)`    | Sum DLC seluruh employee                                     |
| `locked_at`        | `timestamptz`      | Setelah lock, timesheet tidak bisa diedit untuk period ini   |
| `locked_by`        | `uuid`             | Finance / HR Admin                                           |

### Lock semantics

Setelah period `LOCKED`:

- Semua timesheet dengan `work_date` in `[period_start, period_end]` yang
  `status = APPROVED` di-freeze.
- Edit / delete → Server Action return `{ ok: false, code: "PERIOD_LOCKED" }`.
- Kalau ada correction, HR Admin buka period lagi (`UNLOCK_PERIOD` action, di-audit).

### Executive dashboard

`/dashboard` KPI cards menampilkan:

- **Gross Margin BPO** = `MRR - (DLC + Operational Expenses + Petty Cash + SLA Penalties)`.
- **DLC ratio** = `DLC / Revenue` per proyek.
- Warning kalau utilization > 100% budget kategori DIRECT_LABOR.

## 6. Performance Evaluation

Tabel: `public.evaluation_templates`, `public.evaluation_template_items`,
`public.performance_evaluations`, `public.evaluation_answers`,
`public.upk_notes`. Migration: `0059` (skeleton) → `0088` (auto-seed
default templates) → `0089` (project context + reviewer notes).

Modul ini men-drive **contract renewal decision** untuk PKWT — SPV
mengumpulkan skor kompetensi + goal achievement, PM meninjau, OM
menyetujui perpanjangan / tidak. Juga sumber data UPK (Unit Penilaian
Kinerja) untuk keputusan HR lainnya.

Route: `src/app/(app)/hr/performance/*`.

### Template

Setiap tenant otomatis mendapat 2 template default saat provisioning:

- **Contract Renewal Review** — versi English generic, 6 pertanyaan (3 competency, 2 goal, 1 note).
- **Evaluasi Triwulanan PKWT** — versi Indonesia, 5 pertanyaan.

Template baru dibuat di `/hr/performance/templates` (role
`TENANT_ADMIN` / `HR_ADMIN`). Setiap item punya `question_kind`
(`COMPETENCY` / `GOAL` / `NOTE`) + `weight_pct` (harus jumlah 100%
untuk COMPETENCY + GOAL).

### Evaluation lifecycle

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> SUBMITTED_BY_SPV: SPV isi jawaban + submit
    SUBMITTED_BY_SPV --> REVIEWED_BY_PM: PM setuju
    SUBMITTED_BY_SPV --> RETURNED_TO_SPV: PM minta revisi
    REVIEWED_BY_PM --> FINALIZED_BY_OM: OM setuju perpanjangan
    REVIEWED_BY_PM --> RETURNED_TO_SPV: OM minta revisi
    RETURNED_TO_SPV --> SUBMITTED_BY_SPV: SPV re-submit
    FINALIZED_BY_OM --> [*]
    DRAFT --> CANCELLED
```

Aktor per state:

| State                 | Siapa yang bertindak                        | Aksi utama                                                   |
| --------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| `DRAFT`               | SPV karyawan (auto-resolve dari `reports_to`)| Isi jawaban COMPETENCY + GOAL + NOTE                         |
| `SUBMITTED_BY_SPV`    | PM struktural (auto-resolve dari SPV chain) | Review + approve → `REVIEWED_BY_PM` atau `RETURNED_TO_SPV`   |
| `REVIEWED_BY_PM`      | OM struktural (auto-resolve dari PM chain)  | Final decision perpanjangan kontrak + durasi extension       |
| `FINALIZED_BY_OM`     | HR Admin                                    | Trigger UPK note / update kontrak                            |

### Project context + Project Reviewer notes (baru — migration `0089`)

Chain SPV → PM → OM di atas menggunakan **struktur pelaporan** (kolom
`employees.reports_to_employee_id`). Namun karyawan yang di-assign ke
project seringkali di-supervisi day-to-day oleh **project PM** yang
belum tentu sama dengan PM struktural (mis. engineer di project A
report struktural ke Manager Engineering, tapi PM proyek A yang lihat
performa harian mereka).

Untuk gap ini, setiap evaluasi bisa optional link ke project + reviewer:

| Kolom                          | Tipe        | Note                                                                        |
| ------------------------------ | ----------- | --------------------------------------------------------------------------- |
| `project_id`                   | `uuid?`     | FK → `projects` — set saat create kalau evaluasi cover project kerja tertentu|
| `project_reviewer_employee_id` | `uuid?`     | Otomatis di-resolve ke `PRIMARY_PM` dari project pada saat DRAFT dibuat     |
| `project_reviewer_notes`       | `text?`     | Feedback bebas dari PM proyek (kualitas delivery, teknis, observasi harian) |
| `project_reviewed_at`          | `timestamptz?`| Kapan PM proyek submit catatan                                             |

Alur:

1. **HR / SPV** create evaluasi via `/hr/performance/new`. Dropdown
   "Konteks proyek (opsional)" hanya menampilkan project yang aktif
   untuk karyawan (via `loadEmployeeProjectCandidates()`).
2. Kalau project dipilih, sistem auto-fill `project_reviewer_employee_id`
   = PRIMARY_PM project itu + kirim notifikasi
   `EVALUATION_PROJECT_REVIEW_REQUESTED` ke reviewer.
3. Reviewer buka `/hr/performance/[id]` → **Project Reviewer Card**
   muncul di bagian atas. Reviewer submit notes via
   `submitProjectReviewerNotesAction`. Notes bisa di-update selama
   status evaluation belum `FINALIZED_BY_OM` / `CANCELLED`.
4. Setelah submit, notifikasi `EVALUATION_PROJECT_REVIEWED` dikirim ke
   SPV + PM struktural + OM sehingga mereka bisa baca notes sebelum
   mengambil keputusan approve/return.

**Note**: Kolom-kolom ini opsional — evaluasi karyawan non-project
(mis. HR staff internal) tetap bisa jalan tanpa project context.

### RLS access

Row visibility (`performance_evaluations_read` policy):

- HR / Management (role `HR_ADMIN` / `TENANT_ADMIN` / `GENERAL_MANAGER`) → semua row di tenant.
- SPV / PM / OM / project reviewer → hanya row yang mereka bertindak sebagai stakeholder.
- Employee **tidak** dapat lihat evaluasi diri sendiri (by design — hasil disampaikan HR via one-on-one).

### UI checklist

- List: `/hr/performance` — filter by status + template + contract_end window.
- Detail: `/hr/performance/[id]` — timeline lengkap (Draft → SPV submit → PM review → OM finalize → UPK) + Project Reviewer Card.
- Template management: `/hr/performance/templates` — CRUD template + preview item form.

## Server Actions overview

| Module       | Actions                                                                                        | File                                                     |
| ------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Employees    | `createEmployeeAction`, `updateEmployeeAction`, `terminateEmployeeAction`                     | `src/app/(app)/team/actions.ts`                          |
| Shifts       | `createShiftAction`, `updateShiftAction`                                                       | `src/app/(app)/hr/roster/actions.ts`                     |
| Roster       | `rosterEmployeeAction`, `updateRosterStatusAction`                                             | same                                                     |
| HR Requests  | `submitHrRequestAction`, `approveHrRequestAction`, `rejectHrRequestAction`, `cancelHrRequestAction`| `src/app/(app)/hr/requests/actions.ts`               |
| Daily TS     | `createTimesheetAction`, `submitTimesheetAction`, `approveTimesheetAction`, `rejectTimesheetAction`| `src/app/(app)/hr/timesheets/actions.ts`             |
| Weekly TS    | `submitWeeklyPacketAction`, `approveWeeklyPacketAction`, `rejectWeeklyPacketAction`            | `src/app/(app)/hr/timesheets/weekly/actions.ts`         |
| Payroll      | `lockPayrollPeriodAction`, `unlockPayrollPeriodAction`, `exportPayrollCsvAction`               | `src/app/(app)/hr/payroll/actions.ts`                    |
| Performance  | `startEvaluationAction`, `submitEvaluationAction`, `reviewByPmAction`, `finalizeByOmAction`, `submitProjectReviewerNotesAction` | `src/app/(app)/hr/performance/actions.ts` |

## Where to look next

- Approval chain detail per kind → [`../product/approval-workflows.md#hr-request-fixed-chain-tidak-by-nominal`](../product/approval-workflows.md#hr-request-fixed-chain-tidak-by-nominal).
- End-user guides:
  - Employee (submit HR request, isi timesheet) → [`../user-guides/internal-users.md#employee`](../user-guides/internal-users.md#employee).
  - HR Admin (finalize, kelola master, jalankan payroll) → [`../user-guides/internal-users.md#hr-admin`](../user-guides/internal-users.md#hr-admin).
- Schema detail → [`../reference/database-schema.md#hr-tables`](../reference/database-schema.md#hr-tables).
- Playwright specs: `e2e/hr-requests.spec.ts`, `e2e/weekly-timesheet.spec.ts`, `e2e/payroll.spec.ts`.
