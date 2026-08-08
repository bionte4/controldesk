-- ---------------------------------------------------------------------------
-- 0034_employees_extended.sql
--
-- Extends `employees` with the HR directory attributes required by rules §6
-- (people directory) + §12 (contract expiry reminders):
--
--   * split `full_name` into `first_name` + `last_name`
--   * new columns: `phone`, `department`, `position_title`, `date_of_birth`,
--     `join_date` (default = today), `employment_type` (enum),
--     `contract_end_date`, `availability` (enum)
--   * tenants gain `retirement_age` (default 55, statutory pensiun) — drives
--     the auto-computed contract_end_date for PERMANENT staff.
--   * `user_id` becomes NULLABLE: HR admin can add employees before they
--     activate an auth account. Registration flow will link `user_id` later.
--   * BEFORE trigger auto-fills `contract_end_date` for PERMANENT rows that
--     supply a `date_of_birth` but leave the end date blank
--     (end = date_of_birth + retirement_age years).
--   * CHECK constraint: non-PERMANENT rows MUST supply `contract_end_date`.
--   * Adds `EMPLOYEE_CONTRACT_EXPIRING` notification kind for reminder cron.
--
-- Rollback (append manually):
--   drop trigger if exists employees_derive_contract_end_date on public.employees;
--   drop function if exists public.employees_derive_contract_end_date();
--   alter table public.employees
--     drop constraint if exists employees_dates_ok,
--     drop constraint if exists employees_contract_end_required,
--     drop column if exists first_name,
--     drop column if exists last_name,
--     drop column if exists phone,
--     drop column if exists department,
--     drop column if exists position_title,
--     drop column if exists date_of_birth,
--     drop column if exists join_date,
--     drop column if exists employment_type,
--     drop column if exists contract_end_date,
--     drop column if exists availability;
--   alter table public.employees alter column user_id set not null;
--   alter table public.tenants drop column if exists retirement_age;
--   drop type if exists public.employment_type;
--   drop type if exists public.employee_availability;
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'employment_type') then
    create type public.employment_type as enum (
      'PERMANENT',
      'CONTRACT',
      'PROBATION',
      'INTERN',
      'OUTSOURCE',
      'OUTTASK'
    );
  end if;
  if not exists (
    select 1 from pg_type where typname = 'employee_availability'
  ) then
    create type public.employee_availability as enum (
      'AVAILABLE',
      'ASSIGNED',
      'ON_LEAVE',
      'INACTIVE'
    );
  end if;
end $$;

comment on type public.employment_type is
  'HR contract classification. Non-PERMANENT types require a fixed contract_end_date; PERMANENT rows derive it from date_of_birth + tenants.retirement_age.';

comment on type public.employee_availability is
  'Operational availability signal displayed in the roster and assignment engines.';

-- ---------------------------------------------------------------------------
-- 2. Extend notification_kind with contract-expiry alert (rules §12 + §20)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'notification_kind'
       and e.enumlabel = 'EMPLOYEE_CONTRACT_EXPIRING'
  ) then
    alter type public.notification_kind
      add value 'EMPLOYEE_CONTRACT_EXPIRING';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Tenant retirement age
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists retirement_age smallint not null default 55;

alter table public.tenants
  drop constraint if exists tenants_retirement_age_ok;
alter table public.tenants
  add constraint tenants_retirement_age_ok
    check (retirement_age between 40 and 75);

comment on column public.tenants.retirement_age is
  'Statutory retirement age. Used to auto-fill contract_end_date for PERMANENT employees from date_of_birth.';

-- ---------------------------------------------------------------------------
-- 4. Employees — new columns
-- ---------------------------------------------------------------------------
alter table public.employees
  alter column user_id drop not null;

alter table public.employees
  add column if not exists first_name        text,
  add column if not exists last_name         text,
  add column if not exists phone             text,
  add column if not exists department        text,
  add column if not exists position_title    text,
  add column if not exists date_of_birth     date,
  add column if not exists join_date         date not null default current_date,
  add column if not exists employment_type   public.employment_type not null default 'PERMANENT',
  add column if not exists contract_end_date date,
  add column if not exists availability      public.employee_availability not null default 'AVAILABLE';

comment on column public.employees.first_name is
  'Given name. Combined with last_name to reconstruct full_name; full_name remains the display column.';
comment on column public.employees.last_name is
  'Family name. Optional for single-name employees.';
comment on column public.employees.department is
  'HR department (Operations, Finance, HR, ...). Free-text for phase-1; a dedicated departments table may replace this in the future.';
comment on column public.employees.position_title is
  'HR position / job title (Analyst, Team Lead, ...). Distinct from RBAC role.';
comment on column public.employees.date_of_birth is
  'Only required for PERMANENT employees if the tenant wants the retirement-based contract_end_date auto-computed.';
comment on column public.employees.join_date is
  'Contract start date. Anchors seniority, contract expiry, and payroll pro-rating.';
comment on column public.employees.employment_type is
  'Contract classification. See public.employment_type enum.';
comment on column public.employees.contract_end_date is
  'Contract end date. Required for CONTRACT/PROBATION/INTERN/OUTSOURCE/OUTTASK; auto-derived from date_of_birth + tenants.retirement_age for PERMANENT when left blank.';
comment on column public.employees.availability is
  'Operational availability flag. Updated by roster / leave systems; HR admin can override.';

-- ---------------------------------------------------------------------------
-- 5. Backfill first_name / last_name from existing full_name
-- ---------------------------------------------------------------------------
update public.employees
   set first_name = coalesce(
         nullif(trim(split_part(full_name, ' ', 1)), ''),
         full_name
       ),
       last_name = case
         when position(' ' in full_name) > 0
         then nullif(
           trim(substr(full_name, position(' ' in full_name) + 1)),
           ''
         )
         else null
       end
 where first_name is null;

-- ---------------------------------------------------------------------------
-- 6. Constraints
-- ---------------------------------------------------------------------------
alter table public.employees
  drop constraint if exists employees_contract_end_required;
alter table public.employees
  add constraint employees_contract_end_required check (
    employment_type = 'PERMANENT' or contract_end_date is not null
  );

alter table public.employees
  drop constraint if exists employees_dates_ok;
alter table public.employees
  add constraint employees_dates_ok check (
    contract_end_date is null or contract_end_date >= join_date
  );

-- ---------------------------------------------------------------------------
-- 7. Trigger — auto-derive contract_end_date for PERMANENT rows
-- ---------------------------------------------------------------------------
create or replace function public.employees_derive_contract_end_date()
returns trigger
language plpgsql
as $$
declare
  v_retirement_age smallint;
begin
  if new.employment_type = 'PERMANENT'
     and new.contract_end_date is null
     and new.date_of_birth is not null
  then
    select retirement_age
      into v_retirement_age
      from public.tenants
     where id = new.tenant_id;

    if v_retirement_age is null then
      v_retirement_age := 55;
    end if;

    new.contract_end_date :=
      (new.date_of_birth + make_interval(years => v_retirement_age::int))::date;
  end if;
  return new;
end;
$$;

drop trigger if exists employees_derive_contract_end_date on public.employees;
create trigger employees_derive_contract_end_date
  before insert or update on public.employees
  for each row
  execute function public.employees_derive_contract_end_date();

-- ---------------------------------------------------------------------------
-- 8. Indexes for the contract-expiry sweeper cron
-- ---------------------------------------------------------------------------
create index if not exists employees_tenant_contract_end_idx
  on public.employees (tenant_id, contract_end_date)
  where contract_end_date is not null
    and employment_type <> 'PERMANENT';

create index if not exists employees_tenant_type_idx
  on public.employees (tenant_id, employment_type);

commit;
