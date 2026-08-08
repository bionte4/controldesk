-- Migration 0066: Project-scoped work shifts
--
-- Adds `project_id` to `work_shifts` so PROJECT_MANAGER + SUPERVISOR
-- can maintain their own project-specific shift catalog without
-- touching the tenant-wide base catalog owned by HR/OM.
--
-- Rules §12 + §16 justification:
--   * Base catalog (`project_id IS NULL`) = HR/OM only — those rows
--     drive `shift_allowance` which feeds payroll (rules §14, §22
--     retention). SPV/PM must NOT be able to mint high-allowance
--     shifts that leak into payroll runs.
--   * Project catalog (`project_id IS NOT NULL`) = writable by
--     PROJECT_MANAGER + SUPERVISOR assigned to that project. Same
--     roster/timesheet plumbing consumes both catalogs; the
--     `shift_allowance` on project rows is *forced* to match a base
--     shift's allowance via trigger (see below) so SPV/PM can only
--     tweak time-of-day / labels — not cost.
--
-- Rollback:
--   drop trigger if exists work_shifts_no_project_allowance_edit on public.work_shifts;
--   drop function if exists public.work_shifts_guard_allowance();
--   drop index if exists public.work_shifts_code_base_uniq;
--   drop index if exists public.work_shifts_code_project_uniq;
--   drop index if exists public.work_shifts_project_idx;
--   alter table public.work_shifts drop column project_id;
--   create unique index work_shifts_code_unique on public.work_shifts (tenant_id, code);
--   -- (Restore old policy from 0015_shifts_roster_timesheets_payroll.sql)

begin;

-- 1. Add `project_id` column (nullable → base vs project scope).
alter table public.work_shifts
  add column if not exists project_id uuid null
    references public.projects(id) on delete cascade;

comment on column public.work_shifts.project_id is
  'When NULL, this is a tenant-wide base shift owned by HR/OM. When set, this is a project-scoped custom shift maintained by the assigned PROJECT_MANAGER / SUPERVISOR. Base catalog drives payroll allowance; project rows may override time-of-day but never allowance.';

-- 2. Reindex uniqueness — the old single unique(tenant, code) rule
--    is too tight because a project may want to override "DAY" for
--    itself while HR keeps the base "DAY". Replace with two partial
--    unique indexes matching the two scopes.
alter table public.work_shifts
  drop constraint if exists work_shifts_code_unique;
drop index if exists public.work_shifts_code_unique;

create unique index if not exists work_shifts_code_base_uniq
  on public.work_shifts (tenant_id, code)
  where project_id is null;

create unique index if not exists work_shifts_code_project_uniq
  on public.work_shifts (tenant_id, project_id, code)
  where project_id is not null;

create index if not exists work_shifts_project_idx
  on public.work_shifts (tenant_id, project_id, is_active);

-- 3. Guard trigger — project-scoped shifts must inherit their
--    `shift_allowance` from a base shift with the same `code`. If
--    no base match exists, allowance is forced to 0 (rather than
--    accepting whatever the SPV typed). HR can override later by
--    creating the base row. This means SPV/PM changes never
--    inflate payroll.
create or replace function public.work_shifts_guard_allowance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_allowance numeric(18,2);
  actor_role text;
begin
  -- HR/OM roles bypass the guard entirely — they own the base
  -- catalog and are trusted to set allowances directly. Everyone
  -- else has their allowance forced to inherit from base.
  actor_role := public.current_employee_role();
  if actor_role in (
    'HR_ADMIN',
    'TENANT_ADMIN',
    'GENERAL_MANAGER',
    'HEAD_MANAGER',
    'OPERATIONS_MANAGER'
  ) then
    return new;
  end if;

  if new.project_id is null then
    -- Only HR/OM can create base rows; RLS (below) blocks this path
    -- for other roles, so we shouldn't reach here. Belt & braces.
    raise exception 'Only HR/OM may create base shifts.';
  end if;

  select shift_allowance into base_allowance
  from public.work_shifts
  where tenant_id = new.tenant_id
    and project_id is null
    and code = new.code
  limit 1;

  new.shift_allowance := coalesce(base_allowance, 0);
  new.is_active := true;
  return new;
end;
$$;

drop trigger if exists work_shifts_no_project_allowance_edit on public.work_shifts;
create trigger work_shifts_no_project_allowance_edit
  before insert or update on public.work_shifts
  for each row execute function public.work_shifts_guard_allowance();

-- 4. Replace RLS policy — must be split into two branches:
--      a) `project_id IS NULL` (base catalog)  → HR/OM only.
--      b) `project_id IS NOT NULL` (project scope) → HR/OM + PM/SPV
--         assigned to the project (via project_pm_assignments OR
--         project_employee_assignments).
drop policy if exists work_shifts_admin_write on public.work_shifts;

create policy work_shifts_admin_write
  on public.work_shifts
  as permissive
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (
    tenant_id = public.current_tenant_id()
    and (
      -- Branch A: base catalog — HR/OM tier only.
      (
        project_id is null
        and public.current_employee_role() in (
          'HR_ADMIN',
          'TENANT_ADMIN',
          'GENERAL_MANAGER',
          'HEAD_MANAGER',
          'OPERATIONS_MANAGER'
        )
      )
      or
      -- Branch B: project scope — HR/OM still allowed, plus
      -- PROJECT_MANAGER / SUPERVISOR who are actively assigned to
      -- the project. `is_active` on assignment tables is checked
      -- via EXISTS so we don't accidentally allow assignments that
      -- were archived / handed over.
      (
        project_id is not null
        and (
          public.current_employee_role() in (
            'HR_ADMIN',
            'TENANT_ADMIN',
            'GENERAL_MANAGER',
            'HEAD_MANAGER',
            'OPERATIONS_MANAGER'
          )
          or (
            public.current_employee_role() in ('PROJECT_MANAGER', 'SUPERVISOR')
            and exists (
              select 1
              from public.project_pm_assignments pma
              join public.employees emp
                on emp.id = pma.pm_employee_id
              where pma.project_id = work_shifts.project_id
                and pma.tenant_id = work_shifts.tenant_id
                and pma.status = 'ACTIVE'
                and emp.user_id = auth.uid()
            )
            or exists (
              select 1
              from public.project_employee_assignments pea
              join public.employees emp
                on emp.id = pea.employee_id
              where pea.project_id = work_shifts.project_id
                and pea.tenant_id = work_shifts.tenant_id
                and pea.status = 'ACTIVE'
                and emp.user_id = auth.uid()
            )
          )
        )
      )
    )
  );

commit;
