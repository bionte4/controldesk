-- ControlDesk — 0036_projects_wizard_fields.sql
-- Extends `projects` to support the 3-step wizard UI (rules §7).
--
-- Additions:
--   1. `project_priority` enum (CRITICAL / HIGH / MEDIUM / LOW) — feeds
--      default severity for `project_issues` in this project, driving the
--      business-hours SLA (1h / 4h / 8h / 24h; see migration 0029).
--   2. Extends `project_status` enum with `DRAFT` (pre-planning stage) —
--      lets teams save unfinished project intake without committing them
--      to PLANNING.
--   3. New columns on `projects`:
--        - priority          → project_priority (default MEDIUM)
--        - location          → text (city / site / "Remote")
--        - contract_value    → numeric(18,2) (total contract value in IDR;
--                              separate from bpo_contracts.mrr_amount which
--                              is monthly recurring)
--        - currency          → char(3) default 'IDR'
--        - notes             → text (wizard step 2, separate from
--                              `description` in step 1)
--        - sync_calendar     → boolean default false (persist toggle;
--                              actual Google Calendar sync is a follow-up
--                              feature; currently the flag is captured for
--                              a future cron/publisher).
--   4. `project_numbering_sequence` table + trigger to auto-generate
--      `project_number` as `PRJ-{YYYY}-{seq:04}` per tenant per year.
--
-- Rollback:
--   alter table public.projects
--     drop column if exists priority,
--     drop column if exists location,
--     drop column if exists contract_value,
--     drop column if exists currency,
--     drop column if exists notes,
--     drop column if exists sync_calendar;
--   drop type if exists public.project_priority;
--   drop trigger if exists projects_auto_number on public.projects;
--   drop function if exists public.auto_generate_project_number();
--   drop table if exists public.project_numbering_sequence;

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_priority') then
    create type public.project_priority as enum (
      'CRITICAL',   -- inherits 1h SLA on new issues
      'HIGH',       -- 4h
      'MEDIUM',     -- 8h (default)
      'LOW'         -- 24h
    );
  end if;
end $$;

-- Add DRAFT to project_status (Postgres enum values are append-only).
do $$
begin
  if not exists (
    select 1
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
     where t.typname = 'project_status'
       and e.enumlabel = 'DRAFT'
  ) then
    alter type public.project_status add value 'DRAFT' before 'PLANNING';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Extend `projects` (all additive, nullable / with defaults)
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists priority       public.project_priority not null default 'MEDIUM',
  add column if not exists location       text,
  add column if not exists contract_value numeric(18, 2),
  add column if not exists currency       char(3) not null default 'IDR',
  add column if not exists notes          text,
  add column if not exists sync_calendar  boolean not null default false;

alter table public.projects
  drop constraint if exists projects_contract_value_nonneg,
  add  constraint projects_contract_value_nonneg
    check (contract_value is null or contract_value >= 0);

alter table public.projects
  drop constraint if exists projects_currency_idr,
  add  constraint projects_currency_idr check (currency = 'IDR');

alter table public.projects
  drop constraint if exists projects_location_len,
  add  constraint projects_location_len
    check (location is null or char_length(location) <= 120);

comment on column public.projects.priority is
  'Delivery urgency signal. Feeds the default severity for new project_issues (rules §7 + 0029): CRITICAL=1h SLA, HIGH=4h, MEDIUM=8h, LOW=24h.';
comment on column public.projects.contract_value is
  'Total contract value in IDR (rules §14). Distinct from bpo_contracts.mrr_amount which is monthly recurring.';
comment on column public.projects.sync_calendar is
  'Preference flag: sync this project + milestones to org Google Calendar. Not yet functional — captured for future publisher.';

-- ---------------------------------------------------------------------------
-- 3. Auto-numbering `project_number` (PRJ-YYYY-####, reset per tenant/year)
-- ---------------------------------------------------------------------------
create table if not exists public.project_numbering_sequence (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  year      integer not null,
  last_seq  integer not null default 0,
  primary key (tenant_id, year)
);

comment on table public.project_numbering_sequence is
  'Per-tenant per-year monotonically-increasing counter feeding `projects.project_number`. Row-locked via SELECT ... FOR UPDATE inside the auto-generate trigger to avoid gaps under concurrency.';

alter table public.project_numbering_sequence enable row level security;

drop policy if exists project_numbering_no_direct_access
  on public.project_numbering_sequence;
create policy project_numbering_no_direct_access
  on public.project_numbering_sequence
  for all
  to authenticated
  using (false)
  with check (false);
-- SECURITY DEFINER trigger below bypasses the deny-all policy; only server
-- code (via the trigger) may mutate this table.

create or replace function public.auto_generate_project_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from coalesce(new.start_date, current_date))::int;
  v_seq  integer;
begin
  -- Only assign when caller didn't provide an explicit number. Reserved for
  -- data migrations where legacy numbers must survive.
  if new.project_number is not null and length(trim(new.project_number)) > 0 then
    return new;
  end if;

  insert into public.project_numbering_sequence (tenant_id, year, last_seq)
       values (new.tenant_id, v_year, 1)
  on conflict (tenant_id, year)
  do update set last_seq = public.project_numbering_sequence.last_seq + 1
  returning last_seq into v_seq;

  new.project_number := format('PRJ-%s-%s', v_year, lpad(v_seq::text, 4, '0'));
  return new;
end;
$$;

comment on function public.auto_generate_project_number() is
  'BEFORE INSERT trigger: assigns projects.project_number = PRJ-{YYYY}-{seq:04}. Sequence is per tenant, resets each calendar year, based on start_date (defaults to today when unset).';

drop trigger if exists projects_auto_number on public.projects;
create trigger projects_auto_number
  before insert on public.projects
  for each row execute function public.auto_generate_project_number();

-- ---------------------------------------------------------------------------
-- 4. Indexes for new lookup patterns
-- ---------------------------------------------------------------------------
create index if not exists projects_tenant_priority_idx
  on public.projects (tenant_id, priority);
create index if not exists projects_tenant_end_date_idx
  on public.projects (tenant_id, end_date)
  where end_date is not null;
