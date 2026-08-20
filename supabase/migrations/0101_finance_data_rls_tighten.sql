-- Migration: 0101_finance_data_rls_tighten.sql
-- Purpose : Close the tenant-wide read leak on commercial finance tables
--           identified in the Fase B audit:
--
--             • bpo_contracts    — contract value, MRR, SLA terms
--             • budgets          — total_planned, per-project header
--             • budget_details   — per-line planned/remaining
--
--           Before this migration, SELECT policies on all three were
--           `tenant_id = current_tenant_id()` — meaning any authenticated
--           tenant user could open the browser devtools and query the
--           tables directly, e.g.
--
--             await supabase.from('projects').select('name, contract_value');
--
--           Application-layer capability gates (`view_contract`,
--           `view_budget`) hide the *UI*, but do nothing at the DB layer.
--           This migration mirrors the capability defaults at the RLS
--           layer so a raw REST call falls closed for non-authorized
--           callers.
--
--           `projects.contract_value` column-level tightening is
--           **deferred** — 10+ read sites in the app would need to move
--           to the service-role client. Documented as a follow-up in
--           docs/ops/production-deployment.md.
--
-- Strategy:
--   1. Two SECURITY DEFINER helpers that mirror the capability defaults
--      in `src/lib/rbac/capabilities.ts`:
--         is_finance_leader()      → `view_contract` roles (high)
--         is_finance_management()  → `view_budget` roles (medium)
--      Both accept the canonical role fold (rules §6) so callers signed
--      in with a canonical `FINANCE` / `DIRECTOR` / `ADMIN` role match
--      the same gate as the legacy DB names.
--   2. Rewrite the SELECT policies on the three tables to require the
--      appropriate helper.
--   3. For `budgets` + `budget_details`, add a project-membership
--      fallback so an employee submitting an expense on a project they're
--      assigned to can still populate the MA (budget line) dropdown via
--      `v_project_budget_lines`. Reuses `is_project_member()` from
--      migration 0099.
--   4. Force `v_project_budget_lines` to run with `security_invoker=true`
--      so the underlying RLS is actually applied at the view level — the
--      view previously ran with owner privileges (Postgres default) and
--      bypassed RLS entirely.
--
-- Rules   : §3 defense-in-depth; §6 canonical role folds; §17 same PDP
--           semantics between app and DB layer.
--
-- Rollback:
--   -- Reverse the SELECT policies to plain tenant-scope:
--   drop policy if exists bpo_contracts_tenant_read on public.bpo_contracts;
--   create policy bpo_contracts_tenant_read on public.bpo_contracts
--     for select using (tenant_id = public.current_tenant_id());
--   drop policy if exists budgets_tenant_read on public.budgets;
--   create policy budgets_tenant_read on public.budgets
--     for select using (tenant_id = public.current_tenant_id());
--   drop policy if exists budget_details_tenant_read on public.budget_details;
--   create policy budget_details_tenant_read on public.budget_details
--     for select using (tenant_id = public.current_tenant_id());
--   -- Restore view default (invoker=false = owner runs):
--   alter view public.v_project_budget_lines set (security_invoker = false);
--   -- Drop helpers:
--   drop function if exists public.is_finance_management();
--   drop function if exists public.is_finance_leader();

begin;

-- ---------------------------------------------------------------------------
-- Helper 1 — is_finance_leader()
-- ---------------------------------------------------------------------------
-- Mirrors CAPABILITY_CATALOG['view_contract'].defaultRoles from
-- src/lib/rbac/capabilities.ts:114-126 plus the canonical folds:
--   Legacy DB names   : LEAD_FINANCE, HEAD_MANAGER, GENERAL_MANAGER, TENANT_ADMIN
--   Canonical (rules §6): FINANCE, DIRECTOR, ADMIN
--
-- SECURITY DEFINER + `search_path=public` for the same reason as
-- `is_project_member()` in migration 0099 — avoids a policy-recursion
-- problem and pins the schema so shadowed-schema attacks can't redirect
-- the subquery.
create or replace function public.is_finance_leader()
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
        'LEAD_FINANCE', 'HEAD_MANAGER', 'GENERAL_MANAGER', 'TENANT_ADMIN',
        'FINANCE', 'DIRECTOR', 'ADMIN'
      )
  );
$$;

comment on function public.is_finance_leader() is
  'RLS helper: true iff caller holds one of the roles in the `view_contract` '
  'capability default set (rules §3 high-sensitivity commercial data). Mirrors '
  'CAPABILITY_CATALOG[''view_contract''].defaultRoles in '
  'src/lib/rbac/capabilities.ts. Migration 0101.';

revoke all on function public.is_finance_leader() from public;
grant execute on function public.is_finance_leader()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper 2 — is_finance_management()
-- ---------------------------------------------------------------------------
-- Mirrors CAPABILITY_CATALOG['view_budget'].defaultRoles from
-- src/lib/rbac/capabilities.ts:96-113 plus canonical folds:
--   Legacy DB names   : PROJECT_MANAGER, OPERATIONS_MANAGER, HEAD_MANAGER,
--                       GENERAL_MANAGER, LEAD_FINANCE, TENANT_ADMIN
--   Canonical (rules §6): PM, OM, DIRECTOR, FINANCE, ADMIN
--
-- Broader than `is_finance_leader()` — includes PM/OM tier because
-- managers of individual projects need to see their own project budgets.
create or replace function public.is_finance_management()
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
        'PROJECT_MANAGER', 'OPERATIONS_MANAGER', 'HEAD_MANAGER',
        'GENERAL_MANAGER', 'LEAD_FINANCE', 'TENANT_ADMIN',
        'PM', 'OM', 'DIRECTOR', 'FINANCE', 'ADMIN'
      )
  );
$$;

comment on function public.is_finance_management() is
  'RLS helper: true iff caller holds one of the roles in the `view_budget` '
  'capability default set (rules §3 medium-sensitivity budget data). Mirrors '
  'CAPABILITY_CATALOG[''view_budget''].defaultRoles in '
  'src/lib/rbac/capabilities.ts. Broader than `is_finance_leader()` — '
  'includes PM/OM. Migration 0101.';

revoke all on function public.is_finance_management() from public;
grant execute on function public.is_finance_management()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Policy 1 — bpo_contracts_tenant_read (HIGH sensitivity)
-- ---------------------------------------------------------------------------
-- SELECT restricted to `is_finance_leader()`. Contract values, MRR, SLA
-- commitments — commercial data that should never leak to non-leadership
-- tiers. Only the `/finance/contracts` page reads this table (also gated
-- by the `view_contract` capability at the app layer), so no legitimate
-- flow is impacted.
drop policy if exists bpo_contracts_tenant_read on public.bpo_contracts;

create policy bpo_contracts_tenant_read
  on public.bpo_contracts
  for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.is_finance_leader()
  );

-- ---------------------------------------------------------------------------
-- Policy 2 — budgets_tenant_read (MEDIUM sensitivity)
-- ---------------------------------------------------------------------------
-- SELECT allowed if:
--   (a) caller is in `is_finance_management()` — sees every tenant budget,
--       matching the `view_budget` capability default; OR
--   (b) caller is an active project member — sees ONLY that project's
--       budget header, which is needed for the expense-submission MA
--       dropdown fed by `v_project_budget_lines`.
drop policy if exists budgets_tenant_read on public.budgets;

create policy budgets_tenant_read
  on public.budgets
  for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.is_finance_management()
      or public.is_project_member(project_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Policy 3 — budget_details_tenant_read (MEDIUM sensitivity)
-- ---------------------------------------------------------------------------
-- Same shape as `budgets_tenant_read` but the project-member fallback
-- has to traverse `budgets.project_id`. `is_project_member()` is
-- SECURITY DEFINER so it bypasses RLS on the assignment table — the
-- subquery on `public.budgets` here inherits caller RLS, which is fine
-- because it uses the primary key (no cross-tenant risk).
drop policy if exists budget_details_tenant_read on public.budget_details;

create policy budget_details_tenant_read
  on public.budget_details
  for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.is_finance_management()
      or exists (
        select 1
        from public.budgets b
        where b.id = budget_details.budget_id
          and public.is_project_member(b.project_id)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- View — v_project_budget_lines
-- ---------------------------------------------------------------------------
-- Force the view to run with the caller's privileges so RLS on the
-- underlying `budgets` + `budget_details` actually applies. Without
-- this flag Postgres runs the view as its owner (usually `postgres`),
-- effectively bypassing the policies above and re-opening the leak.
--
-- Trade-off: expense submitters (non-management) now see ONLY budget
-- lines from projects they're actively assigned to. This matches
-- app-layer intent — `v_project_budget_lines` was always keyed by
-- `project_id` for the MA dropdown; non-members had no legitimate
-- reason to enumerate other projects' lines.
alter view public.v_project_budget_lines set (security_invoker = true);

comment on view public.v_project_budget_lines is
  'Per-tenant budget lines with parent budget status. Runs with '
  '`security_invoker=true` (migration 0101) so RLS on `budgets` and '
  '`budget_details` applies — non-management callers only see lines of '
  'projects they''re actively assigned to. App layer filters to budgets '
  'in {DRAFT, PENDING_FINANCE, PENDING_DIRECTOR, APPROVED} for the '
  'MA dropdown on the expense form.';

commit;
