-- ControlDesk — 0022_projects_gas_align.sql
-- Fase 0 slice 2 — align `public.projects` with the GAS ERP contract shape
-- and add the weight-based milestone tracker (rules §6, §7, GAS §Milestones).
--
-- Additive-only changes:
--   1. Add `project_type` enum (FixedPrice / TimeMaterial / Retainer / Internal)
--   2. Add `project_number` (PRJ-YYYY-NNNN, human-friendly, tenant-scoped)
--   3. Add `progress` (0-100, denormalized rollup of milestone weights)
--   4. New table `project_milestones` — weight-based deliverable tracker.
--
-- Existing rows are backfilled with `project_type = 'Internal'` and
-- `project_number` generated from `code`. RLS policies mirror
-- `public.projects` — tenant-scoped read for authenticated, ops-role write.
--
-- Rollback:
--   drop table if exists public.project_milestones;
--   alter table public.projects
--     drop column if exists project_type,
--     drop column if exists project_number,
--     drop column if exists progress;
--   drop type if exists public.project_type;
--   drop type if exists public.milestone_status;

-- ---------------------------------------------------------------------------
-- 1. Enums.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_type') then
    create type public.project_type as enum (
      'FIXED_PRICE',
      'TIME_MATERIAL',
      'RETAINER',
      'INTERNAL'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'milestone_status') then
    create type public.milestone_status as enum (
      'PLANNED',
      'IN_PROGRESS',
      'AT_RISK',
      'DONE',
      'CANCELLED'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Extend `projects` (additive columns).
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists project_type public.project_type not null default 'INTERNAL',
  add column if not exists project_number text,
  add column if not exists progress numeric(5, 2) not null default 0
    check (progress >= 0 and progress <= 100);

comment on column public.projects.project_type is
  'Contract model (rules §6 GAS align). FIXED_PRICE and RETAINER settle on milestones; TIME_MATERIAL settles on timesheets; INTERNAL is not client-billable.';
comment on column public.projects.project_number is
  'Human-friendly identifier (format PRJ-YYYY-NNNN). Unique per tenant. `code` remains the machine-friendly short code.';
comment on column public.projects.progress is
  'Denormalized rollup of `project_milestones.weight` where `status = DONE`, in 0-100. Refreshed by trigger below.';

-- Backfill legacy rows with a deterministic project_number derived from `code`
-- and creation year. New inserts must supply their own value or use the helper
-- exposed via app code (`generateProjectNumber()` — Fase 1).
update public.projects
   set project_number = 'PRJ-' || to_char(created_at, 'YYYY') || '-' || upper(substring(code from 1 for 4))
 where project_number is null;

create unique index if not exists projects_tenant_project_number_uniq
  on public.projects (tenant_id, project_number)
  where project_number is not null;

-- ---------------------------------------------------------------------------
-- 3. `project_milestones` — weight-based deliverable tracker.
--
-- Design notes (GAS §Milestones):
--   - `weight` is stored as basis points (0-10000) so 25.50% = 2550. Avoids
--     float rounding when summing across many rows.
--   - Sum of weights per project should equal 10000 when the plan is
--     complete; the app enforces this at submission time.
--   - `status = DONE` contributes its full weight to
--     `projects.progress`; `IN_PROGRESS` contributes 0 (we only count
--     completed weight, GAS-aligned).
-- ---------------------------------------------------------------------------
create table if not exists public.project_milestones (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  project_id            uuid not null references public.projects(id) on delete cascade,
  seq                   integer not null,
  name                  text not null,
  description           text,
  weight_bps            integer not null check (weight_bps > 0 and weight_bps <= 10000),
  planned_start_date    date,
  planned_end_date      date,
  actual_start_date     date,
  actual_end_date       date,
  status                public.milestone_status not null default 'PLANNED',
  owner_employee_id     uuid references public.employees(id) on delete set null,
  created_by            uuid references public.employees(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint project_milestones_name_not_blank check (length(trim(name)) > 0),
  constraint project_milestones_dates_ok check (
    planned_end_date is null or planned_start_date is null
      or planned_end_date >= planned_start_date
  ),
  constraint project_milestones_actual_dates_ok check (
    actual_end_date is null or actual_start_date is null
      or actual_end_date >= actual_start_date
  )
);

comment on table public.project_milestones is
  'Weight-based milestone tracker per project (rules §6 GAS align). Sum(weight_bps) should equal 10000 when the plan is complete. `weight_bps` is basis points to avoid float rounding.';

create unique index if not exists project_milestones_tenant_project_seq_uniq
  on public.project_milestones (tenant_id, project_id, seq);
create index if not exists project_milestones_tenant_project_status_idx
  on public.project_milestones (tenant_id, project_id, status);

drop trigger if exists project_milestones_set_updated_at on public.project_milestones;
create trigger project_milestones_set_updated_at
  before update on public.project_milestones
  for each row execute function public.set_updated_at();

alter table public.project_milestones enable row level security;

-- Read: any authenticated user in the tenant.
drop policy if exists project_milestones_tenant_read on public.project_milestones;
create policy project_milestones_tenant_read
  on public.project_milestones
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- Insert / update / delete: PM / OM / DIRECTOR / ADMIN (canonical) or their
-- legacy equivalents. We express this via the canonical helper so the policy
-- stays stable across the enum swap.
drop policy if exists project_milestones_ops_write on public.project_milestones;
create policy project_milestones_ops_write
  on public.project_milestones
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('PM', 'OM', 'DIRECTOR', 'ADMIN')
  );

drop policy if exists project_milestones_ops_update on public.project_milestones;
create policy project_milestones_ops_update
  on public.project_milestones
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('PM', 'OM', 'DIRECTOR', 'ADMIN')
  )
  with check (tenant_id = public.current_tenant_id());

drop policy if exists project_milestones_ops_delete on public.project_milestones;
create policy project_milestones_ops_delete
  on public.project_milestones
  for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('OM', 'DIRECTOR', 'ADMIN')
  );

-- ---------------------------------------------------------------------------
-- 4. Trigger — refresh `projects.progress` when a milestone changes status
--    or weight.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_project_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_progress   numeric(5, 2);
begin
  v_project_id := coalesce(new.project_id, old.project_id);

  select coalesce(sum(weight_bps) filter (where status = 'DONE'), 0)::numeric / 100.0
    into v_progress
    from public.project_milestones
   where project_id = v_project_id;

  update public.projects
     set progress = least(100, greatest(0, v_progress))
   where id = v_project_id;

  return null;
end;
$$;

comment on function public.refresh_project_progress() is
  'Rollup trigger: refreshes `projects.progress` (0-100) as sum(weight_bps where DONE) / 100.';

drop trigger if exists project_milestones_progress_refresh on public.project_milestones;
create trigger project_milestones_progress_refresh
  after insert or update or delete on public.project_milestones
  for each row execute function public.refresh_project_progress();
