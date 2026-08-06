-- ControlDesk — 0021_gas_alignment_role_expansion.sql
-- Fase 0 slice 2 — introduce GAS-aligned canonical role codes to the
-- `public.employee_role` enum ADDITIVELY (rules §6 rewrite).
--
-- Why additive?
--   The 10 legacy BPO role values are still referenced by 30+ RLS policies,
--   application state machines (`src/lib/expenses/state.ts`, etc.), and
--   PDP decisions. Removing them in a single shot would cascade-break the
--   monorepo. Instead we ADD the 7 canonical codes so:
--     - New modules (Fase 1+) can insert canonical values directly.
--     - Legacy code + policies keep working with the old codes.
--     - `src/lib/rbac/roles.ts::toCanonicalRole()` bridges both worlds
--       at the app layer during the transition.
--
-- Fase 0 slice N (after all callers migrate) will land the enum swap that
-- retires the legacy codes.
--
-- Rollback (dev only — production must not run this once shipped):
--   -- Postgres does not support removing enum values. To roll back, dump
--   -- the affected columns to text, drop+recreate the enum, and re-cast.
--   -- See supabase/migrations/README.md for the runbook.

-- ---------------------------------------------------------------------------
-- 1. Add canonical role codes (idempotent — safe to re-run).
-- ---------------------------------------------------------------------------
--
-- `ALTER TYPE ... ADD VALUE IF NOT EXISTS` is transaction-safe on Postgres
-- 12+ (Supabase runs on 15+). Each ADD is a no-op if the value already exists.
alter type public.employee_role add value if not exists 'ADMIN';
alter type public.employee_role add value if not exists 'DIRECTOR';
alter type public.employee_role add value if not exists 'FINANCE';
alter type public.employee_role add value if not exists 'PM';
alter type public.employee_role add value if not exists 'OM';
-- `SUPERVISOR` and `EMPLOYEE` are canonical AND legacy — no change needed.

-- ---------------------------------------------------------------------------
-- 2. Convenience view — canonical projection of `employees` for reads
--    that don't want to deal with the legacy code space.
-- ---------------------------------------------------------------------------
create or replace view public.employees_canonical
with (security_invoker = true) as
select
  e.id,
  e.tenant_id,
  e.user_id,
  e.full_name,
  e.email,
  e.is_active,
  e.reports_to_employee_id,
  e.created_at,
  e.updated_at,
  e.role                                    as legacy_role,
  case e.role::text
    when 'TENANT_ADMIN'          then 'ADMIN'
    when 'HR_ADMIN'              then 'ADMIN'
    when 'GENERAL_MANAGER'       then 'DIRECTOR'
    when 'HEAD_MANAGER'          then 'DIRECTOR'
    when 'LEAD_FINANCE'          then 'FINANCE'
    when 'PETTY_CASH_CUSTODIAN'  then 'FINANCE'
    when 'OPERATIONS_MANAGER'    then 'OM'
    when 'PROJECT_MANAGER'       then 'PM'
    when 'SUPERVISOR'            then 'SUPERVISOR'
    when 'EMPLOYEE'              then 'EMPLOYEE'
    when 'ADMIN'                 then 'ADMIN'
    when 'DIRECTOR'              then 'DIRECTOR'
    when 'FINANCE'               then 'FINANCE'
    when 'PM'                    then 'PM'
    when 'OM'                    then 'OM'
    else 'EMPLOYEE'
  end                                       as canonical_role
from public.employees e;

comment on view public.employees_canonical is
  'Read-only projection of `employees` that folds the 10 legacy BPO roles + 5 new canonical codes onto the 7-role GAS-aligned model (rules §6). Use `canonical_role` in new modules; `legacy_role` remains available for policies still tied to the old codes.';

-- ---------------------------------------------------------------------------
-- 3. Helper function — canonical role from JWT for RLS policies that want
--    to write against the new model without repeating the CASE.
-- ---------------------------------------------------------------------------
create or replace function public.canonical_employee_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case (public.current_employee_role())::text
    when 'TENANT_ADMIN'          then 'ADMIN'
    when 'HR_ADMIN'              then 'ADMIN'
    when 'GENERAL_MANAGER'       then 'DIRECTOR'
    when 'HEAD_MANAGER'          then 'DIRECTOR'
    when 'LEAD_FINANCE'          then 'FINANCE'
    when 'PETTY_CASH_CUSTODIAN'  then 'FINANCE'
    when 'OPERATIONS_MANAGER'    then 'OM'
    when 'PROJECT_MANAGER'       then 'PM'
    when 'SUPERVISOR'            then 'SUPERVISOR'
    when 'EMPLOYEE'              then 'EMPLOYEE'
    when 'ADMIN'                 then 'ADMIN'
    when 'DIRECTOR'              then 'DIRECTOR'
    when 'FINANCE'               then 'FINANCE'
    when 'PM'                    then 'PM'
    when 'OM'                    then 'OM'
    else null
  end;
$$;

comment on function public.canonical_employee_role() is
  'Wraps public.current_employee_role() and folds legacy BPO codes onto the 7-role canonical model. Use in new RLS policies where the module reasons about canonical roles only.';

grant execute on function public.canonical_employee_role() to authenticated, service_role;
