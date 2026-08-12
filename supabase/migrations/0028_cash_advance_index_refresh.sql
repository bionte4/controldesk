-- ControlDesk — 0028_cash_advance_index_refresh.sql
-- Fase 1 slice 5b — companion to 0027_cash_advance_gas_align.sql.
--
-- Postgres forbids using freshly-added enum values inside the same
-- transaction as `ALTER TYPE ... ADD VALUE`, so the `ca_pending_idx`
-- refresh that references the new canonical PENDING_* statuses lives
-- in this separate migration.
--
-- Rollback:
--   drop index if exists public.ca_pending_idx;
--   create index ca_pending_idx
--     on public.cash_advances (tenant_id, status)
--     where status in (
--       'PENDING_L1_SUPERVISOR',
--       'PENDING_L2_PROJECT_MANAGER',
--       'PENDING_L2_5_FINANCE',
--       'PENDING_L3_OPERATIONS_MANAGER',
--       'PENDING_L4_HEAD_MANAGER',
--       'PENDING_L5_GENERAL_MANAGER',
--       'APPROVED'
--     );

drop index if exists public.ca_pending_idx;
create index ca_pending_idx
  on public.cash_advances (tenant_id, status)
  where status in (
    'PENDING_L1_SUPERVISOR',
    'PENDING_L2_PROJECT_MANAGER',
    'PENDING_L2_5_FINANCE',
    'PENDING_L3_OPERATIONS_MANAGER',
    'PENDING_L4_HEAD_MANAGER',
    'PENDING_L5_GENERAL_MANAGER',
    'PENDING_SUPERVISOR',
    'PENDING_PM',
    'PENDING_OM',
    'PENDING_FINANCE',
    'PENDING_DIRECTOR',
    'APPROVED'
  );
