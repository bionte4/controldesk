-- Migration: 0063_evaluation_final_period_kesimpulan.sql
-- Purpose : Support the "Penilaian Akhir / Keputusan Pengangkatan"
--           section of the PKWT quarterly evaluation form. Adds:
--             1) `is_final_period` flag on `performance_evaluations` so
--                the UI knows to surface the kesimpulan card + expanded
--                recommendation dropdown.
--             2) Two additional values on the `contract_recommendation`
--                enum that match the three kesimpulan checkboxes in the
--                paper form (angkat tetap / perpanjang 3 bulan /
--                tidak diperpanjang).
--
--          The existing enum values (`EXTEND`, `EXTEND_WITH_COACHING`,
--          `NOT_EXTEND`) are kept for backwards compatibility with
--          rows already written by the previous flow.
--
-- Rollback :
--   alter table public.performance_evaluations
--     drop column if exists is_final_period;
--   -- Note: Postgres does not support removing enum values without
--   -- rebuilding the type. Rollback for enum additions is a manual
--   -- operation; only run if strictly necessary.

alter table public.performance_evaluations
  add column if not exists is_final_period boolean not null default false;

comment on column public.performance_evaluations.is_final_period is
  'True when this quarterly evaluation is the final one before the PKWT contract decision. Drives the kesimpulan card + expanded recommendation dropdown in the UI.';

-- ---------------------------------------------------------------------
-- Enum additions — new semantic values matching the paper form.
--   EXTEND_PERMANENT : "Direkomendasikan untuk diangkat sebagai karyawan tetap"
--   EXTEND_PKWT_3M   : "Diperpanjang masa PKWT-nya selama 3 bulan"
-- Legacy value semantics for backwards-compat:
--   EXTEND               ≈ EXTEND_PERMANENT (pre-0063)
--   EXTEND_WITH_COACHING ≈ EXTEND_PKWT_3M   (pre-0063)
--   NOT_EXTEND           = same as before (tidak direkomendasikan / terminate)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'contract_recommendation'
      and e.enumlabel = 'EXTEND_PERMANENT'
  ) then
    alter type public.contract_recommendation add value 'EXTEND_PERMANENT';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'contract_recommendation'
      and e.enumlabel = 'EXTEND_PKWT_3M'
  ) then
    alter type public.contract_recommendation add value 'EXTEND_PKWT_3M';
  end if;
end $$;
