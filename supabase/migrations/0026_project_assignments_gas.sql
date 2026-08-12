-- ControlDesk — 0026_project_assignments_gas.sql
-- Fase 0 slice 5 — GAS-aligned project assignments with 11-role enum
-- (rules §7 · GAS Resource Assignment Engine).
--
-- The legacy schema has two separate tables:
--   - `project_pm_assignments`         (PRIMARY_PM / CO_PM)
--   - `project_employee_assignments`   (percentage-only, no role code)
-- GAS collapses them into one `project_assignments` with an 11-value role
-- enum spanning software delivery archetypes (PM/OM/TechLead/Developer/…).
--
-- We add the new table ADDITIVELY. Legacy tables remain untouched — they'll
-- be deprecated in a future slice once the Fase 1+ modules migrate away.
--
-- Rollback:
--   drop table if exists public.project_assignments;
--   drop type if exists public.project_assignment_role;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_assignment_role') then
    create type public.project_assignment_role as enum (
      'PM',
      'OM',
      'SITE_SUPERVISOR',
      'TECH_LEAD',
      'DEVELOPER',
      'ENGINEER',
      'QA',
      'DESIGNER',
      'DEVOPS',
      'CONSULTANT',
      'SUPPORT'
    );
  end if;
end $$;

comment on type public.project_assignment_role is
  'GAS-aligned assignment archetypes (rules §7). Distinct from `employee_role` which is org-wide; `project_assignment_role` describes the role within ONE project.';

create table if not exists public.project_assignments (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  project_id               uuid not null references public.projects(id) on delete cascade,
  employee_id              uuid not null references public.employees(id) on delete cascade,
  role                     public.project_assignment_role not null,
  allocation_percentage    numeric(5, 2) not null default 100
    check (allocation_percentage > 0 and allocation_percentage <= 100),
  started_at               date not null default current_date,
  ended_at                 date,
  status                   public.assignment_status not null default 'ACTIVE',
  is_primary               boolean not null default false,
  notes                    text,
  created_by               uuid references public.employees(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint project_assignments_date_order_ck check (
    ended_at is null or ended_at >= started_at
  )
);

comment on table public.project_assignments is
  'GAS-aligned unified project assignments (rules §7). Supersedes `project_pm_assignments` + `project_employee_assignments`; legacy tables stay until Fase 1+ modules migrate.';

create unique index if not exists project_assignments_active_unique_role_person
  on public.project_assignments (tenant_id, project_id, employee_id, role)
  where status = 'ACTIVE';
create index if not exists project_assignments_tenant_project_status_idx
  on public.project_assignments (tenant_id, project_id, status);
create index if not exists project_assignments_tenant_employee_status_idx
  on public.project_assignments (tenant_id, employee_id, status);
-- Only ONE primary allocation per (project, role) can exist at a time.
create unique index if not exists project_assignments_primary_uniq
  on public.project_assignments (tenant_id, project_id, role)
  where is_primary and status = 'ACTIVE';

drop trigger if exists project_assignments_set_updated_at on public.project_assignments;
create trigger project_assignments_set_updated_at
  before update on public.project_assignments
  for each row execute function public.set_updated_at();

alter table public.project_assignments enable row level security;

drop policy if exists project_assignments_tenant_read on public.project_assignments;
create policy project_assignments_tenant_read
  on public.project_assignments
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists project_assignments_authors_write on public.project_assignments;
create policy project_assignments_authors_write
  on public.project_assignments
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('PM', 'OM', 'DIRECTOR', 'ADMIN')
  );

drop policy if exists project_assignments_authors_update on public.project_assignments;
create policy project_assignments_authors_update
  on public.project_assignments
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('PM', 'OM', 'DIRECTOR', 'ADMIN')
  )
  with check (tenant_id = public.current_tenant_id());

drop policy if exists project_assignments_authors_delete on public.project_assignments;
create policy project_assignments_authors_delete
  on public.project_assignments
  for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('OM', 'DIRECTOR', 'ADMIN')
  );

-- ---------------------------------------------------------------------------
-- Guard: total ACTIVE allocation per employee (across all projects & roles)
-- must not exceed 100% at any time (rules §7).
-- ---------------------------------------------------------------------------
create or replace function public.check_project_assignment_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(6, 2);
begin
  -- Only enforce when the row is (or is transitioning to) ACTIVE.
  if new.status <> 'ACTIVE' then
    return new;
  end if;

  select coalesce(sum(allocation_percentage), 0)
    into v_total
    from public.project_assignments
   where tenant_id = new.tenant_id
     and employee_id = new.employee_id
     and status = 'ACTIVE'
     and id <> new.id;

  if v_total + new.allocation_percentage > 100 then
    raise exception 'employee % over-allocated: existing % + new % > 100',
      new.employee_id, v_total, new.allocation_percentage
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.check_project_assignment_capacity() is
  'Enforces rules §7: sum of ACTIVE allocation_percentage per employee ≤ 100 across all projects/roles.';

drop trigger if exists project_assignments_capacity_check on public.project_assignments;
create trigger project_assignments_capacity_check
  before insert or update on public.project_assignments
  for each row execute function public.check_project_assignment_capacity();
