-- =============================================================================
-- 0046 — Admin bypass for `is_assigned_to_project`.
--
-- The RLS INSERT policies on `project_expenses` and `cash_advances` gate on
-- `is_assigned_to_project(project_id)`. That helper was previously the pure
-- "am I on the roster of this project" check, which correctly stopped a
-- random EMPLOYEE from submitting expenses on projects they aren't on.
--
-- Problem: TENANT_ADMIN / GENERAL_MANAGER / HEAD_MANAGER / OPERATIONS_MANAGER
-- are not assignees — they oversee everything — so RLS blocked their submits
-- even though the app-level PDP (`src/lib/security/pdp.ts`) explicitly says
-- "TENANT_ADMIN can do anything within their own tenant" and the operations
-- ladder is above assignment.
--
-- Fix: the function now also returns TRUE when the caller's employee row has
-- one of the privileged roles. Behavior for regular EMPLOYEE / SUPERVISOR /
-- PROJECT_MANAGER stays unchanged — they must still be on the roster.
--
-- Only two RLS policies use this function today (expenses_submitter_insert,
-- ca_requester_insert), and both want the same admin-bypass semantic.
--
-- Rollback: run migration 0045's function body.
-- =============================================================================

create or replace function public.is_assigned_to_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- (a) Privileged tenant-wide roles bypass assignment gate.
    exists (
      select 1
      from public.employees me
      where me.user_id   = auth.uid()
        and me.tenant_id = public.current_tenant_id()
        and me.is_active
        and me.role in (
          'TENANT_ADMIN',
          'GENERAL_MANAGER',
          'HEAD_MANAGER',
          'OPERATIONS_MANAGER'
        )
    )
    or
    -- (b) Legacy employee-level assignment.
    exists (
      select 1
      from public.project_employee_assignments pea
      join public.employees me on me.id = pea.employee_id
      where pea.project_id = p_project_id
        and pea.status     = 'ACTIVE'
        and pea.tenant_id  = public.current_tenant_id()
        and me.user_id     = auth.uid()
    )
    or
    -- (c) Legacy PM-level assignment.
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
    -- (d) GAS-aligned unified project_assignments (rules §6, Fase 0 slice 5).
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
  'True when auth.uid()''s employee has authorization to write project-scoped resources: either (a) holds a privileged tenant-wide role (TENANT_ADMIN / GM / HM / OM) or (b) has an ACTIVE assignment via project_employee_assignments (legacy) / project_pm_assignments (legacy) / project_assignments (GAS-aligned). Used by expenses_submitter_insert + ca_requester_insert RLS policies. Semantics align with PDP src/lib/security/pdp.ts.';

revoke all on function public.is_assigned_to_project(uuid) from public;
grant execute on function public.is_assigned_to_project(uuid) to authenticated, service_role;
