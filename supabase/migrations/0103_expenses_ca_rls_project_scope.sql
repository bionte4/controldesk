-- Migration: 0103_expenses_ca_rls_project_scope.sql
-- Purpose : Mirror `resolveProjectScope()` (src/lib/security/project-scope.ts)
--           semantics at the DB layer for `project_expenses` and
--           `cash_advances`. Closes the second half of the Fase A/B
--           audit finding — an EMPLOYEE could previously `curl
--           https://<tenant>/rest/v1/project_expenses` (using their own
--           user-JWT) and get every expense in the tenant, even for
--           projects they aren't on. The app layer already narrows
--           these lists via `buildApproverOrSelfClause()`, but that
--           is defense against UI misuse only — DB was tenant-open.
--
-- Model    : Ports the app-layer three-way classification
--            (src/lib/security/project-scope.ts:65-93):
--
--            • **ORG**       (`is_org_scope()`)   → sees every row
--                            in the tenant. Mirrors ORG_DB_ROLES.
--            • **PORTFOLIO** (`is_portfolio_scope()`) → sees rows on
--                            projects handled by employees reporting
--                            transitively to the caller. Mirrors
--                            PORTFOLIO_DB_ROLES + BFS descent.
--            • **ASSIGNED**  (implicit else)     → sees rows on the
--                            caller's own PM / employee assignments.
--
--            Additionally: any caller can always see rows they
--            themselves submitted (`submitter_employee_id` /
--            `requester_employee_id` = current_employee_id()).
--
--            Non-approver roles (EMPLOYEE, PETTY_CASH_CUSTODIAN) that
--            pass the "self" branch but fail the "org / approver +
--            visible project" branch see only their own submissions —
--            exactly mirroring `buildApproverOrSelfClause()` returning
--            the `"self"` sentinel.
--
-- Rules    : §3 ABAC, §6 canonical role folds, §9 approval chain.
--
-- Not-scope: UPDATE policies stay tenant-open because approvers
--            legitimately UPDATE rows submitted by other users to
--            advance approval state; tightening those requires
--            porting `resolveExpenseApprovalChain()` /
--            `resolveCaApprovalChain()` to SQL, which is a bigger lift.
--            The audit shows UPDATE is app-layer-gated by
--            `withSecureAction()` + PDP everywhere; RLS UPDATE is
--            the second-line-of-defense that can follow-up separately.
--
-- Rollback :
--   drop policy if exists expenses_scoped_read on public.project_expenses;
--   drop policy if exists ca_scoped_read on public.cash_advances;
--   create policy expenses_tenant_read on public.project_expenses
--     for select to authenticated
--     using (tenant_id = public.current_tenant_id());
--   create policy ca_tenant_read on public.cash_advances
--     for select to authenticated
--     using (tenant_id = public.current_tenant_id());
--   drop function if exists public.current_visible_project_ids();
--   drop function if exists public.is_approver_role();
--   drop function if exists public.is_portfolio_scope();
--   drop function if exists public.is_org_scope();

begin;

-- ---------------------------------------------------------------------------
-- Helper 1 — is_org_scope()
-- ---------------------------------------------------------------------------
-- Mirrors ORG_DB_ROLES in src/lib/security/project-scope.ts:67-75.
-- Kept aligned with the app-layer list explicitly (no canonical fold
-- because HEAD_MANAGER folds to DIRECTOR but is portfolio-scoped, not
-- org — the DB-name check is the only correct one).
create or replace function public.is_org_scope()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees e
    where e.user_id = auth.uid()
      and e.tenant_id = public.current_tenant_id()
      and e.role::text in (
        'TENANT_ADMIN', 'ADMIN',
        'GENERAL_MANAGER', 'DIRECTOR',
        'LEAD_FINANCE', 'FINANCE',
        'HR_ADMIN'
      )
  );
$$;

comment on function public.is_org_scope() is
  'RLS helper: true iff caller holds an ORG-tier role (see everything '
  'in the tenant). Mirrors ORG_DB_ROLES in src/lib/security/project-scope.ts. '
  'Migration 0103.';

revoke all on function public.is_org_scope() from public;
grant execute on function public.is_org_scope()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper 2 — is_portfolio_scope()
-- ---------------------------------------------------------------------------
-- Mirrors PORTFOLIO_DB_ROLES in src/lib/security/project-scope.ts:77-81.
create or replace function public.is_portfolio_scope()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees e
    where e.user_id = auth.uid()
      and e.tenant_id = public.current_tenant_id()
      and e.role::text in (
        'HEAD_MANAGER', 'OPERATIONS_MANAGER', 'OM'
      )
  );
$$;

comment on function public.is_portfolio_scope() is
  'RLS helper: true iff caller holds a PORTFOLIO-tier role (sees projects '
  'of subordinates transitively). Mirrors PORTFOLIO_DB_ROLES in '
  'src/lib/security/project-scope.ts. Migration 0103.';

revoke all on function public.is_portfolio_scope() from public;
grant execute on function public.is_portfolio_scope()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper 3 — is_approver_role()
-- ---------------------------------------------------------------------------
-- Mirrors APPROVER_DB_ROLES in src/lib/security/project-scope.ts:355-369.
-- APPROVER = everyone EXCEPT EMPLOYEE and PETTY_CASH_CUSTODIAN. Non-
-- approvers see only their own submissions regardless of project
-- assignment.
create or replace function public.is_approver_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employees e
    where e.user_id = auth.uid()
      and e.tenant_id = public.current_tenant_id()
      and e.role::text in (
        'TENANT_ADMIN', 'ADMIN',
        'GENERAL_MANAGER', 'DIRECTOR',
        'HEAD_MANAGER',
        'OPERATIONS_MANAGER', 'OM',
        'PROJECT_MANAGER', 'PM',
        'LEAD_FINANCE', 'FINANCE',
        'HR_ADMIN',
        'SUPERVISOR'
      )
  );
$$;

comment on function public.is_approver_role() is
  'RLS helper: true iff caller holds any approver-tier role (may see rows '
  'submitted by other users within their project scope). Mirrors '
  'APPROVER_DB_ROLES in src/lib/security/project-scope.ts. Migration 0103.';

revoke all on function public.is_approver_role() from public;
grant execute on function public.is_approver_role()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper 4 — current_visible_project_ids()
-- ---------------------------------------------------------------------------
-- Returns the set of project IDs the caller can see under
-- project-level scoping. Behaviour by scope kind:
--
--   • ORG        → returns nothing (RLS handles this via the
--                  `is_org_scope()` short-circuit — org callers never
--                  reach this branch).
--   • PORTFOLIO  → returns projects handled by the caller's
--                  subordinates (transitive, BFS across
--                  `employees.reports_to_employee_id`).
--   • ASSIGNED   → returns projects the caller is personally
--                  assigned to via PM or member assignments.
--
-- The recursive CTE walks the reports chain with an 8-hop safety cap
-- (matches `collectSubordinateIds()` in project-scope.ts:141) — cycles
-- are impossible per the `chk_no_self_report` FK guard but the
-- explicit `depth` column stops runaway recursion if a future
-- migration accidentally allows one.
--
-- The function is `STABLE` so the planner can inline it once per
-- query (the set is then used as a hash for row-by-row `IN` checks).
create or replace function public.current_visible_project_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller_id uuid := public.current_employee_id();
begin
  if caller_id is null then
    return;
  end if;

  if public.is_portfolio_scope() then
    -- Transitive descent through reports_to_employee_id.
    return query
    with recursive subs(id, depth) as (
      select caller_id, 0
      union all
      select e.id, s.depth + 1
      from public.employees e
      join subs s on e.reports_to_employee_id = s.id
      where s.depth < 8
    )
    select project_id from public.project_pm_assignments
     where pm_employee_id in (select id from subs)
       and status = 'ACTIVE'
    union
    select project_id from public.project_employee_assignments
     where employee_id in (select id from subs)
       and status = 'ACTIVE';
  else
    -- Assigned scope: caller's own assignments only.
    return query
    select project_id from public.project_pm_assignments
     where pm_employee_id = caller_id
       and status = 'ACTIVE'
    union
    select project_id from public.project_employee_assignments
     where employee_id = caller_id
       and status = 'ACTIVE';
  end if;
end $$;

comment on function public.current_visible_project_ids() is
  'RLS helper: returns the project IDs the caller can see under project-'
  'level scoping. PORTFOLIO scope returns subordinates transitively; '
  'ASSIGNED scope returns own assignments. Mirrors '
  'loadPortfolioProjectIds() / loadAssignedProjectIds() in '
  'src/lib/security/project-scope.ts. Migration 0103.';

revoke all on function public.current_visible_project_ids() from public;
grant execute on function public.current_visible_project_ids()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- SELECT policy — project_expenses
-- ---------------------------------------------------------------------------
-- Precedence (in the WHERE clause):
--   1. Tenant match — cross-tenant rejected.
--   2. ORG scope    — see everything (executives + Finance).
--   3. Own row      — submitter_employee_id matches caller.
--   4. Approver     — approver role + row's project in caller's
--                     visible project set.
--
-- Non-approver roles (EMPLOYEE, PETTY_CASH_CUSTODIAN) never satisfy
-- branch 4 and so only see their own submissions (branch 3) — this
-- is exactly the `"self"` return path in `buildApproverOrSelfClause`
-- when `!opts.treatAsApprover`.

drop policy if exists expenses_tenant_read on public.project_expenses;

create policy expenses_scoped_read
  on public.project_expenses
  for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.is_org_scope()
      or submitter_employee_id = public.current_employee_id()
      or (
        public.is_approver_role()
        and project_id in (select public.current_visible_project_ids())
      )
    )
  );

comment on policy expenses_scoped_read on public.project_expenses is
  'Ports resolveProjectScope() + buildApproverOrSelfClause() semantics '
  'to RLS. See migration 0103 header for the precedence order.';

-- ---------------------------------------------------------------------------
-- SELECT policy — cash_advances
-- ---------------------------------------------------------------------------
-- Same shape as expenses but keyed on `requester_employee_id`.

drop policy if exists ca_tenant_read on public.cash_advances;

create policy ca_scoped_read
  on public.cash_advances
  for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.is_org_scope()
      or requester_employee_id = public.current_employee_id()
      or (
        public.is_approver_role()
        and project_id in (select public.current_visible_project_ids())
      )
    )
  );

comment on policy ca_scoped_read on public.cash_advances is
  'Ports resolveProjectScope() + buildApproverOrSelfClause() semantics '
  'to RLS. See migration 0103 header for the precedence order.';

commit;
