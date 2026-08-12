-- =============================================================================
-- 0054 — Promote master data (departments / positions / budget categories)
--        to admin-managed lookup_options.
--
-- Migration 0049 introduced `lookup_options` with 4 domains
-- (unit_pengaju, transport_need, area, rab_category). This migration extends
-- the domain vocabulary with 3 more:
--
--   • department       — mirrors the hardcoded DEFAULT_DEPARTMENTS list at
--                        src/lib/hr/directory.ts.
--   • position         — mirrors DEFAULT_POSITIONS.
--   • budget_category  — mirrors the Zod enum BUDGET_CATEGORIES from
--                        src/lib/validation/budget.ts (10 values).
--
-- Backing columns stay unchanged:
--   • public.employees.department       — text (free-text w/ suggestion)
--   • public.employees.position_title   — text (free-text w/ suggestion)
--   • public.budget_line_items.category — text (validated at server layer)
--
-- The seeds match the existing hardcoded values EXACTLY so that any employees
-- row currently referencing e.g. 'Operations' stays valid. Codes for
-- budget_category use the existing enum tokens verbatim (DIRECT_LABOUR, ...).
--
-- Multi-tenant: this migration seeds ONCE per tenant. New tenants created
-- after this migration should call `seed_default_master_data(tenant_id)` from
-- the tenant-provisioning flow — see helper function below.
--
-- Rollback:
--   delete from public.lookup_options
--     where domain in ('department','position','budget_category');
--   alter table public.lookup_options drop constraint lookup_options_domain_check;
--   alter table public.lookup_options add constraint lookup_options_domain_check
--     check (domain in ('unit_pengaju','transport_need','area','rab_category'));
--   drop function if exists public.seed_default_master_data(uuid);
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend the CHECK vocabulary.
-- ---------------------------------------------------------------------------
alter table public.lookup_options
  drop constraint if exists lookup_options_domain_check;

alter table public.lookup_options
  add constraint lookup_options_domain_check check (
    domain in (
      'unit_pengaju',
      'transport_need',
      'area',
      'rab_category',
      'department',
      'position',
      'budget_category'
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Seed helper — idempotent per tenant.
--
-- We wrap the seed in a function so future tenant provisioning can call it
-- from a Server Action / trigger without duplicating the row payload. Uses
-- ON CONFLICT DO NOTHING against the active-code partial unique index, so
-- calling twice for the same tenant is a no-op.
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_master_data(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Departments (mirrors DEFAULT_DEPARTMENTS)
  insert into public.lookup_options (tenant_id, domain, code, label, sort_order)
  values
    (p_tenant, 'department', 'OPERATIONS',      'Operations',           10),
    (p_tenant, 'department', 'PROJECT_DELIVERY','Project Delivery',     20),
    (p_tenant, 'department', 'FINANCE',         'Finance',              30),
    (p_tenant, 'department', 'HR',              'Human Resources',      40),
    (p_tenant, 'department', 'IT_INFRA',        'IT & Infrastructure',  50),
    (p_tenant, 'department', 'SALES_MARKETING', 'Sales & Marketing',    60),
    (p_tenant, 'department', 'CLIENT_SUCCESS',  'Client Success',       70)
  on conflict do nothing;

  -- Positions (mirrors DEFAULT_POSITIONS)
  insert into public.lookup_options (tenant_id, domain, code, label, sort_order)
  values
    (p_tenant, 'position', 'AGENT',              'Agent',              10),
    (p_tenant, 'position', 'TEAM_LEAD',          'Team Lead',          20),
    (p_tenant, 'position', 'SUPERVISOR',         'Supervisor',         30),
    (p_tenant, 'position', 'ANALYST',            'Analyst',            40),
    (p_tenant, 'position', 'SENIOR_ANALYST',     'Senior Analyst',     50),
    (p_tenant, 'position', 'MANAGER',            'Manager',            60),
    (p_tenant, 'position', 'HEAD_OF_DEPARTMENT', 'Head of Department', 70),
    (p_tenant, 'position', 'DIRECTOR',           'Director',           80),
    (p_tenant, 'position', 'SPECIALIST',         'Specialist',         90)
  on conflict do nothing;

  -- Budget categories (mirrors BUDGET_CATEGORIES, codes identical to enum)
  insert into public.lookup_options (tenant_id, domain, code, label, description, sort_order)
  values
    (p_tenant, 'budget_category', 'DIRECT_LABOUR',   'Direct Labour',   'Salary / labour cost billable to project.',                   10),
    (p_tenant, 'budget_category', 'SUBCONTRACTOR',   'Subcontractor',   'External vendor services (dev studio, agency, etc.).',        20),
    (p_tenant, 'budget_category', 'INFRASTRUCTURE',  'Infrastructure',  'Servers, cloud, network, hardware for the project.',          30),
    (p_tenant, 'budget_category', 'TOOLING',         'Tooling',         'Software licences / SaaS charged to project.',                40),
    (p_tenant, 'budget_category', 'TRAVEL',          'Travel',          'Airfare, lodging, ground transport tied to project sites.',   50),
    (p_tenant, 'budget_category', 'TRAINING',        'Training',        'Team upskilling directly tied to the engagement.',            60),
    (p_tenant, 'budget_category', 'MARKETING',       'Marketing',       'Client-side marketing / event / launch costs.',               70),
    (p_tenant, 'budget_category', 'OPERATIONS',      'Operations',      'Recurring project operations expense.',                       80),
    (p_tenant, 'budget_category', 'CONTINGENCY',     'Contingency',     'Reserve pool for unplanned scope adjustments.',               90),
    (p_tenant, 'budget_category', 'OTHER',           'Other',           'Uncategorised — please add a description on the line item.', 100)
  on conflict do nothing;
end;
$$;

comment on function public.seed_default_master_data(uuid) is
  'Idempotent seed of department / position / budget_category defaults for '
  'a tenant. Safe to call multiple times. Codes match legacy hardcoded '
  'values (src/lib/hr/directory.ts + src/lib/validation/budget.ts).';

revoke all on function public.seed_default_master_data(uuid) from public;
grant execute on function public.seed_default_master_data(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Backfill every existing tenant.
-- ---------------------------------------------------------------------------
do $$
declare
  t_id uuid;
begin
  for t_id in select id from public.tenants loop
    perform public.seed_default_master_data(t_id);
  end loop;
end $$;
