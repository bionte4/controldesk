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

## Work Breakdown Structure (WBS) + Gantt

Migration: `0075_project_tasks_wbs.sql`. Route:
`src/app/(app)/projects/[id]/tasks/*`.

WBS memecah proyek menjadi **hierarki task berlapis** di bawah
milestones. Milestone tetap jadi "phase gate" Level 1 (checkpoint
kalender); task memberi visibilitas eksekusi Level 2 sampai N. Tidak
saling menggantikan — keduanya hidup berdampingan.

### Kapan pakai WBS vs Milestone?

| Butuh                                                          | Pakai        |
| -------------------------------------------------------------- | ------------ |
| Titik kalender + gate notifikasi ke Client Portal              | Milestone    |
| Rincian eksekusi hierarkis (parent → sub-task → sub-sub-task)  | WBS Task     |
| Progress rollup otomatis dari anak ke induk                    | WBS Task     |
| Visualisasi timeline drag-to-reschedule (Gantt)                | WBS Task     |
| Dependency finish-to-start antar pekerjaan                     | WBS Task     |
| Owner per pekerjaan detail                                     | WBS Task     |

Pattern rekomendasi: **Milestone = kickoff/UAT/GoLive**; **Task = semua
pekerjaan di antaranya**, di-anchor ke milestone lewat kolom
`milestone_id` (opsional).

### Schema

`public.project_tasks`:

| Kolom                    | Tipe                   | Note                                                    |
| ------------------------ | ---------------------- | ------------------------------------------------------- |
| `id`                     | `uuid`                 |                                                         |
| `tenant_id`              | `uuid`                 | Tenant isolation                                        |
| `project_id`             | `uuid`                 | FK → `projects`                                         |
| `milestone_id`           | `uuid`                 | Nullable — anchor ke phase gate                         |
| `parent_task_id`         | `uuid`                 | Self-ref — bikin hierarki                               |
| `sort_order`             | `int`                  | Urutan di antara siblings                               |
| `name`                   | `text`                 |                                                         |
| `description`            | `text`                 |                                                         |
| `status`                 | `task_status`          | State machine di bawah                                  |
| `progress_pct`           | `numeric(5,2)`         | 0–100. Manual di leaf, rolled-up di parent (read time)  |
| `weight_pct`             | `numeric(5,2)`         | Bobot untuk rollup weighted average                     |
| `planned_start_date`     | `date`                 |                                                         |
| `planned_end_date`       | `date`                 |                                                         |
| `actual_start_date`      | `date`                 | Auto-stamp saat status → `IN_PROGRESS`                  |
| `actual_end_date`        | `date`                 | Auto-stamp saat status → `DONE`                         |
| `owner_employee_id`      | `uuid`                 | Penanggung jawab                                        |
| `depends_on_task_id`     | `uuid`                 | Finish-to-start (single predecessor)                    |
| `budget_amount`          | `numeric(18,2)`        | Opsional — cost estimate                                |

### State machine

```
TODO → IN_PROGRESS → REVIEW → DONE
        ↓        ↓
      BLOCKED  BLOCKED
        ↓        ↓
   IN_PROGRESS  IN_PROGRESS
                ↓
            CANCELLED
```

Transitions memicu date stamping otomatis:

- `→ IN_PROGRESS` — set `actual_start_date = today` kalau masih null.
- `→ DONE` — set `actual_end_date = today` + `progress_pct = 100`.
- `→ CANCELLED` — freeze `progress_pct` di nilai terakhir.

### Cycle & tenant guards

Trigger `project_tasks_check_refs()` (di migration 0075) memblokir:

- `parent_task_id` ke task di project lain atau tenant lain.
- `depends_on_task_id` ke task di project/tenant lain.
- `milestone_id` yang tidak di project yang sama.

Cycle-guard tambahan di Server Action `reorderTaskAction` — walk chain
`parent_task_id` sampai `null`, kalau ketemu task yang di-reorder →
return `{ ok: false, code: "CYCLE_DETECTED" }`.

### Rollup (dihitung on-read)

`src/lib/data/tasks.ts::buildTaskTree()` mengubah flat list jadi tree
dan menghitung untuk **setiap parent**:

- `rolled_progress` — weighted average `progress_pct` semua descendants,
  bobot dari `weight_pct` (fallback `1` kalau semua weight 0).
- `rolled_start` — `min(planned_start_date)` di seluruh subtree.
- `rolled_end` — `max(planned_end_date)` di seluruh subtree.
- `wbs_code` — kode hierarkis `"1"`, `"1.1"`, `"1.1.2"` … di-derive dari
  `sort_order` (tidak disimpan di DB — selalu recompute).
- `depth` — kedalaman dari root (0-based).

Keputusan **on-read vs on-write**: rollup tidak persist di DB supaya
insert/reorder tetap murah dan tidak butuh trigger recursive. Untuk
proyek besar (>500 task) bisa pindah ke materialized view di Fase 4.

### Server Actions

Semua di `src/app/(app)/projects/[id]/tasks/actions.ts`, wrapped dengan
`withCanonicalSecureAction`:

| Action                     | Resource        | Action verb | Notes                                              |
| -------------------------- | --------------- | ----------- | -------------------------------------------------- |
| `createTaskAction`         | `project_task`  | `create`    | Auto-assign `sort_order = max(siblings) + 10`      |
| `updateTaskAction`         | `project_task`  | `update`    | Partial update — hanya field yang dikirim          |
| `setTaskStatusAction`      | `project_task`  | `update`    | Status transition + auto date stamping             |
| `setTaskProgressAction`    | `project_task`  | `update`    | Set `progress_pct` leaf task (parent = rolled up)  |
| `reorderTaskAction`        | `project_task`  | `update`    | Move task; new parent + cycle guard + resequence   |
| `deleteTaskAction`         | `project_task`  | `delete`    | Cascade ke semua descendants (FK)                  |

PDP di `src/lib/security/pdp-canonical.ts::decideProjectTask()`:

- **Create / Update** — `SUPERVISOR`, `PM`, `OM`, `DIRECTOR`, `ADMIN`.
- **Delete** — `PM`, `OM`, `DIRECTOR`, `ADMIN` (Supervisor tidak boleh
  hapus WBS — supaya audit tree tetap utuh).
- **Read** — via RLS: siapa saja yang ke-assign ke project.

### UI

`<ProjectTasksSection>` (RSC) di
`src/app/(app)/projects/[id]/tasks/tasks-section.tsx` — render stats
strip (total/done/in-progress/blocked/overdue) lalu wrap
`<TasksView>` (client) yang punya dua tab:

**1. WBS Tree** (`<WbsTree>`):

- Table hierarkis dengan expand/collapse per parent.
- Kolom: WBS code · Task name · Owner · Rolled progress bar · Planned
  date range · Status badge.
- Row overdue (planned_end < today AND status ∉ {DONE, CANCELLED})
  highlight amber.
- Row menu (`<TaskRowActions>`): edit, add sub-task, set progress
  preset (0/25/50/75/100), change status, delete dengan confirm.

**2. Gantt Chart** (`<ProjectGanttChart>` — pakai
[frappe-gantt](https://frappe.io/gantt) MIT ~30 KB):

- Dynamic import (SSR-safe): `import("frappe-gantt")`.
- View mode: **Day / Week / Month** (default Week).
- **Drag bar horizontal** → `setTaskDatesAction` update
  `planned_start_date` + `planned_end_date`.
- **Drag right edge progress handle** → `setTaskProgressAction`.
- Panel bawah "Unplanned tasks" untuk task tanpa `planned_*` date —
  klik untuk buka `<TaskSheet>` dan isi tanggal.

### i18n

Namespace `tasks.*` di `messages/{id,en}.json`. Semua label task
(status, kolom, form, aksi, stats) di-drive dari kunci ini. Tambah
kunci baru: patch **kedua** file di PR yang sama; CI akan gagal kalau
namespace tidak balance.

### Sisa pekerjaan (deferred ke Fase 4+)

- **WBS templates** — global (per industri) + per-tenant (custom).
  Admin UI untuk provisioning template saat create project.
- **Timesheet + expense linkage** — kolom `task_id` di
  `timesheet_entries`, `project_expenses`, `cash_advances` supaya
  bisa cost-track per task.
- **Multi-predecessor dependency graph + critical path** — sekarang
  hanya single `depends_on_task_id`.
- **Baseline snapshot** — snapshot planned dates saat kickoff dan
  bandingkan dengan actual (schedule variance).

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

## PM Handover — DEPRECATED per rules §13

> **Status:** dihentikan. Menu "Handovers" **sudah dihapus dari sidebar**
> (commit `9e52119`) dan tabel `pm_handovers` akan di-drop di migration
> Fase 0.4. Baris lama akan diarsipkan ke cold storage. Doc ini
> dipertahankan hanya sebagai referensi historis — **jangan** bangun
> feature baru yang bergantung pada modul ini.

### Ganti PM tanpa modul handover

Rules §13 sudah mengatur cara baru mengganti PM (align dengan GAS ERP):

1. Buka **Assignments → Filter by project → PM tab**.
2. Set row PM lama `status = 'Completed'` (tombol "End Assignment").
3. Insert row baru untuk PM baru: `role = 'PRIMARY_PM'`,
   `status = 'Active'`. Sistem otomatis:
   - Menutup handoff via audit trigger (record `old_values` / `new_values`
     ke `security_audit_logs`).
   - Rebind pending approvals via RLS policy — approver berikutnya
     resolve dari PM aktif saat evaluasi, bukan saat submit.
4. Kirim notifikasi manual via tombol **"Notify handover"** di header
   Assignment atau via `POST /api/notifications/manual` untuk kirim
   pesan template ke PM baru.

Karena semua efek stateful (assignment swap, pending approval
rebinding) sekarang di-handle otomatis oleh RLS + audit trigger, tidak
ada lagi kebutuhan state machine terpisah. Kalau butuh multi-approver
untuk change PM (mis. OM + Director sign-off), pakai **Issues module**
(§26 rules) — buat issue tipe `HANDOVER_APPROVAL`, minta approval via
alur SLA business-hours standar, dan setelah closed baru assignment
di-swap manual.

### Data historis

Jika Anda perlu audit siapa PM proyek X pada tanggal Y, gunakan:

```sql
select ass.pm_employee_id, ass.assignment_role, ass.started_at,
       coalesce(ass.ended_at, 'now') as ended_at
from public.project_pm_assignments ass
where ass.project_id = 'X'
order by ass.started_at;
```

Jendela waktu terbaca dari `started_at`/`ended_at` — tabel
`pm_handovers` lama tetap dapat di-SELECT sampai migration 0.4 dijalankan.

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
| `createTaskAction`                  | `src/app/(app)/projects/[id]/tasks/actions.ts`              | `withCanonicalSecureAction`   |
| `updateTaskAction`                  | same                                                         | `withCanonicalSecureAction`   |
| `setTaskStatusAction`               | same                                                         | `withCanonicalSecureAction`   |
| `setTaskProgressAction`             | same                                                         | `withCanonicalSecureAction`   |
| `reorderTaskAction`                 | same                                                         | `withCanonicalSecureAction`   |
| `deleteTaskAction`                  | same                                                         | `withCanonicalSecureAction`   |

Semua return `ActionResult<T>` per contract §17.

## Where to look next

- Business rules on approval chains → [`../product/approval-workflows.md`](../product/approval-workflows.md).
- End-user PM guide → [`../user-guides/internal-users.md#project-manager`](../user-guides/internal-users.md#project-manager).
- Schema detail → [`../reference/database-schema.md#projects`](../reference/database-schema.md#projects).
- Playwright specs: `e2e/projects.spec.ts`, `e2e/handovers.spec.ts`, `e2e/pm-handover-chain.spec.ts`, `e2e/project-issues.spec.ts`.
