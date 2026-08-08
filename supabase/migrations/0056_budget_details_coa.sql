-- =============================================================================
-- 0056 — Wire budget line items (Mata Anggaran) to the Chart of Accounts.
--
-- Fase 2 of the CoA rollout. Adds a nullable FK on `budget_details.coa_id`
-- so PM/Finance can classify every MA line to a postable GL account when
-- they build the budget. The column is nullable in this migration because:
--
--   • Existing rows have no CoA — nulling by default keeps them valid.
--   • The dropdown surface won't roll out to every tenant at the same
--     time — we want status-quo tenants to keep working while adopters
--     onboard.
--   • Server-side enforcement (block SUBMIT with any null coa_id) can be
--     added later without a schema change, once every active budget has
--     been reviewed.
--
-- Index is partial (only rows with coa_id) so we get lookup speed for
-- "what MA lines charge account X" queries without paying for the null
-- majority.
--
-- Rollback:
--   drop index if exists public.budget_details_coa_idx;
--   alter table public.budget_details drop column if exists coa_id;
-- =============================================================================

alter table public.budget_details
  add column if not exists coa_id uuid
    references public.chart_of_accounts(id) on delete set null;

comment on column public.budget_details.coa_id is
  'FK to chart_of_accounts. Nullable during rollout — server actions '
  'may require it at SUBMIT once every tenant has curated their CoA. '
  'ON DELETE SET NULL so deactivating a CoA account (soft delete) '
  'never breaks a historic budget line.';

create index if not exists budget_details_coa_idx
  on public.budget_details (coa_id)
  where coa_id is not null;
