-- =============================================================================
-- 0044 — Expenses form upgrade (rules §9 · Value-based approval).
--
-- Reshapes the expense-submission surface to match the target mockup:
--
--   1. `budget_details` becomes the source-of-truth for "MA (budget line)".
--      Adds an optional user-facing `code` column so Finance can label lines
--      as "5.1.1 Travel", "MA-2026-004", etc. Only lines whose parent
--      `budgets.status` ∈ {DRAFT, PENDING_FINANCE, PENDING_DIRECTOR, APPROVED}
--      are eligible (the app layer filters).
--
--   2. New enum `expense_payment_method` (BANK_TRANSFER / CASH /
--      REIMBURSEMENT / CORPORATE_CARD).
--
--   3. `project_expenses` gains:
--        - `budget_detail_id uuid`  → FK to budget_details.id (nullable to
--          keep existing rows valid).
--        - `payment_method`         → enum, nullable (drafts may skip it).
--        - `notes text`             → optional reviewer context (separate
--          from `description`).
--        - `submitted_at timestamptz` → stamped when DRAFT → PENDING_L1
--          (drives the "days-in-flight" metric).
--        - `receipt_url` stays for backwards compat but is deprecated —
--          new UI uses the `attachments` table (rules §19).
--
--   4. Convenience view `v_project_budget_lines` — joins budget_details with
--      its parent budget so the app can query "eligible MA lines for
--      project X" in one round-trip.
--
--   5. FK on `attachments.resource_type = 'project_expense'` — no schema
--      change (attachments is polymorphic by `resource_type + resource_id`).
--      Documented here for reference.
--
-- Rollback:
--   drop view if exists public.v_project_budget_lines;
--   alter table public.project_expenses drop column if exists budget_detail_id;
--   alter table public.project_expenses drop column if exists payment_method;
--   alter table public.project_expenses drop column if exists notes;
--   alter table public.project_expenses drop column if exists submitted_at;
--   alter table public.budget_details drop column if exists code;
--   drop type if exists public.expense_payment_method;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. expense_payment_method enum.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'expense_payment_method') then
    create type public.expense_payment_method as enum (
      'BANK_TRANSFER',
      'CASH',
      'REIMBURSEMENT',
      'CORPORATE_CARD'
    );
  end if;
end$$;

comment on type public.expense_payment_method is
  'How the expense is (or will be) paid. Nullable at DRAFT stage; required by app layer at SUBMIT time.';

-- ---------------------------------------------------------------------------
-- 2. budget_details.code — user-facing MA identifier.
-- ---------------------------------------------------------------------------
alter table public.budget_details
  add column if not exists code text;

comment on column public.budget_details.code is
  'User-facing MA code (e.g. "5.1.1", "MA-2026-004"). Nullable — falls back to seq in the UI.';

-- Keep the (tenant, budget, code) combo unique when code is set. Two lines
-- with a NULL code are allowed.
create unique index if not exists budget_details_tenant_budget_code_uniq
  on public.budget_details (tenant_id, budget_id, code)
  where code is not null;

-- ---------------------------------------------------------------------------
-- 3. project_expenses — new columns.
-- ---------------------------------------------------------------------------
alter table public.project_expenses
  add column if not exists budget_detail_id uuid references public.budget_details(id) on delete set null,
  add column if not exists payment_method   public.expense_payment_method,
  add column if not exists notes            text,
  add column if not exists submitted_at     timestamptz;

comment on column public.project_expenses.budget_detail_id is
  'MA (budget line) this expense charges against. Nullable so DRAFT rows can be saved incrementally; app layer requires it at SUBMIT.';
comment on column public.project_expenses.payment_method is
  'Payment channel selected by the submitter. Nullable at DRAFT.';
comment on column public.project_expenses.notes is
  'Optional reviewer-facing context. Longer than `description`; not searched.';
comment on column public.project_expenses.submitted_at is
  'Set when the row transitions DRAFT → PENDING_L1_SUPERVISOR. Powers the "days waiting" KPI.';

create index if not exists project_expenses_budget_detail_idx
  on public.project_expenses (budget_detail_id)
  where budget_detail_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Eligibility view — budget_details for active budgets, joined with the
--    parent budget for status filtering.
-- ---------------------------------------------------------------------------
create or replace view public.v_project_budget_lines as
select
  bd.id                       as budget_detail_id,
  bd.tenant_id,
  bd.budget_id,
  b.project_id,
  b.fiscal_year,
  b.status                    as budget_status,
  bd.seq,
  bd.code,
  bd.category,
  bd.description,
  bd.planned_amount,
  bd.realized_amount,
  bd.outstanding_amount,
  bd.remaining_amount,
  bd.created_at
from public.budget_details bd
join public.budgets b on b.id = bd.budget_id and b.tenant_id = bd.tenant_id;

comment on view public.v_project_budget_lines is
  'Per-tenant budget lines with parent budget status. App layer filters to budgets in {DRAFT, PENDING_FINANCE, PENDING_DIRECTOR, APPROVED} when populating the MA dropdown on the expense form.';

grant select on public.v_project_budget_lines to authenticated;
