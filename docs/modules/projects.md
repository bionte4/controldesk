# Projects (assignments, issues, handovers)

Modul projek adalah **pusat gravitasi** ControlDesk — hampir semua modul
lain (expense, cash advance, timesheet, HR request) tersambung ke
proyek. Doc ini menjelaskan project lifecycle, assignment engine, issue
tracker, dan PM handover flow.

Route: `src/app/(app)/projects/*` + `src/app/(app)/handovers/*`.

## Project

Tabel: `public.projects` (migrations `0008`, GAS-align via `0022`).

### Lifecycle

```
DRAFT → PLANNED → ACTIVE → COMPLETED
                  ↓
              CANCELLED
```

- **DRAFT** — data proyek baru dibuat, belum ada budget dan assignment
  final. Bisa diedit bebas oleh PM.
- **PLANNED** — data lengkap, kickoff belum dilakukan.
- **ACTIVE** — proyek berjalan; semua expense/CA/timesheet valid.
- **COMPLETED** — pekerjaan selesai. Bisa masih menerima expense
  settlement (misal Field Ops CA yang belum di-close).
- **CANCELLED** — dibatalkan; semua pending approval untuk proyek ini
  auto-reject dengan reason `PROJECT_CANCELLED`.

Trigger notifikasi Client Portal saat status → `COMPLETED`.

### Key columns

| Kolom              | Tipe              | Note                                            |
| ------------------ | ----------------- | ----------------------------------------------- |
| `client_id`        | `uuid`            | 1:N — satu client bisa punya banyak proyek.     |
| `code`             | `text`            | Kode proyek (mis. `PRJ-2026-001`).             |
| `name`             | `text`            | Nama proyek.                                    |
| `contract_type`    | `project_contract_type` | `ONE_OFF` / `RETAINER` / `MANAGED_SERVICES`. |
| `status`           | `project_status`  | State machine di atas.                          |
| `start_date`, `end_date` | `date`      | Rencana kalender.                               |
| `budget_amount`    | `numeric(18,2)`   | Anggaran total (agregat dari `budget_details`).|
| `progress_pct`     | `int`             | 0–100. Update manual atau derived dari milestones. |
| `assigned_pm_id`   | `uuid`            | PM primer aktif (mirror dari `project_pm_assignments`). |

## Project Milestones

Tabel: `public.project_milestones` (migration `0022`).

Titik-titik pencapaian di proyek dengan due date + status.

State machine:
```
PLANNED → IN_PROGRESS → DONE
                     ↓
                 AT_RISK ↔ IN_PROGRESS
                     ↓
                 CANCELLED
```

Trigger otomatis `enqueue_portal_notification` saat status → `DONE` /
`AT_RISK` / `CANCELLED`. Notifikasi masuk ke `portal_notifications` +
muncul di bell klien portal.

Progres proyek keseluruhan tidak auto-derive dari milestones (biar PM
punya control) — tapi ada helper UI yang show
`completed_milestones / total_milestones` sebagai secondary indicator.

## Assignment engine

Dua tabel: `project_pm_assignments` + `project_employee_assignments`.

### PM assignments

`public.project_pm_assignments`:

| Kolom               | Tipe                       | Note                                        |
| ------------------- | -------------------------- | ------------------------------------------- |
| `project_id`        | `uuid`                     |                                             |
| `employee_id`       | `uuid`                     | Yang di-assign                              |
| `assignment_role`   | `project_assignment_role`  | `PRIMARY_PM` / `CO_PM`                      |
| `status`            | `assignment_status`        | `ACTIVE` / `INACTIVE`                       |
| `assigned_at`       | `timestamptz`              |                                             |
| `unassigned_at`     | `timestamptz`              | Null saat aktif                             |

**Constraint**: hanya boleh ada **satu row** dengan
`assignment_role='PRIMARY_PM'` + `status='ACTIVE'` per proyek. CO_PM
boleh multiple.

Multi-project: PM boleh punya banyak `PRIMARY_PM` di berbagai proyek
sekaligus — jadi `MULTI_PROJECT_CANONICAL_ROLES` (di
`src/lib/rbac/roles.ts`) untuk `PM` dan `OM` return `true`.

### Employee assignments

`public.project_employee_assignments`:

| Kolom                   | Tipe                          | Note                                    |
| ----------------------- | ----------------------------- | --------------------------------------- |
| `project_id`            | `uuid`                        |                                         |
| `employee_id`           | `uuid`                        |                                         |
| `role_on_project`       | `project_assignment_role`     | `SUPERVISOR`, `SENIOR_STAFF`, `STAFF`   |
| `allocation_percentage` | `int` (0–100)                 | % waktu employee untuk proyek ini       |
| `status`                | `assignment_status`           | `ACTIVE` / `INACTIVE`                   |
| `start_date`, `end_date`| `date`                        | Optional — batas assignment             |

**Business rule (§7)**: total `allocation_percentage` untuk 1 employee
di semua proyek `ACTIVE` **DILARANG > 100%**. Kalau PM coba
mengalokasikan seseorang beyond 100%, Server Action akan return
`{ ok: false, code: "ALLOCATION_OVERBOOKED", reason: "..." }`.

Enforcement:
- App layer: check di `assignEmployeeAction` sebelum insert.
- DB layer: constraint check via trigger `check_allocation_sum` yang
  hitung SUM per employee dan raise `check_violation`.

**Multi-project rule**: `SUPERVISOR` dan `EMPLOYEE` role by default
**single project at a time** — kalau lagi ACTIVE di proyek A, tidak
bisa dialokasikan ke proyek B. Bisa override tapi harus disertai
written note (`assignment_override_reason`) yang masuk audit.

## Project Issues

Migration: `0029_project_issues.sql`.

Tracker isu / masalah di proyek. Yang membedakan dari task manager
generik: **SLA business-hours** + **auto-escalation ladder**.

### Schema

`public.project_issues`:

| Kolom            | Tipe                | Note                                                 |
| ---------------- | ------------------- | ---------------------------------------------------- |
| `id`             | `uuid`              |                                                      |
| `tenant_id`      | `uuid`              |                                                      |
| `project_id`     | `uuid`              |                                                      |
| `title`          | `text`              |                                                      |
| `description`    | `text`              |                                                      |
| `severity`       | `issue_severity`    | `CRITICAL` / `HIGH` / `MEDIUM` / `LOW`               |
| `status`         | `issue_status`      | `OPEN` / `IN_PROGRESS` / `RESOLVED` / `CLOSED` / `REOPENED` |
| `reporter_id`    | `uuid`              | Employee yang report                                 |
| `assignee_id`    | `uuid`              | Employee yang handle                                 |
| `opened_at`      | `timestamptz`       |                                                      |
| `resolved_at`    | `timestamptz`       | Null kalau belum resolved                            |
| `closed_at`      | `timestamptz`       |                                                      |
| `sla_target_at`  | `timestamptz`       | Deadline SLA (dihitung dari severity + business hours)|
| `escalated_to_level` | `int`           | 0=none, 1=Supervisor, 2=PM, 3=OM, 4=Director        |

### SLA business-hours

Bukan pakai wall-clock. Business hours default: **Senin-Jumat
09:00-17:00** timezone tenant (default `Asia/Jakarta`). Bisa di-tune
per tenant.

SLA per severity:

| Severity | SLA (business-hours) |
| -------- | -------------------- |
| Critical | 1 hour               |
| High     | 4 hours              |
| Medium   | 8 hours              |
| Low      | 24 hours             |

Contoh: issue Critical dibuka Jumat 16:30 WIB → SLA_target = Senin 09:30
WIB (bukan Jumat 17:30 karena Sabtu-Minggu tidak dihitung).

Helper: `src/lib/issues/sla.ts` — `computeSlaTarget(openedAt, severity, businessHours, tenantTz)`.

### Auto-escalation

Cron `/api/cron/issues-sla` jalan **tiap 15 menit**. Untuk setiap issue
yang past SLA:

- Level 0 → 1: notifikasi ke Supervisor proyek.
- Level 1 → 2: notifikasi ke PM proyek.
- Level 2 → 3: notifikasi ke OM.
- Level 3 → 4: notifikasi ke Director.

Setiap escalation:
- Insert row baru di `project_issue_escalations`.
- Kirim notifikasi in-app (bell) + email.
- Naikkan `escalated_to_level`.

Setelah level 4 dan issue masih OPEN, cron tetap kirim reminder harian
(bukan bikin level baru), tapi tidak escalate lagi.

**Reset escalation**: bila issue di-`RESOLVED`, ladder reset. Kalau
kemudian `REOPENED`, mulai lagi dari level 0 dengan SLA baru dihitung
dari waktu reopen.

## PM Handover

Migration: `0013_pm_handovers.sql`.

Serah terima proyek dari PM lama ke PM baru — critical event yang
memerlukan approval OM + Director dan otomatis migrasi state.

### Why handover terpisah?

Ganti PM adalah operasi **stateful** — kalau langsung diedit di
`project_pm_assignments`, semua pending approvals + tasks aktif akan
tertahan di PM lama yang sudah tidak involved. Handover flow bikin
audit lengkap + transfer atomic.

### Schema

`public.pm_handovers`:

| Kolom                     | Tipe                   | Note                                              |
| ------------------------- | ---------------------- | ------------------------------------------------- |
| `id`                      | `uuid`                 |                                                   |
| `project_id`              | `uuid`                 |                                                   |
| `outgoing_pm_id`          | `uuid`                 |                                                   |
| `incoming_pm_id`          | `uuid`                 |                                                   |
| `handover_date`           | `date`                 | Rencana kalender effective                        |
| `reason`                  | `text`                 | Justifikasi (resign, rotasi, cuti panjang, dst)  |
| `notes`                   | `text`                 | Catatan serah terima (task list, pending items)  |
| `status`                  | `handover_status`      | State machine di bawah                            |
| `created_by`              | `uuid`                 |                                                   |
| `approved_om_id`          | `uuid`                 | Nullable                                          |
| `approved_director_id`    | `uuid`                 | Nullable                                          |
| `applied_at`              | `timestamptz`          | Kapan transisi diaplikasikan                      |

### State machine

```
DRAFT → PENDING_OM → PENDING_DIRECTOR → APPROVED → APPLIED
   ↓          ↓                ↓
CANCELLED   REJECTED       REJECTED
```

- **APPROVED**: dua approval sudah masuk, tapi belum transfer state.
- **APPLIED**: transaksi DB dijalankan — semua efek berikut atomic:
  1. `UPDATE project_pm_assignments` — set outgoing PM `status=INACTIVE`, `unassigned_at=NOW()`; INSERT row baru untuk incoming PM `status=ACTIVE`, `assignment_role='PRIMARY_PM'`.
  2. `UPDATE expenses / cash_advances / budget_requests` yang status-nya masih PENDING dan `assignee_pm_id=outgoing` → set `assignee_pm_id=incoming`.
  3. `UPDATE project_milestones` yang `owner_id=outgoing` → `owner_id=incoming`.
  4. Kirim notifikasi ke incoming PM: "Anda menerima handover proyek X dari Y."
  5. Insert audit log dengan `action_type='HANDOVER_APPLIED'`.

Kalau salah satu step gagal → seluruh transaksi rollback + status
tetap `APPROVED`. Ops bisa re-trigger `applyHandoverAction` setelah
memperbaiki root cause.

## Server Actions overview

| Action                              | File                                                          | Wrapper                       |
| ----------------------------------- | ------------------------------------------------------------- | ----------------------------- |
| `createProjectAction`               | `src/app/(app)/projects/actions.ts`                          | `withSecureAction`            |
| `updateProjectAction`               | same                                                         | `withSecureAction`            |
| `changeProjectStatusAction`         | same                                                         | `withSecureAction`            |
| `assignPmAction` / `unassignPmAction`| same                                                        | `withSecureAction`            |
| `assignEmployeeAction`              | same                                                         | `withSecureAction`            |
| `createIssueAction`                 | `src/app/(app)/projects/[id]/issues/actions.ts`             | `withSecureAction`            |
| `updateIssueStatusAction`           | same                                                         | `withSecureAction`            |
| `createHandoverAction`              | `src/app/(app)/handovers/actions.ts`                        | `withCanonicalSecureAction`   |
| `approveHandoverAction`             | same                                                         | `withCanonicalSecureAction`   |
| `applyHandoverAction`               | same                                                         | `withCanonicalSecureAction`   |

Semua return `ActionResult<T>` per contract §17.

## Where to look next

- Business rules on approval chains → [`../product/approval-workflows.md`](../product/approval-workflows.md).
- End-user PM guide → [`../user-guides/internal-users.md#project-manager`](../user-guides/internal-users.md#project-manager).
- Schema detail → [`../reference/database-schema.md#projects`](../reference/database-schema.md#projects).
- Playwright specs: `e2e/projects.spec.ts`, `e2e/handovers.spec.ts`, `e2e/pm-handover-chain.spec.ts`, `e2e/project-issues.spec.ts`.
