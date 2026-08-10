-- 0080_tighten_payroll_rls.sql
--
-- CRITICAL security hardening: `payroll_periods` and `payroll_lines`
-- previously exposed `_tenant_read` policies with only a tenant_id
-- filter, meaning EVERY employee in a tenant could SELECT salary,
-- overtime pay, gross_pay, net_pay of every colleague simply by
-- URL-pasting `/hr/payroll` (the app layer had no role guard either,
-- fixed in this same commit).
--
-- Rules §3 mandates encryption + role masking for HRIS salary data;
-- this migration tightens RLS so only:
--   • payroll operators (LEAD_FINANCE, HR_ADMIN, TENANT_ADMIN,
--     GENERAL_MANAGER — mirrors the app-layer PAYROLL_VIEWER_ROLES
--     constant in src/lib/rbac/roles.ts), and
--   • employees themselves reading their OWN payslip line
-- can SELECT from these tables. Writes remain gated to the same
-- payroll operator set (rules §7 finance chain — payroll periods
-- flow through Draft → Finalized, not the generic expense chain).
--
-- Rollback:
--   drop policy if exists payroll_lines_tenant_read on public.payroll_lines;
--   drop policy if exists payroll_lines_hr_finance_write on public.payroll_lines;
--   create policy payroll_lines_tenant_read on public.payroll_lines
--     for select using (tenant_id = current_tenant_id());
--   create policy payroll_lines_hr_finance_write on public.payroll_lines
--     for all using (tenant_id = current_tenant_id())
--     with check (tenant_id = current_tenant_id());
--   -- repeat for payroll_periods

-- Helper: is the current user a payroll operator in this tenant?
-- Distinct from `is_hr_or_management()` (which admits OPERATIONS_MANAGER
-- + HEAD_MANAGER for performance reviews) because payroll is a strictly
-- finance/HR concern per rules §3 and §9.
create or replace function public.is_payroll_operator()
returns boolean
language sql
stable
security invoker
as $fn$
  select exists (
    select 1 from public.employees e
    where e.user_id = auth.uid()
      and e.role in (
        'LEAD_FINANCE', 'HR_ADMIN', 'TENANT_ADMIN', 'GENERAL_MANAGER',
        -- Canonical GAS aliases (Fase 0 §6). `FINANCE` folds LEAD_FINANCE +
        -- PETTY_CASH_CUSTODIAN, but here we deliberately DO NOT admit
        -- PETTY_CASH_CUSTODIAN — canonical `FINANCE` in employees.role
        -- refers to `Lead Finance` semantics per toCanonicalRole(). ADMIN
        -- and DIRECTOR canonical mirror TENANT_ADMIN + GENERAL_MANAGER.
        'FINANCE', 'ADMIN', 'DIRECTOR'
      )
  );
$fn$;

comment on function public.is_payroll_operator() is
  'RLS helper: true if auth.uid() maps to an employees row with a role authorized '
  'to read payroll data (LEAD_FINANCE, HR_ADMIN, TENANT_ADMIN, GENERAL_MANAGER, '
  'plus canonical FINANCE/ADMIN/DIRECTOR). Mirrors PAYROLL_VIEWER_ROLES in '
  'src/lib/rbac/roles.ts. Rules §3 salary confidentiality.';

grant execute on function public.is_payroll_operator() to authenticated, anon, service_role;

-- payroll_periods: aggregate rows (gross_total, net_total per month).
-- Non-payroll-operators can still see period existence via a projected
-- read (id + status + year/month) IF we ever add a payslip-self view,
-- but for now block them entirely — periods themselves reveal the
-- monthly bill total. Individual employees see their own payslip via
-- payroll_lines only.
drop policy if exists payroll_periods_tenant_read on public.payroll_periods;
create policy payroll_periods_tenant_read on public.payroll_periods
  for select using (
    tenant_id = current_tenant_id()
    and public.is_payroll_operator()
  );

-- payroll_lines: SELECT permitted for payroll operators (all rows) OR
-- for the employee themselves (their own line, so they can view their
-- own payslip in a future self-service page). This second branch is
-- future-proofing — no page currently exposes it — but it keeps the
-- door open without another migration.
drop policy if exists payroll_lines_tenant_read on public.payroll_lines;
create policy payroll_lines_tenant_read on public.payroll_lines
  for select using (
    tenant_id = current_tenant_id()
    and (
      public.is_payroll_operator()
      or employee_id in (
        select id from public.employees where user_id = auth.uid()
      )
    )
  );

-- Write policies unchanged in shape but re-declared for explicitness.
-- Only payroll operators can generate / finalize periods and lines.
drop policy if exists payroll_periods_hr_finance_write on public.payroll_periods;
create policy payroll_periods_hr_finance_write on public.payroll_periods
  for all using (
    tenant_id = current_tenant_id()
    and public.is_payroll_operator()
  ) with check (
    tenant_id = current_tenant_id()
    and public.is_payroll_operator()
  );

drop policy if exists payroll_lines_hr_finance_write on public.payroll_lines;
create policy payroll_lines_hr_finance_write on public.payroll_lines
  for all using (
    tenant_id = current_tenant_id()
    and public.is_payroll_operator()
  ) with check (
    tenant_id = current_tenant_id()
    and public.is_payroll_operator()
  );
