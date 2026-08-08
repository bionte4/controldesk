-- =============================================================================
-- 0043 — Extend assignment tables with role & notes for the unified
--         Assignments UI (rules §7). Also fixes the legacy allocation
--         capacity trigger to scope on (tenant_id, employee_id) for parity
--         with 0026_project_assignments_gas.sql.
-- =============================================================================
--
-- Rollback:
--   drop trigger if exists pea_alloc_capacity_check on public.project_employee_assignments;
--   drop function if exists public.check_employee_allocation_capacity();
--   alter table public.project_employee_assignments drop column if exists role;
--   alter table public.project_employee_assignments drop column if exists notes;
--   alter table public.project_pm_assignments drop column if exists notes;
--   drop type if exists public.project_member_role;
--
--   -- Re-run 0008's original trigger definition if you need the old
--   -- behaviour back.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. project_member_role enum — role played by a non-PM member on a project.
--    PM roles remain in project_pm_assignments.assignment_role
--    (PRIMARY_PM / CO_PM).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_member_role') then
    create type public.project_member_role as enum (
      'MEMBER',
      'TECH_LEAD',
      'DEVELOPER',
      'ENGINEER',
      'QA',
      'DESIGNER',
      'DEVOPS',
      'CONSULTANT',
      'SUPPORT',
      'SITE_SUPERVISOR'
    );
  end if;
end$$;

comment on type public.project_member_role is
  'Non-PM member role on a project (rules §7). PM roles live in project_pm_assignments.';

-- ---------------------------------------------------------------------------
-- 2. Extend project_employee_assignments with role + notes.
--    role defaults to MEMBER for backward compatibility with existing rows.
-- ---------------------------------------------------------------------------
alter table public.project_employee_assignments
  add column if not exists role  public.project_member_role not null default 'MEMBER',
  add column if not exists notes text;

comment on column public.project_employee_assignments.role is
  'Role the employee plays on the project (rules §7).';

-- Rebuild the (employee, project) active-uniqueness index to include role,
-- allowing the same employee to hold two active roles on one project (e.g.
-- QA + DEVELOPER during a transition period). Drop the old constraint first.
drop index if exists public.pea_active_per_employee_project;

create unique index if not exists pea_active_per_employee_project_role
  on public.project_employee_assignments (employee_id, project_id, role)
  where status = 'ACTIVE';

comment on index public.pea_active_per_employee_project_role is
  'One ACTIVE row per (employee, project, role). Editing requires ending the previous row.';

-- ---------------------------------------------------------------------------
-- 3. Extend project_pm_assignments with notes (role, dates already covered).
-- ---------------------------------------------------------------------------
alter table public.project_pm_assignments
  add column if not exists notes text;

-- ---------------------------------------------------------------------------
-- 4. Fix the legacy allocation-capacity trigger to scope on
--    (tenant_id, employee_id) instead of employee_id alone. Behaviour is
--    unchanged in practice (employee UUIDs are globally unique today), but
--    this brings the legacy pair in line with the 0026 GAS-aligned trigger.
-- ---------------------------------------------------------------------------
create or replace function public.check_employee_allocation_capacity()
returns trigger
language plpgsql
as $$
declare
  v_total smallint;
begin
  if new.status <> 'ACTIVE' then
    return new;
  end if;

  select coalesce(sum(allocation_percentage), 0)::smallint into v_total
  from public.project_employee_assignments
  where tenant_id = new.tenant_id
    and employee_id = new.employee_id
    and status = 'ACTIVE'
    and (tg_op = 'INSERT' or id <> new.id);

  if (v_total + new.allocation_percentage) > 100 then
    raise exception '%', format(
      'ALLOCATION_OVER_CAP:%s:%s:%s',
      new.employee_id, v_total, new.allocation_percentage
    )
    using errcode = '23514';  -- check_violation
  end if;

  return new;
end;
$$;

-- Machine-parseable exception format (`ALLOCATION_OVER_CAP:<uuid>:<current>:<new>`)
-- lets Server Actions parse the trigger error and surface a friendly,
-- localised message via the ActionResult contract (rules §17).

drop trigger if exists pea_alloc_capacity_check on public.project_employee_assignments;
create trigger pea_alloc_capacity_check
  before insert or update on public.project_employee_assignments
  for each row execute function public.check_employee_allocation_capacity();

-- ---------------------------------------------------------------------------
-- 5. Convenience view — aggregated workload per employee (used by the
--    Assignments/Workload tab).
-- ---------------------------------------------------------------------------
create or replace view public.v_employee_workload as
select
  e.tenant_id,
  e.id                                            as employee_id,
  e.full_name,
  e.role                                          as employee_role,
  coalesce(sum(a.allocation_percentage), 0)::int  as total_alloc_pct,
  greatest(0, 100 - coalesce(sum(a.allocation_percentage), 0))::int
                                                  as remaining_pct,
  count(a.id) filter (where a.status = 'ACTIVE')  as active_assignments
from public.employees e
left join public.project_employee_assignments a
  on a.employee_id = e.id
 and a.tenant_id   = e.tenant_id
 and a.status      = 'ACTIVE'
group by e.tenant_id, e.id, e.full_name, e.role;

comment on view public.v_employee_workload is
  'Per-employee aggregated allocation % across ACTIVE assignments (rules §7).';

grant select on public.v_employee_workload to authenticated;
