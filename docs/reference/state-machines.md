# State machines reference

Semua state machine di ControlDesk tercatat di satu tempat sebagai
reference visual. Untuk detail behaviour + code links, ikuti tautan
per modul.

Aturan universal (rules §17):

- **State transitions adalah pure functions** — hidup di
  `src/lib/{module}/state.ts`, tanpa I/O. Unit-tested.
- **Server Actions memanggil helper state**, tidak mengulang logic.
- **Setiap transition wajib audit** — direkam otomatis oleh
  `withSecureAction()` dengan `auditAction` sesuai transition.
- **Rollback**: state tidak "undo-able" — cara mengembalikan adalah
  submit item baru dengan kind yang tepat (mis. refund via new
  expense, budget request kind=DECREASE, dst).

## Table of contents

- [Expense (legacy)](#expense-legacy)
- [Cash Advance (canonical)](#cash-advance-canonical)
- [Budget Request](#budget-request)
- [HR Request](#hr-request)
- [Project](#project)
- [Project Milestone](#project-milestone)
- [Project Issue](#project-issue)
- [PM Handover](#pm-handover)
- [Petty Cash Voucher](#petty-cash-voucher)
- [Petty Cash Replenishment](#petty-cash-replenishment)
- [Timesheet (daily)](#timesheet-daily)
- [Timesheet Weekly Packet](#timesheet-weekly-packet)
- [Payroll Period](#payroll-period)
- [Client Portal User](#client-portal-user)

---

## Expense (legacy)

Modul: [`finance.md#1-project-expenses`](../modules/finance.md#1-project-expenses).

Kode helper: `src/lib/expenses/state.ts`.

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> PENDING_L1_SUPERVISOR: submit
    DRAFT --> CANCELLED: submitter cancel
    PENDING_L1_SUPERVISOR --> PENDING_L2_PM: approve
    PENDING_L1_SUPERVISOR --> REJECTED: reject
    PENDING_L2_PM --> PENDING_L3_OM: approve (≥25M)
    PENDING_L2_PM --> PENDING_L4_HM: approve (25M ≤ x < 100M)
    PENDING_L2_PM --> PENDING_FINANCE: approve (<25M)
    PENDING_L2_PM --> REJECTED
    PENDING_L3_OM --> PENDING_L4_HM: approve (≥100M)
    PENDING_L3_OM --> PENDING_FINANCE: approve (else)
    PENDING_L3_OM --> REJECTED
    PENDING_L4_HM --> PENDING_L5_GM: approve
    PENDING_L4_HM --> REJECTED
    PENDING_L5_GM --> PENDING_FINANCE: approve
    PENDING_L5_GM --> REJECTED
    PENDING_FINANCE --> APPROVED: finance approve
    PENDING_FINANCE --> REJECTED: finance reject
    APPROVED --> [*]
    REJECTED --> [*]
    CANCELLED --> [*]
```

**Threshold matrix**: [`../product/approval-workflows.md#project-expense-expenseapprovalchain`](../product/approval-workflows.md#project-expense-expenseapprovalchain).

---

## Cash Advance (canonical)

Modul: [`finance.md#2-cash-advance-kas-bon`](../modules/finance.md#2-cash-advance-kas-bon).

Kode helper: `src/lib/cash-advances/state.ts`.

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> PENDING_SUPERVISOR: submit (FIELD_OPS)
    DRAFT --> PENDING_PM: submit (GENERAL, ≥2M) or (FIELD_OPS supervisor-skipped edge)
    DRAFT --> PENDING_FINANCE: submit (<PM threshold)
    DRAFT --> CANCELLED: submitter cancel

    PENDING_SUPERVISOR --> PENDING_PM: sup approve (FIELD_OPS ≥5M)
    PENDING_SUPERVISOR --> PENDING_FINANCE: sup approve (FIELD_OPS <5M)
    PENDING_SUPERVISOR --> REJECTED: sup reject

    PENDING_PM --> PENDING_OM: pm approve (FIELD_OPS ≥20M)
    PENDING_PM --> PENDING_FINANCE: pm approve (else)
    PENDING_PM --> REJECTED

    PENDING_OM --> PENDING_FINANCE: om approve
    PENDING_OM --> REJECTED

    PENDING_FINANCE --> PENDING_DIRECTOR: finance approve (FIELD_OPS ≥50M or GEN ≥20M)
    PENDING_FINANCE --> APPROVED: finance approve (else)
    PENDING_FINANCE --> REJECTED

    PENDING_DIRECTOR --> APPROVED: director approve
    PENDING_DIRECTOR --> REJECTED

    APPROVED --> DISBURSED: finance disburse
    DISBURSED --> SETTLING: employee submit nota
    SETTLING --> SETTLED: finance finalize
    SETTLING --> SETTLING: finance request revision
```

**Field Ops SLA**: 10 hari kalender dari `DISBURSED` ke `SETTLED`.
Reminder cron di offset `-3, 0, +1, +3, +7`.

---

## Budget Request

Modul: [`finance.md#budget-requests`](../modules/finance.md#budget-requests).

Kode helper: `src/lib/budget-requests/state.ts`.

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> PENDING_PM: submit (delta ≥ 5M)
    DRAFT --> PENDING_FINANCE: submit (delta < 5M)
    DRAFT --> CANCELLED: submitter cancel

    PENDING_PM --> PENDING_FINANCE: pm approve
    PENDING_PM --> REJECTED

    PENDING_FINANCE --> PENDING_DIRECTOR: finance approve (delta ≥ 50M)
    PENDING_FINANCE --> APPROVED: finance approve (else)
    PENDING_FINANCE --> REJECTED

    PENDING_DIRECTOR --> APPROVED: director approve
    PENDING_DIRECTOR --> REJECTED

    APPROVED --> APPLIED: apply() — atomic mutation of budget_details + budgets
    APPROVED --> [*]: (no-op if apply() explicitly deferred)
```

**Terminal `APPLIED`**: satu-satunya state yang **actually modifies
budget**. Sebelum APPLIED, approval hanya proposal.

---

## HR Request

Modul: [`hris-and-payroll.md#3-hr-requests`](../modules/hris-and-payroll.md#3-hr-requests).

Kode helper: `src/lib/hris/state.ts`.

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> PENDING_L1_SUPERVISOR: submit
    DRAFT --> CANCELLED: submitter cancel

    PENDING_L1_SUPERVISOR --> PENDING_L2_PM: sup approve (LEAVE/OT)
    PENDING_L1_SUPERVISOR --> PENDING_HR_ADMIN: sup approve (SICK)
    PENDING_L1_SUPERVISOR --> REJECTED

    PENDING_L2_PM --> PENDING_L3_OM: pm approve
    PENDING_L2_PM --> REJECTED

    PENDING_L3_OM --> PENDING_HR_ADMIN: om approve
    PENDING_L3_OM --> REJECTED

    PENDING_HR_ADMIN --> APPROVED: hr finalize
    PENDING_HR_ADMIN --> REJECTED
```

**Chain by kind**: `hrChainForKind()`.

---

## Project

Modul: [`projects.md#project`](../modules/projects.md#project).

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> PLANNED: complete kickoff data
    PLANNED --> ACTIVE: project starts
    ACTIVE --> COMPLETED: work delivered
    ACTIVE --> CANCELLED: escalation cancels
    PLANNED --> CANCELLED
    DRAFT --> CANCELLED
    COMPLETED --> [*]
    CANCELLED --> [*]
```

**Side effect di `CANCELLED`**: semua pending approvals untuk proyek
ini auto-reject dengan reason `PROJECT_CANCELLED`.

---

## Project Milestone

Modul: [`projects.md#project-milestones`](../modules/projects.md#project-milestones).

```mermaid
stateDiagram-v2
    [*] --> PLANNED
    PLANNED --> IN_PROGRESS: start work
    IN_PROGRESS --> DONE: complete
    IN_PROGRESS --> AT_RISK: risk identified
    AT_RISK --> IN_PROGRESS: risk mitigated
    AT_RISK --> DONE: complete despite risk
    IN_PROGRESS --> CANCELLED: scope removed
    AT_RISK --> CANCELLED
    PLANNED --> CANCELLED
    DONE --> [*]
    CANCELLED --> [*]
```

**Portal notification trigger**: setiap transisi ke `DONE` / `AT_RISK` /
`CANCELLED` insert row di `portal_notifications` untuk semua active
`client_users` client tersebut.

---

## Project Issue

Modul: [`projects.md#project-issues`](../modules/projects.md#project-issues).

Kode helper: `src/lib/issues/state.ts` + `src/lib/issues/sla.ts`.

```mermaid
stateDiagram-v2
    [*] --> OPEN
    OPEN --> IN_PROGRESS: assign work
    IN_PROGRESS --> RESOLVED: fix applied
    RESOLVED --> CLOSED: reporter confirm
    RESOLVED --> REOPENED: reporter reopen
    REOPENED --> IN_PROGRESS: resume work
    CLOSED --> REOPENED: escalation reopens
    IN_PROGRESS --> OPEN: unassign
    CLOSED --> [*]
```

**SLA + escalation** (separate from state, driven by cron 15-min sweep):

- SLA target dihitung dari `openedAt` + severity + business hours.
- Kalau past SLA + belum resolved/closed → escalate ke level next di
  ladder: Supervisor (1) → PM (2) → OM (3) → Director (4).
- Reset saat status → `RESOLVED`.

---

## PM Handover

Modul: [`projects.md#pm-handover`](../modules/projects.md#pm-handover).

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> PENDING_OM: submit
    DRAFT --> CANCELLED

    PENDING_OM --> PENDING_DIRECTOR: om approve
    PENDING_OM --> REJECTED

    PENDING_DIRECTOR --> APPROVED: director approve
    PENDING_DIRECTOR --> REJECTED

    APPROVED --> APPLIED: apply() — atomic transfer of PM + tasks + approvals
```

**Terminal `APPLIED`**: transaksi DB yang atomic:

1. Update `project_pm_assignments` (out → INACTIVE, in → ACTIVE PRIMARY).
2. Reassign pending approvals (expense, CA, budget request) yang
   assigned to outgoing PM.
3. Reassign active milestones yang owner outgoing PM.
4. Notification ke incoming PM.
5. Insert audit log dengan `HANDOVER_APPLIED`.

---

## Petty Cash Voucher

Modul: [`finance.md#petty-cash-vouchers-transaksi-keluar`](../modules/finance.md#petty-cash-vouchers-transaksi-keluar).

**Decision** (bukan state machine) di submit time:

```
amount < Rp 100rb              → AUTO_APPROVED → POSTED
Rp 100rb ≤ amount < Rp 200rb   → AUTO_APPROVED (requires receipt) → POSTED
Rp 200rb ≤ amount ≤ Rp 2M      → PENDING_FINANCE → (approve) → POSTED
amount > Rp 2M                 → ABOVE_CEILING (reject, redirect ke expense flow)
```

```mermaid
stateDiagram-v2
    [*] --> Decision: submit(amount)
    Decision --> POSTED: AUTO_APPROVED
    Decision --> PENDING_FINANCE: FINANCE_APPROVAL_REQUIRED
    Decision --> [*]: ABOVE_CEILING (rejected)
    PENDING_FINANCE --> POSTED: finance approve
    PENDING_FINANCE --> REJECTED: finance reject
    POSTED --> [*]
    REJECTED --> [*]
```

---

## Petty Cash Replenishment

Modul: [`finance.md#petty-cash-replenishments-isi-ulang`](../modules/finance.md#petty-cash-replenishments-isi-ulang).

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> PENDING_FINANCE: submit
    PENDING_FINANCE --> APPROVED: finance approve
    PENDING_FINANCE --> REJECTED
    APPROVED --> DISBURSED: finance disburse (write cash)
    DISBURSED --> POSTED: custodian confirm receipt, updates balance
```

Terminal `POSTED` → `petty_cash_funds.current_balance` reset ke
`imprest_amount`.

---

## Timesheet (daily)

Modul: [`hris-and-payroll.md#daily-timesheet`](../modules/hris-and-payroll.md#daily-timesheet).

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> SUBMITTED: submit
    SUBMITTED --> APPROVED: PM/supervisor approve
    SUBMITTED --> REJECTED: PM/supervisor reject
    REJECTED --> DRAFT: submitter fixes & resubmit
    APPROVED --> [*]
```

---

## Timesheet Weekly Packet

Modul: [`hris-and-payroll.md#weekly-timesheet-packet`](../modules/hris-and-payroll.md#weekly-timesheet-packet).

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> SUBMITTED: submit packet
    SUBMITTED --> APPROVED: PM approve packet
    SUBMITTED --> REJECTED: PM reject packet (with reason)
    REJECTED --> DRAFT: employee fixes & resubmit
    APPROVED --> [*]
```

**Cascade**: state packet propagates ke semua `timesheets.status` yang
`week_id = packet.id`.

---

## Payroll Period

Modul: [`hris-and-payroll.md#payroll-periods`](../modules/hris-and-payroll.md#payroll-periods).

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> LOCKED: finance/HR admin lock
    LOCKED --> EXPORTED: CSV export triggered
    LOCKED --> DRAFT: HR admin unlock (audited)
    EXPORTED --> DRAFT: HR admin unlock (edge case)
```

Setelah `LOCKED`, timesheet dan HR requests di rentang period **tidak
bisa diedit**. Unlock hanya oleh HR Admin dengan audit trail wajib.

---

## Client Portal User

Modul: [`clients-and-portal.md#tables`](../modules/clients-and-portal.md#tables).

```mermaid
stateDiagram-v2
    [*] --> PENDING_ACTIVATION: admin invite
    PENDING_ACTIVATION --> ACTIVE: user completes force-change-password
    ACTIVE --> DISABLED: admin disable
    ACTIVE --> PENDING_ACTIVATION: admin reset password
    DISABLED --> ACTIVE: admin re-enable
    DISABLED --> [*]: (no purge — retention via cron)
```

**Force-change-password** ditegakkan di `requirePortalSession()`
guard — user `PENDING_ACTIVATION` diredirect ke `/portal/change-password`
sampai mereka set password sendiri.

---

## Where to look next

- Approval chain thresholds untuk masing-masing: [`../product/approval-workflows.md`](../product/approval-workflows.md).
- Detail per modul: [`../modules/`](../modules/).
- Kode helper state machine: `src/lib/{module}/state.ts` + `*.test.ts`.
