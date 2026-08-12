-- =============================================================================
-- 0057 — Wire Chart of Accounts to the expense / CA / petty-cash tables
--        (Fase 3 of the CoA rollout).
--
-- Adds a nullable `coa_id` FK on every financial mutation row so callers
-- can classify their transaction to a postable GL account at capture time.
-- Nullable stays for the same reason as `budget_details.coa_id` (migration
-- 0056): existing rows have no CoA, and CoA adoption is per-tenant.
--
-- Tables touched:
--   • project_expenses       — one expense = one GL account
--   • cash_advances          — General CA classified at header level (line
--                              items on `cash_advance_line_items` inherit
--                              this account by default; can override per
--                              line later if needed)
--   • cash_advance_rab_lines — Field Ops RAB lines each get their own
--                              account because Transport / Konsumsi /
--                              Akomodasi typically map to different GLs
--   • petty_cash_vouchers    — one voucher = one GL account
--
-- Every column:
--   • uuid FK to public.chart_of_accounts(id)
--   • ON DELETE SET NULL so soft-deactivating a CoA never breaks history
--   • Partial index (coa_id is not null) for future "expenses by account"
--     analytics without paying the null-majority cost.
--
-- Rollback:
--   drop index if exists public.project_expenses_coa_idx;
--   drop index if exists public.cash_advances_coa_idx;
--   drop index if exists public.cash_advance_rab_lines_coa_idx;
--   drop index if exists public.petty_cash_vouchers_coa_idx;
--   alter table public.project_expenses       drop column if exists coa_id;
--   alter table public.cash_advances          drop column if exists coa_id;
--   alter table public.cash_advance_rab_lines drop column if exists coa_id;
--   alter table public.petty_cash_vouchers    drop column if exists coa_id;
-- =============================================================================

alter table public.project_expenses
  add column if not exists coa_id uuid
    references public.chart_of_accounts(id) on delete set null;

comment on column public.project_expenses.coa_id is
  'FK to chart_of_accounts. Nullable during rollout — server actions may '
  'require it at SUBMIT once tenants have curated their CoA.';

create index if not exists project_expenses_coa_idx
  on public.project_expenses (coa_id)
  where coa_id is not null;

-- -----------------------------------------------------------------

alter table public.cash_advances
  add column if not exists coa_id uuid
    references public.chart_of_accounts(id) on delete set null;

comment on column public.cash_advances.coa_id is
  'FK to chart_of_accounts. For General CA this classifies the entire '
  'advance at header level. For Field Ops CA, per-line accounts on '
  'cash_advance_rab_lines take precedence — this column stays optional '
  'to mirror the settlement-level rollup.';

create index if not exists cash_advances_coa_idx
  on public.cash_advances (coa_id)
  where coa_id is not null;

-- -----------------------------------------------------------------

alter table public.cash_advance_rab_lines
  add column if not exists coa_id uuid
    references public.chart_of_accounts(id) on delete set null;

comment on column public.cash_advance_rab_lines.coa_id is
  'FK to chart_of_accounts. Each Field Ops RAB row can map to a different '
  'GL account (Transportasi → 5301, Akomodasi → 5302, Konsumsi → 5303).';

create index if not exists cash_advance_rab_lines_coa_idx
  on public.cash_advance_rab_lines (coa_id)
  where coa_id is not null;

-- -----------------------------------------------------------------

alter table public.petty_cash_vouchers
  add column if not exists coa_id uuid
    references public.chart_of_accounts(id) on delete set null;

comment on column public.petty_cash_vouchers.coa_id is
  'FK to chart_of_accounts. One voucher classifies one spend (e.g. ATK → '
  '5902, Bensin → 5304).';

create index if not exists petty_cash_vouchers_coa_idx
  on public.petty_cash_vouchers (coa_id)
  where coa_id is not null;
