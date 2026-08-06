-- ControlDesk — 0027_cash_advance_gas_align.sql
-- Fase 1 slice 5 — GAS-aligned Cash Advance (rules §9.3, §9.4, §11 canonical).
--
-- Design (additive, no changes to legacy `cash_advances` rows):
--   1. New enum `cash_advance_type` — GENERAL vs FIELD_OPS. Legacy rows
--      backfilled to GENERAL.
--   2. New canonical status values appended to `cash_advance_status`:
--        - PENDING_SUPERVISOR   (field-ops rung 0)
--        - PENDING_PM           (canonical PM tier)
--        - PENDING_OM           (field-ops mid tier)
--        - PENDING_FINANCE      (canonical Finance gate)
--        - PENDING_DIRECTOR     (canonical Director tier)
--      Legacy `PENDING_L*` values remain valid so in-flight rows continue
--      to move through the old state machine until they terminate.
--   3. New columns on `cash_advances`:
--        - `ca_type` (default 'GENERAL')
--        - Canonical audit stamps: pm_approved_at/_by, om_approved_at/_by,
--          supervisor_approved_at/_by, director_approved_at/_by.
--   4. Extends the `ca_pending_idx` partial index to cover the new
--      canonical PENDING_* values so approvals-inbox queries stay fast.
--   5. RLS unchanged (still `tenant_id = current_tenant_id()`) — the
--      state-machine layer in TS decides which flow to run.
--
-- Rollback:
--   ALTER TABLE public.cash_advances
--     DROP COLUMN IF EXISTS supervisor_approved_at,
--     DROP COLUMN IF EXISTS supervisor_approver_id,
--     DROP COLUMN IF EXISTS pm_approved_at,
--     DROP COLUMN IF EXISTS pm_approver_id,
--     DROP COLUMN IF EXISTS om_approved_at,
--     DROP COLUMN IF EXISTS om_approver_id,
--     DROP COLUMN IF EXISTS director_approved_at,
--     DROP COLUMN IF EXISTS director_approver_id,
--     DROP COLUMN IF EXISTS ca_type;
--   DROP TYPE IF EXISTS public.cash_advance_type;
--   -- Enum values cannot be dropped in Postgres. Leave PENDING_* canonical
--   -- values in `cash_advance_status`; they'll be unused after rollback.

-- ---------------------------------------------------------------------------
-- 1. cash_advance_type enum.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'cash_advance_type') then
    create type public.cash_advance_type as enum (
      'GENERAL',
      'FIELD_OPS'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Append canonical status values to the existing enum.
--    ALTER TYPE ... ADD VALUE is idempotent since PG 12 via IF NOT EXISTS.
-- ---------------------------------------------------------------------------
alter type public.cash_advance_status add value if not exists 'PENDING_SUPERVISOR';
alter type public.cash_advance_status add value if not exists 'PENDING_PM';
alter type public.cash_advance_status add value if not exists 'PENDING_OM';
alter type public.cash_advance_status add value if not exists 'PENDING_FINANCE';
alter type public.cash_advance_status add value if not exists 'PENDING_DIRECTOR';

-- ---------------------------------------------------------------------------
-- 3. Add columns to `cash_advances`.
-- ---------------------------------------------------------------------------
alter table public.cash_advances
  add column if not exists ca_type public.cash_advance_type
    not null default 'GENERAL';

alter table public.cash_advances
  add column if not exists supervisor_approved_at timestamptz,
  add column if not exists supervisor_approver_id uuid
    references public.employees(id) on delete set null,
  add column if not exists pm_approved_at timestamptz,
  add column if not exists pm_approver_id uuid
    references public.employees(id) on delete set null,
  add column if not exists om_approved_at timestamptz,
  add column if not exists om_approver_id uuid
    references public.employees(id) on delete set null,
  add column if not exists director_approved_at timestamptz,
  add column if not exists director_approver_id uuid
    references public.employees(id) on delete set null;

comment on column public.cash_advances.ca_type is
  'GENERAL (default) or FIELD_OPS. Drives the canonical approval chain (rules §9.3 / §9.4).';
comment on column public.cash_advances.supervisor_approved_at is
  'Canonical CA — set when a Supervisor approved the FIELD_OPS rung.';
comment on column public.cash_advances.pm_approved_at is
  'Canonical CA — set when a PM approved (both GENERAL and FIELD_OPS chains).';
comment on column public.cash_advances.om_approved_at is
  'Canonical CA — set when an OM approved (FIELD_OPS only).';
comment on column public.cash_advances.director_approved_at is
  'Canonical CA — set when a Director approved (high-value tier).';

-- Stamp pairs must be set together (mirrors the legacy `_stamps_together`
-- constraints so audit rows stay consistent).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ca_supervisor_stamps_together'
  ) then
    alter table public.cash_advances
      add constraint ca_supervisor_stamps_together
      check ( (supervisor_approved_at is null) = (supervisor_approver_id is null) );
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'ca_pm_stamps_together'
  ) then
    alter table public.cash_advances
      add constraint ca_pm_stamps_together
      check ( (pm_approved_at is null) = (pm_approver_id is null) );
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'ca_om_stamps_together'
  ) then
    alter table public.cash_advances
      add constraint ca_om_stamps_together
      check ( (om_approved_at is null) = (om_approver_id is null) );
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'ca_director_stamps_together'
  ) then
    alter table public.cash_advances
      add constraint ca_director_stamps_together
      check ( (director_approved_at is null) = (director_approver_id is null) );
  end if;
end $$;

-- Fast filter for the new type column (portfolio / dashboard queries).
create index if not exists ca_tenant_type_idx
  on public.cash_advances (tenant_id, ca_type, status);

-- ---------------------------------------------------------------------------
-- NOTE: The `ca_pending_idx` partial index needs to reference the newly-
-- added enum values, but Postgres forbids "unsafe use of new value" of
-- an enum in the same transaction that added it. The index refresh is
-- therefore split into a follow-up migration (0028_cash_advance_index_refresh.sql).
-- ---------------------------------------------------------------------------
