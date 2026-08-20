-- Migration: 0100_employees_salary_column_privilege.sql
-- Purpose : Close the tenant-wide salary leak (Fase A audit, HIGH-severity).
--           `employees.monthly_salary` is `numeric(18,2)` NOT NULL DEFAULT 0
--           and `employees` RLS is tenant-wide SELECT (see migration 0002).
--           Result: any authenticated tenant user could open the browser
--           devtools and query
--
--             await supabase.from('employees').select('full_name, monthly_salary')
--
--           to enumerate every colleague's salary — a rules §3 violation.
--
--           Migration 0080 tightened `payroll_lines` behind
--           `is_payroll_operator()` but left the salary column on the
--           `employees` table itself unprotected.
--
-- Strategy: Column-level SELECT privilege. Postgres lets us grant SELECT on
--           a subset of columns to a role — the `authenticated` role gets
--           access to every column EXCEPT `monthly_salary` and
--           `hourly_rate`. Service role keeps a full grant (used by the
--           payroll cron + admin-tier server actions after PDP
--           authorization). Row-level RLS on `employees` is UNCHANGED.
--
-- Rules   : §3 salary confidentiality — encrypt/mask by design. Column
--           REVOKE is a "mask via privilege" instead of at-rest encryption
--           — cheaper to deploy, reversible, and avoids the data-migration
--           complexity of the AES-256-GCM approach used for `nik_enc` and
--           `bank_account_number_enc` (migration 0094). If threat model
--           later demands at-rest encryption we can layer it on top; the
--           column-level revoke stays valid either way.
--
-- Rollback:
--   grant select on public.employees to authenticated;
--   -- (Then re-run this migration DO block if you want to re-tighten.)
--
-- Follow-up: The DO block below reads `information_schema.columns` at
--           migration time. **Every future migration that adds a column to
--           `public.employees` MUST also re-run the same DO block** (or
--           explicitly `GRANT SELECT (<new_col>) ON public.employees TO
--           authenticated`) or the new column will be silently invisible
--           to user-JWT queries. Encoded as a lint check in
--           `.cursorrules` §22 (rollback comment + column-grant reminder).

begin;

-- 1. Revoke the blanket table-level SELECT. Postgres does not support
--    "revoke SELECT on a subset of columns" when the underlying grant is
--    table-wide — the only lever we have is: (a) revoke everything, (b)
--    grant back what should stay visible. This has the pleasing property
--    that a bug in the re-grant list falls CLOSED (row invisible) rather
--    than OPEN (leak).
revoke select on public.employees from authenticated;

-- 2. Re-grant column-level SELECT for every column NOT on the sensitive
--    blocklist. Ordinal-position ordering keeps generated SQL stable
--    (helpful when diffing GRANT-history across environments).
do $$
declare
  col text;
  col_list text := '';
  blocklist text[] := array['monthly_salary', 'hourly_rate'];
begin
  for col in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employees'
      and not (column_name = any(blocklist))
    order by ordinal_position
  loop
    col_list := col_list
             || case when col_list = '' then '' else ', ' end
             || quote_ident(col);
  end loop;

  if col_list = '' then
    raise exception
      'columns list came back empty — bail before executing an empty GRANT';
  end if;

  execute format(
    'grant select (%s) on public.employees to authenticated',
    col_list
  );
end $$;

-- 3. Service role retains full SELECT. It bypasses RLS anyway and is used
--    exclusively by server-side code that has already passed PDP checks
--    (payroll generation, UPK auto-gen after OM approval, etc.). Making
--    this explicit prevents an accidental "revoke from public" in a future
--    migration from stripping salary access from the legit flows too.
grant select on public.employees to service_role;

-- 4. Documentation on the sensitive columns themselves — surface the
--    constraint to anyone browsing pgAdmin / running a schema dump.
comment on column public.employees.monthly_salary is
  'IDR monthly base salary (rules §3). SELECT privilege is REVOKED from '
  '`authenticated` in migration 0100 — legit readers (payroll actions, UPK '
  'auto-gen) MUST use the service-role Supabase client after PDP '
  'authorization. Adding a new column to `employees`? Re-run the DO block '
  'in 0100 (or explicitly grant the new column) or it will be invisible to '
  'user-JWT queries.';

comment on column public.employees.hourly_rate is
  'IDR hourly rate for shift-based staff (rules §3). Same authenticated '
  'REVOKE as `monthly_salary` — read via service-role client. Migration 0100.';

commit;
