-- Migration: 0065_evaluation_extension_months.sql
-- Purpose : Simplify the SPV's PKWT recommendation to two paths:
--             1. `EXTEND`     — kontrak diperpanjang N bulan
--             2. `NOT_EXTEND` — tidak diperpanjang
--           The old three-option split (`EXTEND_PERMANENT`,
--           `EXTEND_PKWT_3M`, `NOT_EXTEND`) confused reviewers
--           because "3M" was hard-coded. We now let the SPV pick a
--           duration from a small allowlist (1, 2, 3, 6, 12 months)
--           and snapshot the new contract end date so downstream
--           finance / HR can update `employees.contract_end_date`
--           without re-computing.
--
-- Additions to `performance_evaluations`:
--   * `contract_extension_months` int      — 1/2/3/6/12 (nullable)
--   * `contract_extension_end_date` date   — snapshot at submit time
--
-- Legacy `contract_recommendation` enum values remain valid so
-- historical evaluations keep rendering. Only the *new* UI writes
-- `EXTEND` for extensions; legacy readers can still map
-- `EXTEND_PERMANENT` / `EXTEND_PKWT_3M` to a display label via
-- `canonicalRecommendation()` in `src/lib/validation/evaluation.ts`.
--
-- Rollback :
--   alter table public.performance_evaluations
--     drop column if exists contract_extension_months,
--     drop column if exists contract_extension_end_date;

alter table public.performance_evaluations
  add column if not exists contract_extension_months int,
  add column if not exists contract_extension_end_date date;

-- Allowlist enforced at DB layer as a defence-in-depth check on top of
-- the Zod schema. `null` is valid because non-extension evaluations
-- (or evaluations still in DRAFT) leave the field empty.
do $$ begin
  alter table public.performance_evaluations
    add constraint performance_evaluations_extension_months_check
    check (
      contract_extension_months is null
      or contract_extension_months in (1, 2, 3, 6, 12)
    );
exception when duplicate_object then null; end $$;

comment on column public.performance_evaluations.contract_extension_months is
  'When SPV recommends EXTEND, the duration in months (1/2/3/6/12). Null for NOT_EXTEND or drafts.';

comment on column public.performance_evaluations.contract_extension_end_date is
  'Snapshot of the new contract end date at submit time = employees.contract_end_date + contract_extension_months. Finance uses this to update employees on OM approve.';
