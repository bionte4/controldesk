-- =============================================================================
-- Migration 0030 — Budget Requests module (Fase 2, GAS §29, rules §9.6).
--
-- Budget mutations after the parent `budgets` row is APPROVED go through
-- this request table (Increase / Decrease / Transfer). On APPROVED → APPLIED,
-- the app-layer executes an atomic patch of `budget_details.planned_amount`
-- (and rolls up `budgets.total_planned_amount`).
--
-- State machine (rules §9.6, threshold matrix in `roles.ts`):
--
--   DRAFT
--     └ SUBMIT ─► [PENDING_PM]? ─► PENDING_FINANCE ─► [PENDING_DIRECTOR]?
--                                                     └► APPROVED ─► APPLIED
--   any pending state also → REJECTED / CANCELLED (terminal).
--
-- Threshold gating (from APPROVAL_CONFIG.BUDGET_REQUEST):
--   amount ≥ PM_THRESHOLD           → include PENDING_PM
--   FINANCE                          → always included
--   amount ≥ DIRECTOR_THRESHOLD     → include PENDING_DIRECTOR
--
-- Kinds:
--   INCREASE  — add funds to one detail line.
--   DECREASE  — release funds from one detail line.
--   TRANSFER  — shift funds between two detail lines (net zero).
--
-- Rollback:
--   drop trigger if exists budget_request_approval_logs_immutable on public.budget_request_approval_logs;
--   drop function if exists public.budget_request_approval_logs_immutable();
--   drop table if exists public.budget_request_approval_logs;
--   drop table if exists public.budget_request_lines;
--   drop table if exists public.budget_requests;
--   drop type if exists public.budget_request_kind;
--   drop type if exists public.budget_request_status;
--   drop type if exists public.budget_request_line_direction;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enums.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'budget_request_kind') then
    create type public.budget_request_kind as enum (
      'INCREASE',
      'DECREASE',
      'TRANSFER'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'budget_request_status') then
    create type public.budget_request_status as enum (
      'DRAFT',
      'PENDING_PM',
      'PENDING_FINANCE',
      'PENDING_DIRECTOR',
      'APPROVED',
      'APPLIED',
      'REJECTED',
      'CANCELLED'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'budget_request_line_direction') then
    -- Only meaningful for TRANSFER: FROM = debit, TO = credit. For
    -- INCREASE / DECREASE the request has a single line and direction is
    -- 'TO' (INCREASE) or 'FROM' (DECREASE).
    create type public.budget_request_line_direction as enum (
      'FROM',
      'TO'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. budget_requests — header row per pending mutation.
-- ---------------------------------------------------------------------------
create table if not exists public.budget_requests (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  budget_id               uuid not null references public.budgets(id) on delete restrict,
  requester_employee_id   uuid not null references public.employees(id) on delete restrict,
  kind                    public.budget_request_kind not null,
  -- Net absolute amount involved (drives threshold routing). For TRANSFER
  -- this equals the amount being shifted; for INCREASE / DECREASE it equals
  -- the single line delta.
  amount                  numeric(18, 2) not null check (amount > 0),
  currency                char(3) not null default 'IDR' check (currency = 'IDR'),
  justification           text not null,
  status                  public.budget_request_status not null default 'DRAFT',
  -- Chain slot stamps.
  pm_approved_at          timestamptz,
  pm_approver_id          uuid references public.employees(id) on delete set null,
  finance_approved_at     timestamptz,
  finance_approver_id     uuid references public.employees(id) on delete set null,
  director_approved_at    timestamptz,
  director_approver_id    uuid references public.employees(id) on delete set null,
  approved_at             timestamptz,
  applied_at              timestamptz,
  applied_by              uuid references public.employees(id) on delete set null,
  rejected_at             timestamptz,
  rejected_by             uuid references public.employees(id) on delete set null,
  rejection_reason        text,
  cancelled_at            timestamptz,
  cancelled_by            uuid references public.employees(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint br_justification_min_len
    check (length(trim(justification)) >= 20),
  constraint br_pm_stamps_together
    check ((pm_approved_at is null) = (pm_approver_id is null)),
  constraint br_finance_stamps_together
    check ((finance_approved_at is null) = (finance_approver_id is null)),
  constraint br_director_stamps_together
    check ((director_approved_at is null) = (director_approver_id is null)),
  constraint br_reject_stamps_together
    check ((rejected_at is null) = (rejected_by is null)),
  constraint br_apply_stamps_together
    check ((applied_at is null) = (applied_by is null)),
  constraint br_cancel_stamps_together
    check ((cancelled_at is null) = (cancelled_by is null))
);

comment on table public.budget_requests is
  'GAS §29 budget mutation requests (Increase/Decrease/Transfer). Approved requests are APPLIED to `budget_details.planned_amount` in an atomic transaction. Threshold matrix in APPROVAL_CONFIG.BUDGET_REQUEST (rules §9.6).';

create index if not exists budget_requests_tenant_budget_idx
  on public.budget_requests (tenant_id, budget_id, created_at desc);

create index if not exists budget_requests_tenant_status_idx
  on public.budget_requests (tenant_id, status);

create index if not exists budget_requests_tenant_requester_idx
  on public.budget_requests (tenant_id, requester_employee_id, created_at desc);

-- Approver inbox partial index — mirrors the pattern used by cash advances.
create index if not exists budget_requests_pending_idx
  on public.budget_requests (tenant_id, status)
  where status in ('PENDING_PM', 'PENDING_FINANCE', 'PENDING_DIRECTOR');

drop trigger if exists budget_requests_set_updated_at on public.budget_requests;
create trigger budget_requests_set_updated_at
  before update on public.budget_requests
  for each row execute function public.set_updated_at();

alter table public.budget_requests enable row level security;

-- SELECT: any employee of the tenant may read (approver views + audit).
drop policy if exists budget_requests_tenant_read on public.budget_requests;
create policy budget_requests_tenant_read
  on public.budget_requests
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- INSERT: requester must belong to the tenant. Assignment-level check is
-- app-side (via PDP `budget_request` create → decideBudgetRequest).
drop policy if exists budget_requests_insert on public.budget_requests;
create policy budget_requests_insert
  on public.budget_requests
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1 from public.employees me
      where me.user_id = auth.uid()
        and me.id = requester_employee_id
        and me.tenant_id = budget_requests.tenant_id
        and me.is_active
    )
  );

-- UPDATE: any tenant employee — Server Actions enforce role + state gate.
drop policy if exists budget_requests_update on public.budget_requests;
create policy budget_requests_update
  on public.budget_requests
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- DELETE: never — requests are CANCELLED, not deleted. Default deny.

-- ---------------------------------------------------------------------------
-- 3. budget_request_lines — the actual mutation payload.
--    INCREASE / DECREASE: exactly ONE row.
--    TRANSFER:            exactly TWO rows (one FROM, one TO); the sum of
--                         delta_amount for FROM and TO must equal zero.
-- ---------------------------------------------------------------------------
create table if not exists public.budget_request_lines (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  budget_request_id     uuid not null references public.budget_requests(id) on delete cascade,
  budget_detail_id      uuid not null references public.budget_details(id) on delete restrict,
  direction             public.budget_request_line_direction not null,
  -- Positive on TO (credit / increase planned) and INCREASE lines;
  -- positive on DECREASE (release); absolute — the app-layer flips sign
  -- when applying based on `direction`.
  delta_amount          numeric(18, 2) not null check (delta_amount > 0),
  created_at            timestamptz not null default now(),
  constraint brl_unique_role_per_request
    unique (budget_request_id, budget_detail_id, direction)
);

comment on table public.budget_request_lines is
  'Per-line delta of a budget request. TRANSFER rows come in FROM/TO pairs whose delta_amount must be equal. INCREASE = single TO line; DECREASE = single FROM line. Enforced app-side.';

create index if not exists budget_request_lines_tenant_request_idx
  on public.budget_request_lines (tenant_id, budget_request_id);

alter table public.budget_request_lines enable row level security;

drop policy if exists budget_request_lines_tenant_read on public.budget_request_lines;
create policy budget_request_lines_tenant_read
  on public.budget_request_lines
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists budget_request_lines_insert on public.budget_request_lines;
create policy budget_request_lines_insert
  on public.budget_request_lines
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists budget_request_lines_update on public.budget_request_lines;
create policy budget_request_lines_update
  on public.budget_request_lines
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists budget_request_lines_delete on public.budget_request_lines;
create policy budget_request_lines_delete
  on public.budget_request_lines
  for delete
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- 4. budget_request_approval_logs — append-only audit trail.
--    Mirrors expense_approval_logs / cash_advance_approval_logs.
-- ---------------------------------------------------------------------------
create table if not exists public.budget_request_approval_logs (
  id                     bigint generated always as identity primary key,
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  budget_request_id      uuid not null references public.budget_requests(id) on delete cascade,
  actor_employee_id      uuid references public.employees(id) on delete set null,
  actor_role             public.employee_role,
  action                 public.approval_action not null,
  from_status            public.budget_request_status not null,
  to_status              public.budget_request_status not null,
  comment                text,
  created_at             timestamptz not null default now()
);

comment on table public.budget_request_approval_logs is
  'Append-only history of state transitions on budget_requests (rules §9.7).';

create index if not exists brl_al_tenant_request_idx
  on public.budget_request_approval_logs (tenant_id, budget_request_id, created_at desc);

create or replace function public.budget_request_approval_logs_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'budget_request_approval_logs is append-only'
    using errcode = '42501';
end;
$$;

drop trigger if exists budget_request_approval_logs_immutable
  on public.budget_request_approval_logs;
create trigger budget_request_approval_logs_immutable
  before update or delete on public.budget_request_approval_logs
  for each row execute function public.budget_request_approval_logs_immutable();

alter table public.budget_request_approval_logs enable row level security;

drop policy if exists brl_al_tenant_read on public.budget_request_approval_logs;
create policy brl_al_tenant_read
  on public.budget_request_approval_logs
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists brl_al_tenant_insert on public.budget_request_approval_logs;
create policy brl_al_tenant_insert
  on public.budget_request_approval_logs
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());
