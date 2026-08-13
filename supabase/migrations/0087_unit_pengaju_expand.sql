-- 0087_unit_pengaju_expand.sql
--
-- Broaden the `unit_pengaju` cost-centre tag beyond Field-Ops Cash
-- Advances so that Budgets, General Cash Advances, and Petty-Cash
-- Vouchers can also record which organisational unit bears the
-- spend. Downstream reporting can then aggregate a full P&L slice by
-- unit rather than mixing all Field-Ops entries in with generic
-- project expenses.
--
-- Scoping rules (enforced in the app layer, not here):
--   * `budgets`, `cash_advances` (General type)
--       → filtered by `public.project_allowed_units` when a project
--         has a whitelist (migration 0086). Empty whitelist = fall
--         back to the entire tenant `unit_pengaju` lookup.
--   * `petty_cash_vouchers`
--       → free choice from the tenant lookup. Petty-cash vouchers
--         are attributed to a `fund_id` (imprest location), NOT a
--         `project_id`, so `project_allowed_units` doesn't apply.
--         If a future release adds `project_id` to vouchers we can
--         extend the app filter without another migration.
--
-- The Field-Ops CA continues to write its `unit_pengaju` into the
-- 1:1 details table (`cash_advance_field_ops_details.unit_pengaju`,
-- migration 0048). Reports that need one query surface can `COALESCE`
-- the two columns; we intentionally do NOT copy Field-Ops values up
-- into the parent here to avoid a data-migration + double-write
-- concern on an already-shipping feature.
--
-- Rollback:
--   alter table public.petty_cash_vouchers  drop column if exists unit_pengaju;
--   alter table public.cash_advances        drop column if exists unit_pengaju;
--   alter table public.budgets              drop column if exists unit_pengaju;

alter table public.budgets
  add column if not exists unit_pengaju text
    check (unit_pengaju is null or length(trim(unit_pengaju)) > 0);

alter table public.cash_advances
  add column if not exists unit_pengaju text
    check (unit_pengaju is null or length(trim(unit_pengaju)) > 0);

alter table public.petty_cash_vouchers
  add column if not exists unit_pengaju text
    check (unit_pengaju is null or length(trim(unit_pengaju)) > 0);

comment on column public.budgets.unit_pengaju is
  'Optional cost-centre tag. Filtered by project_allowed_units when set at the parent project (migration 0086); otherwise any active tenant lookup label is valid.';

comment on column public.cash_advances.unit_pengaju is
  'Optional cost-centre tag. Used by General CA rows; Field-Ops CA rows continue to store this in cash_advance_field_ops_details.unit_pengaju for backward-compat.';

comment on column public.petty_cash_vouchers.unit_pengaju is
  'Optional cost-centre tag. Free-choice from the tenant unit_pengaju lookup — petty-cash vouchers are not project-scoped so project_allowed_units does not apply.';
