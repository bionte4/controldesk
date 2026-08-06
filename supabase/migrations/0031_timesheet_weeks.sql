-- =============================================================================
-- Migration 0031 — Weekly Timesheet packet (Fase 2, GAS §27).
--
-- The existing `public.timesheets` table stores DAILY hours per employee. GAS
-- §27 introduces a WEEKLY submission packet — an employee fills in 7 daily
-- entries and submits the whole week in one go; PM (or Supervisor / HR)
-- approves or rejects the packet as a single unit.
--
-- This migration:
--   1. Introduces `timesheet_weeks` — one row per (employee, ISO-Monday
--      week_start_date) with its own status machine mirroring the existing
--      daily flow (DRAFT → SUBMITTED → APPROVED | REJECTED).
--   2. Adds a nullable `week_id` FK to `public.timesheets` so daily rows can
--      be grouped under a weekly packet. Daily rows without a week keep
--      working unchanged (backwards compatible).
--   3. Adds an append-only `timesheet_week_approval_logs` audit trail
--      mirroring `expense_approval_logs` / `budget_request_approval_logs`.
--
-- State machine (rules §14):
--
--   DRAFT
--     └ SUBMIT  ─► SUBMITTED
--                  ├─ APPROVE ─► APPROVED  (terminal)
--                  └─ REJECT  ─► REJECTED
--   REJECTED
--     └ SUBMIT  ─► SUBMITTED   (resubmit after edits)
--
-- Cascades on APPROVE / REJECT propagate to the individual daily rows so the
-- per-day `status` stays consistent with the packet's status.
--
-- Rollback:
--   drop trigger if exists timesheet_week_approval_logs_immutable
--     on public.timesheet_week_approval_logs;
--   drop function if exists public.timesheet_week_approval_logs_immutable();
--   drop table if exists public.timesheet_week_approval_logs;
--   alter table public.timesheets drop column if exists week_id;
--   drop table if exists public.timesheet_weeks;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. timesheet_weeks — the weekly packet header.
--    We reuse the existing `timesheet_status` enum from migration 0015 so a
--    week and its daily rows share the same status vocabulary.
-- ---------------------------------------------------------------------------
create table if not exists public.timesheet_weeks (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  employee_id         uuid not null references public.employees(id) on delete restrict,
  -- ISO-8601 Monday of the week. App-layer enforces the constraint.
  week_start_date     date not null,
  status              public.timesheet_status not null default 'DRAFT',
  total_hours         numeric(6,2) not null default 0
                        check (total_hours >= 0 and total_hours <= 24 * 7),
  total_overtime      numeric(6,2) not null default 0
                        check (total_overtime >= 0 and total_overtime <= 24 * 7),
  submitted_at        timestamptz,
  approved_at         timestamptz,
  approved_by         uuid references public.employees(id) on delete set null,
  rejected_at         timestamptz,
  rejected_by         uuid references public.employees(id) on delete set null,
  rejection_reason    text,
  notes               text,
  created_by          uuid references public.employees(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint timesheet_weeks_one_per_employee_week
    unique (tenant_id, employee_id, week_start_date),
  constraint timesheet_weeks_approve_stamps_together
    check ((approved_at is null) = (approved_by is null)),
  constraint timesheet_weeks_reject_stamps_together
    check ((rejected_at is null) = (rejected_by is null))
);

comment on table public.timesheet_weeks is
  'GAS §27 weekly timesheet packet. Groups daily rows in `public.timesheets` under one submission for PM approval.';

comment on column public.timesheet_weeks.week_start_date is
  'ISO-8601 Monday. Enforced by application code (schemas + Server Actions).';

create index if not exists timesheet_weeks_tenant_week_idx
  on public.timesheet_weeks (tenant_id, week_start_date desc);

create index if not exists timesheet_weeks_tenant_employee_idx
  on public.timesheet_weeks (tenant_id, employee_id, week_start_date desc);

create index if not exists timesheet_weeks_tenant_status_idx
  on public.timesheet_weeks (tenant_id, status);

-- Approver-inbox partial index (mirrors budget_requests_pending_idx pattern).
create index if not exists timesheet_weeks_pending_idx
  on public.timesheet_weeks (tenant_id, week_start_date desc)
  where status = 'SUBMITTED';

drop trigger if exists timesheet_weeks_set_updated_at on public.timesheet_weeks;
create trigger timesheet_weeks_set_updated_at
  before update on public.timesheet_weeks
  for each row execute function public.set_updated_at();

alter table public.timesheet_weeks enable row level security;

-- SELECT: any tenant employee (approvers, HR, payroll aggregations).
drop policy if exists timesheet_weeks_tenant_read on public.timesheet_weeks;
create policy timesheet_weeks_tenant_read
  on public.timesheet_weeks
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- INSERT: employee themselves OR any privileged writer (Server Action gates
-- via PDP `timesheet.submit`).
drop policy if exists timesheet_weeks_insert on public.timesheet_weeks;
create policy timesheet_weeks_insert
  on public.timesheet_weeks
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

-- UPDATE: any tenant employee — Server Actions enforce role + state gate.
drop policy if exists timesheet_weeks_update on public.timesheet_weeks;
create policy timesheet_weeks_update
  on public.timesheet_weeks
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- DELETE: never — historical weekly packets are preserved even when a week
-- is re-issued with an updated set of daily rows.

-- ---------------------------------------------------------------------------
-- 2. Attach daily timesheets to a weekly packet (nullable — backwards
--    compatible with rows submitted before this migration).
-- ---------------------------------------------------------------------------
alter table public.timesheets
  add column if not exists week_id uuid references public.timesheet_weeks(id)
    on delete set null;

create index if not exists timesheets_week_id_idx
  on public.timesheets (week_id)
  where week_id is not null;

comment on column public.timesheets.week_id is
  'Optional weekly packet this daily row belongs to (GAS §27).';

-- ---------------------------------------------------------------------------
-- 3. timesheet_week_approval_logs — append-only audit trail.
-- ---------------------------------------------------------------------------
create table if not exists public.timesheet_week_approval_logs (
  id                     bigint generated always as identity primary key,
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  week_id                uuid not null references public.timesheet_weeks(id) on delete cascade,
  actor_employee_id      uuid references public.employees(id) on delete set null,
  actor_role             public.employee_role,
  action                 public.approval_action not null,
  from_status            public.timesheet_status not null,
  to_status              public.timesheet_status not null,
  comment                text,
  created_at             timestamptz not null default now()
);

comment on table public.timesheet_week_approval_logs is
  'Append-only history of state transitions on `timesheet_weeks` (rules §9.7).';

create index if not exists tw_al_tenant_week_idx
  on public.timesheet_week_approval_logs (tenant_id, week_id, created_at desc);

create or replace function public.timesheet_week_approval_logs_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'timesheet_week_approval_logs is append-only'
    using errcode = '42501';
end;
$$;

drop trigger if exists timesheet_week_approval_logs_immutable
  on public.timesheet_week_approval_logs;
create trigger timesheet_week_approval_logs_immutable
  before update or delete on public.timesheet_week_approval_logs
  for each row execute function public.timesheet_week_approval_logs_immutable();

alter table public.timesheet_week_approval_logs enable row level security;

drop policy if exists tw_al_tenant_read on public.timesheet_week_approval_logs;
create policy tw_al_tenant_read
  on public.timesheet_week_approval_logs
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists tw_al_tenant_insert on public.timesheet_week_approval_logs;
create policy tw_al_tenant_insert
  on public.timesheet_week_approval_logs
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());
