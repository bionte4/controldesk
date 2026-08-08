-- =============================================================================
-- 0045 — Broaden `is_assigned_to_project` to cover all live assignment sources.
--
-- Previously only `project_employee_assignments` (legacy employee table) was
-- checked, which meant a Project Manager assigned via
-- `project_pm_assignments` OR the newer GAS-aligned `project_assignments`
-- table would fail the RLS INSERT gate on `project_expenses` /
-- `cash_advances` even though the app-level PDP allowed the action.
--
-- The function stays SECURITY DEFINER + STABLE. Union of three sources:
--   1. project_employee_assignments (legacy per-employee alloc)
--   2. project_pm_assignments        (legacy PM alloc)
--   3. project_assignments           (GAS-aligned, Fase 0 slice 5)
--
-- Rollback:
--   create or replace function public.is_assigned_to_project(p_project_id uuid)
--   returns boolean language sql stable security definer set search_path = public
--   as $$
--     select exists (
--       select 1 from public.project_employee_assignments pea
--       join public.employees me on me.id = pea.employee_id
--       where pea.project_id = p_project_id
--         and pea.status = 'ACTIVE'
--         and pea.tenant_id = public.current_tenant_id()
--         and me.user_id = auth.uid()
--     );
--   $$;
-- =============================================================================

create or replace function public.is_assigned_to_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- (a) Legacy employee-level assignment.
    exists (
      select 1
      from public.project_employee_assignments pea
      join public.employees me on me.id = pea.employee_id
      where pea.project_id = p_project_id
        and pea.status    = 'ACTIVE'
        and pea.tenant_id = public.current_tenant_id()
        and me.user_id    = auth.uid()
    )
    or
    -- (b) Legacy PM-level assignment.
    exists (
      select 1
      from public.project_pm_assignments ppa
      join public.employees me on me.id = ppa.pm_employee_id
      where ppa.project_id = p_project_id
        and ppa.status     = 'ACTIVE'
        and ppa.tenant_id  = public.current_tenant_id()
        and me.user_id     = auth.uid()
    )
    or
    -- (c) GAS-aligned unified project_assignments (rules §6, Fase 0 slice 5).
    exists (
      select 1
      from public.project_assignments pa
      join public.employees me on me.id = pa.employee_id
      where pa.project_id = p_project_id
        and pa.status     = 'ACTIVE'
        and pa.tenant_id  = public.current_tenant_id()
        and me.user_id    = auth.uid()
    );
$$;

comment on function public.is_assigned_to_project(uuid) is
  'True when auth.uid()''s employee has an ACTIVE assignment to the project via ANY of: project_employee_assignments (legacy), project_pm_assignments (legacy), or project_assignments (GAS-aligned).';

-- Idempotent re-grant just in case a downstream migration revoked default execute.
revoke all on function public.is_assigned_to_project(uuid) from public;
grant execute on function public.is_assigned_to_project(uuid) to authenticated, service_role;
