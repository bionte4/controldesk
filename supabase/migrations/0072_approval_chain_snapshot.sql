-- =========================================================================
-- 0072 — Approval chain snapshotting for per-tenant thresholds (Option B).
--
-- Adds `chain_snapshot jsonb` to every table whose row's approval chain is
-- derived from a monetary amount + the tenant's effective thresholds. Once
-- an approver-track item is submitted, the resolved chain is stamped into
-- this column so subsequent admin edits to `approval_thresholds` do NOT
-- retroactively re-route in-flight items. See rules §9 / §17 / §22.
--
-- Schema shape (JSONB):
--   {
--     "slots":       ["PM", "FINANCE", "DIRECTOR"],  // canonical slot names
--     "thresholds":  {                                // effective values at submit
--       "PM_THRESHOLD":       5000000,
--       "DIRECTOR_THRESHOLD": 50000000
--       // ... (kind-specific)
--     },
--     "snapshot_at": "2026-08-09T13:00:00+07:00",
--     "kind":        "EXPENSE" | "BUDGET" | "CASH_ADVANCE_GENERAL" |
--                    "CASH_ADVANCE_FIELD_OPS" | "BUDGET_REQUEST"
--   }
--
-- Existing rows: `chain_snapshot` is NULL. Callers reading historical rows
-- can either (a) fall back to a live re-compute via the state helper, or
-- (b) treat NULL as "legacy default" and show a small "computed" hint in
-- the UI. Either is safe because pre-B rows were routed on the default
-- thresholds and no override existed at their submit time.
--
-- Rollback:
--   alter table public.project_expenses  drop column if exists chain_snapshot;
--   alter table public.cash_advances     drop column if exists chain_snapshot;
--   alter table public.budgets           drop column if exists chain_snapshot;
--   alter table public.budget_requests   drop column if exists chain_snapshot;
-- =========================================================================

-- project_expenses
alter table public.project_expenses
  add column if not exists chain_snapshot jsonb;

comment on column public.project_expenses.chain_snapshot is
  'Frozen approval chain resolved at submit time. Shape: { slots[], thresholds{}, snapshot_at, kind }. NULL for pre-migration rows and DRAFTs. See migration 0072.';

-- cash_advances
alter table public.cash_advances
  add column if not exists chain_snapshot jsonb;

comment on column public.cash_advances.chain_snapshot is
  'Frozen approval chain resolved at submit time. Shape: { slots[], thresholds{}, snapshot_at, kind }. NULL for pre-migration rows and DRAFTs. See migration 0072.';

-- budgets
alter table public.budgets
  add column if not exists chain_snapshot jsonb;

comment on column public.budgets.chain_snapshot is
  'Frozen approval chain resolved at submit time. Shape: { slots[], thresholds{}, snapshot_at, kind }. NULL for pre-migration rows and DRAFTs. See migration 0072.';

-- budget_requests
alter table public.budget_requests
  add column if not exists chain_snapshot jsonb;

comment on column public.budget_requests.chain_snapshot is
  'Frozen approval chain resolved at submit time. Shape: { slots[], thresholds{}, snapshot_at, kind }. NULL for pre-migration rows and DRAFTs. See migration 0072.';

-- Optional GIN index on chain_snapshot->'slots' for future reporting queries
-- like "which items are pending Director this quarter". Kept minimal to
-- avoid write amplification on high-throughput approval tables.
create index if not exists project_expenses_chain_slots_idx
  on public.project_expenses using gin ((chain_snapshot -> 'slots'));

create index if not exists cash_advances_chain_slots_idx
  on public.cash_advances using gin ((chain_snapshot -> 'slots'));

create index if not exists budgets_chain_slots_idx
  on public.budgets using gin ((chain_snapshot -> 'slots'));

create index if not exists budget_requests_chain_slots_idx
  on public.budget_requests using gin ((chain_snapshot -> 'slots'));
