-- ControlDesk — 0015_shifts_roster_timesheets_payroll.sql
-- Roster (rules §12) + Timesheets + Payroll (rules §14).
--
-- New tables:
--   work_shifts        — shift definitions per tenant (day/night/rotating)
--   employee_rosters   — planned assignment of employee to (date, shift, project)
--   timesheets         — actual hours worked, with clock in/out and approval flow
--   payroll_periods    — one row per (year, month) per tenant
--   payroll_lines      — computed monthly line per employee
--
-- Also extends `employees` with compensation columns needed for real-time
-- gross margin calc (rules §14).
--
-- Rollback:
--   drop table if exists public.payroll_lines;
--   drop table if exists public.payroll_periods;
--   drop table if exists public.timesheets;
--   drop table if exists public.employee_rosters;
--   drop table if exists public.work_shifts;
--   drop type  if exists public.timesheet_status;
--   drop type  if exists public.payroll_period_status;
--   alter table public.employees drop column if exists monthly_salary;
--   alter table public.employees drop column if exists hourly_rate;
--   alter table public.employees drop column if exists bank_account_number;

-- ---------------------------------------------------------------------------
-- 0. Extend employees with compensation columns (rules §14).
--    IDR values; encryption (§3) is applied at the application boundary.
-- ---------------------------------------------------------------------------
alter table public.employees
  add column if not exists monthly_salary numeric(18,2) not null default 0,
  add column if not exists hourly_rate numeric(18,2) not null default 0,
  add column if not exists bank_account_number text;

comment on column public.employees.monthly_salary is
  'IDR monthly base salary. Used by payroll aggregation (rules §14).';
comment on column public.employees.hourly_rate is
  'IDR per hour used to compute direct labour cost from timesheets (rules §14).';
comment on column public.employees.bank_account_number is
  'Encrypted at rest by application layer using APP_ENCRYPTION_KEY (rules §3).';

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'timesheet_status') then
    create type public.timesheet_status as enum (
      'DRAFT',
      'SUBMITTED',
      'APPROVED',
      'REJECTED'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'payroll_period_status') then
    create type public.payroll_period_status as enum (
      'DRAFT',
      'FINALIZED'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. work_shifts
-- ---------------------------------------------------------------------------
create table if not exists public.work_shifts (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  code                text not null,
  name                text not null,
  start_time          time not null,
  end_time            time not null,
  -- Precomputed duration; crossing midnight is fine because we store `interval`.
  duration            interval not null,
  shift_allowance     numeric(18,2) not null default 0,
  is_night            boolean not null default false,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint work_shifts_code_unique unique (tenant_id, code),
  constraint work_shifts_duration_positive check (duration > interval '0'),
  constraint work_shifts_code_not_blank check (length(trim(code)) > 0)
);

comment on table public.work_shifts is
  'Shift definitions per tenant. Business time uses interval (rules §18).';

create index if not exists work_shifts_tenant_idx on public.work_shifts (tenant_id, is_active);

drop trigger if exists work_shifts_set_updated_at on public.work_shifts;
create trigger work_shifts_set_updated_at
  before update on public.work_shifts
  for each row execute function public.set_updated_at();

alter table public.work_shifts enable row level security;

drop policy if exists work_shifts_tenant_read on public.work_shifts;
create policy work_shifts_tenant_read
  on public.work_shifts
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists work_shifts_admin_write on public.work_shifts;
create policy work_shifts_admin_write
  on public.work_shifts
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'HR_ADMIN', 'TENANT_ADMIN', 'GENERAL_MANAGER', 'HEAD_MANAGER', 'OPERATIONS_MANAGER'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. employee_rosters (planned assignment)
-- ---------------------------------------------------------------------------
create table if not exists public.employee_rosters (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  employee_id         uuid not null references public.employees(id) on delete restrict,
  shift_id            uuid not null references public.work_shifts(id) on delete restrict,
  project_id          uuid references public.projects(id) on delete set null,
  work_date           date not null,
  status              text not null default 'PLANNED', -- PLANNED | LEAVE | SICK | OFF
  notes               text,
  created_by          uuid references public.employees(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint employee_rosters_one_per_day unique (tenant_id, employee_id, work_date)
);

comment on table public.employee_rosters is
  'Planned shift assignment per employee per day. One row per (employee, date) (rules §12/§14).';

create index if not exists employee_rosters_tenant_date_idx
  on public.employee_rosters (tenant_id, work_date);
create index if not exists employee_rosters_project_date_idx
  on public.employee_rosters (project_id, work_date);

drop trigger if exists employee_rosters_set_updated_at on public.employee_rosters;
create trigger employee_rosters_set_updated_at
  before update on public.employee_rosters
  for each row execute function public.set_updated_at();

alter table public.employee_rosters enable row level security;

drop policy if exists employee_rosters_tenant_read on public.employee_rosters;
create policy employee_rosters_tenant_read
  on public.employee_rosters
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists employee_rosters_admin_write on public.employee_rosters;
create policy employee_rosters_admin_write
  on public.employee_rosters
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'HR_ADMIN', 'TENANT_ADMIN', 'GENERAL_MANAGER', 'HEAD_MANAGER',
      'OPERATIONS_MANAGER', 'PROJECT_MANAGER', 'SUPERVISOR'
    )
  );

-- ---------------------------------------------------------------------------
-- 4. timesheets (actual hours)
-- ---------------------------------------------------------------------------
create table if not exists public.timesheets (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  employee_id         uuid not null references public.employees(id) on delete restrict,
  project_id          uuid references public.projects(id) on delete set null,
  roster_id           uuid references public.employee_rosters(id) on delete set null,
  work_date           date not null,
  clock_in            timestamptz,
  clock_out           timestamptz,
  hours_worked        numeric(6,2) not null default 0,
  hours_overtime      numeric(6,2) not null default 0,
  status              public.timesheet_status not null default 'DRAFT',
  submitted_at        timestamptz,
  approved_at         timestamptz,
  approved_by         uuid references public.employees(id) on delete set null,
  rejection_reason    text,
  notes               text,
  created_by          uuid references public.employees(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint timesheets_one_per_day unique (tenant_id, employee_id, work_date),
  constraint timesheets_hours_non_negative check (
    hours_worked >= 0 and hours_overtime >= 0 and hours_worked <= 24
  ),
  constraint timesheets_clock_pair check (
    (clock_in is null and clock_out is null) or
    (clock_in is not null and clock_out is not null and clock_out > clock_in)
  )
);

comment on table public.timesheets is
  'Actual hours worked per employee per day. Feeds direct labour cost (rules §14).';

create index if not exists timesheets_tenant_date_idx
  on public.timesheets (tenant_id, work_date);
create index if not exists timesheets_project_date_idx
  on public.timesheets (project_id, work_date);
create index if not exists timesheets_status_idx
  on public.timesheets (tenant_id, status);

drop trigger if exists timesheets_set_updated_at on public.timesheets;
create trigger timesheets_set_updated_at
  before update on public.timesheets
  for each row execute function public.set_updated_at();

alter table public.timesheets enable row level security;

drop policy if exists timesheets_tenant_read on public.timesheets;
create policy timesheets_tenant_read
  on public.timesheets
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists timesheets_tenant_write on public.timesheets;
create policy timesheets_tenant_write
  on public.timesheets
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- 5. payroll_periods
-- ---------------------------------------------------------------------------
create table if not exists public.payroll_periods (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  period_year         integer not null,
  period_month        integer not null check (period_month between 1 and 12),
  status              public.payroll_period_status not null default 'DRAFT',
  generated_by        uuid references public.employees(id) on delete set null,
  finalized_by        uuid references public.employees(id) on delete set null,
  finalized_at        timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint payroll_periods_unique unique (tenant_id, period_year, period_month)
);

comment on table public.payroll_periods is
  'One row per calendar month, per tenant. Rules §14 payroll aggregation.';

drop trigger if exists payroll_periods_set_updated_at on public.payroll_periods;
create trigger payroll_periods_set_updated_at
  before update on public.payroll_periods
  for each row execute function public.set_updated_at();

alter table public.payroll_periods enable row level security;

drop policy if exists payroll_periods_tenant_read on public.payroll_periods;
create policy payroll_periods_tenant_read
  on public.payroll_periods
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists payroll_periods_hr_finance_write on public.payroll_periods;
create policy payroll_periods_hr_finance_write
  on public.payroll_periods
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'HR_ADMIN', 'LEAD_FINANCE', 'TENANT_ADMIN', 'GENERAL_MANAGER'
    )
  );

-- ---------------------------------------------------------------------------
-- 6. payroll_lines
-- ---------------------------------------------------------------------------
create table if not exists public.payroll_lines (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  period_id           uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id         uuid not null references public.employees(id) on delete restrict,
  base_salary         numeric(18,2) not null default 0,
  hours_worked        numeric(8,2) not null default 0,
  hours_overtime      numeric(8,2) not null default 0,
  overtime_pay        numeric(18,2) not null default 0,
  shift_allowance     numeric(18,2) not null default 0,
  gross_pay           numeric(18,2) not null default 0,
  deductions          numeric(18,2) not null default 0,
  net_pay             numeric(18,2) not null default 0,
  created_at          timestamptz not null default now(),
  constraint payroll_lines_unique_employee unique (period_id, employee_id)
);

comment on table public.payroll_lines is
  'Per-employee snapshot for a payroll period. Anonymised when employee is terminated (rules §22).';

create index if not exists payroll_lines_period_idx
  on public.payroll_lines (tenant_id, period_id);

alter table public.payroll_lines enable row level security;

drop policy if exists payroll_lines_tenant_read on public.payroll_lines;
create policy payroll_lines_tenant_read
  on public.payroll_lines
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists payroll_lines_hr_finance_write on public.payroll_lines;
create policy payroll_lines_hr_finance_write
  on public.payroll_lines
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'HR_ADMIN', 'LEAD_FINANCE', 'TENANT_ADMIN', 'GENERAL_MANAGER'
    )
  );

-- ---------------------------------------------------------------------------
-- 7. compute_project_direct_labour(project_id, from_date, to_date)
--    Real-time direct labour cost for a project window (rules §14).
--    = sum(timesheets.hours_worked * employees.hourly_rate)
--    + sum(timesheets.hours_overtime * employees.hourly_rate * 1.5)
--    + sum(shift_allowance for rostered days)
-- ---------------------------------------------------------------------------
create or replace function public.compute_project_direct_labour(
  p_project_id uuid,
  p_from_date  date,
  p_to_date    date
) returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      t.hours_worked   * e.hourly_rate           as base_pay,
      t.hours_overtime * e.hourly_rate * 1.5     as ot_pay
    from public.timesheets t
    join public.employees  e on e.id = t.employee_id
    where t.tenant_id  = public.current_tenant_id()
      and t.project_id = p_project_id
      and t.work_date between p_from_date and p_to_date
      and t.status     = 'APPROVED'
  ),
  allowances as (
    select coalesce(sum(ws.shift_allowance), 0) as sa
    from public.employee_rosters r
    join public.work_shifts       ws on ws.id = r.shift_id
    where r.tenant_id  = public.current_tenant_id()
      and r.project_id = p_project_id
      and r.work_date between p_from_date and p_to_date
      and r.status     = 'PLANNED'
  )
  select
    coalesce((select sum(base_pay + ot_pay) from base), 0)
      + coalesce((select sa from allowances), 0);
$$;

comment on function public.compute_project_direct_labour is
  'Real-time direct labour cost for a project window (rules §14). Uses APPROVED timesheets + PLANNED rosters.';

grant execute on function public.compute_project_direct_labour(uuid, date, date)
  to authenticated;
