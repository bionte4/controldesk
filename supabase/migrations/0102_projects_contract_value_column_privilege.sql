-- Migration: 0102_projects_contract_value_column_privilege.sql
-- Purpose : Complete the "commercial data" leak closure (Fase B follow-up).
--           `projects.contract_value` (`numeric(18,2)` IDR) is the total
--           contract value for a customer engagement — MRR × contract
--           length, or a fixed-fee statement of work. Migration 0101
--           locked down `bpo_contracts` (the header table for BPO SLA
--           contracts) but the same figure also lives on `projects` and
--           was previously readable by any tenant employee via
--
--             await supabase.from('projects').select('name, contract_value')
--
--           This migration applies the same column-level SELECT REVOKE
--           pattern used for `employees.monthly_salary` (migration 0100).
--
-- Strategy: REVOKE the table-level SELECT from `authenticated` and
--           re-GRANT column-level SELECT on every column EXCEPT
--           `contract_value`. Service role keeps the full grant.
--
--           The 4 legit read sites in the codebase moved to a separate
--           service-role query for the `contract_value` read specifically,
--           each guarded by the appropriate PDP / capability check:
--
--             • src/app/(app)/projects/[id]/page.tsx — only when
--               `canEditProject` (OM+/TENANT_ADMIN via `authorize()`).
--             • src/lib/reports/queries/project-portfolio.ts — the
--               `reports/runner.ts` already gates by
--               `meta.allowedRoles.includes(dbRole)` before invoking
--               this query.
--             • src/lib/ai/tools/index.ts — guarded by
--               `roleInGate(ctx.dbRole, CONTRACT_VIEWER_ROLES)`; the
--               `project_info` tool omits the value entirely for
--               non-leader callers so the LLM can't leak it.
--
-- Rules   : §3 commercial-data confidentiality; §6 canonical role folds
--           (via CONTRACT_VIEWER_ROLES helper in src/lib/rbac/roles.ts).
--
-- Rollback:
--   grant select on public.projects to authenticated;
--
-- Follow-up: same as 0100 — every future migration that adds a column to
--            `public.projects` MUST re-run the DO block or the new column
--            is silently invisible to user-JWT reads.

begin;

-- 1. Revoke the blanket table-level SELECT.
revoke select on public.projects from authenticated;

-- 2. Re-grant column-level SELECT for every non-sensitive column. Reads
--    `information_schema` at migration time, so future migrations that
--    only add columns to `projects` (without regenerating this grant)
--    will make those columns invisible — an intentional
--    fail-closed default that's easy to fix (just re-run this block).
do $$
declare
  col text;
  col_list text := '';
  blocklist text[] := array['contract_value'];
begin
  for col in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
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
    'grant select (%s) on public.projects to authenticated',
    col_list
  );
end $$;

-- 3. Service role retains full SELECT. Legit consumers switch to the
--    service-role client after a PDP / capability check.
grant select on public.projects to service_role;

-- 4. Documentation on the sensitive column.
comment on column public.projects.contract_value is
  'IDR total contract value (rules §3 commercial data). SELECT privilege '
  'REVOKED from `authenticated` in migration 0102 — legit readers '
  '(project detail edit sheet, portfolio report, AI project_info tool) '
  'MUST use the service-role Supabase client after `is_finance_leader()` '
  'or `CONTRACT_VIEWER_ROLES` authorization. Adding a new column to '
  '`projects`? Re-run the DO block in 0102 (or explicitly grant the new '
  'column) or it will be invisible to user-JWT queries.';

commit;
