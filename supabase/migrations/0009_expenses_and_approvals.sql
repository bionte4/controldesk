-- ControlDesk — 0009_expenses_and_approvals.sql
-- Project expenses + threshold-matrix approval trail (rules §9).
--
-- Introduces:
--   1. expense_status enum (DRAFT → PENDING_L1 … PENDING_L5 → APPROVED / REJECTED)
--   2. approval_action enum
--   3. project_expenses table
--   4. expense_approval_logs table (append-only)
--   5. Helper: next_approval_level(amount_idr, current_status)
--
-- The state machine deliberately encodes the parallel Finance gate (L2.5) as
-- a *pre-condition* on advancement past L2 — the app-layer server action
-- checks that a `LEAD_FINANCE` log entry with action='APPROVE' exists before
-- allowing the L2 approver to advance to L3.

-- ---------------------------------------------------------------------------
-- 1. expense_status
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'expense_status') then
    create type public.expense_status as enum (
      'DRAFT',
      'PENDING_L1_SUPERVISOR',
      'PENDING_L2_PROJECT_MANAGER',
      'PENDING_L2_5_FINANCE',
      'PENDING_L3_OPERATIONS_MANAGER',
      'PENDING_L4_HEAD_MANAGER',
      'PENDING_L5_GENERAL_MANAGER',
      'APPROVED',
      'REJECTED',
      'CANCELLED'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. approval_action
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'approval_action') then
    create type public.approval_action as enum (
      'SUBMIT',
      'APPROVE',
      'REJECT',
      'CANCEL',
      'FINANCE_APPROVE',
      'FINANCE_REJECT'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. project_expenses — one row per reimbursement / operational spend request.
-- ---------------------------------------------------------------------------
create table if not exists public.project_expenses (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  project_id              uuid not null references public.projects(id) on delete restrict,
  submitter_employee_id   uuid not null references public.employees(id) on delete restrict,
  amount                  numeric(18,2) not null check (amount > 0),
  currency                char(3) not null default 'IDR' check (currency = 'IDR'),
  category                text not null,       -- e.g. 'TRAVEL', 'ONSITE_MEAL', 'IT_SUPPLIES'
  description             text not null,
  incurred_on             date not null,
  receipt_url             text,
  status                  public.expense_status not null default 'DRAFT',
  finance_approved_at     timestamptz,         -- parallel gate stamp
  finance_approver_id     uuid references public.employees(id) on delete set null,
  final_approved_at       timestamptz,
  final_approver_id       uuid references public.employees(id) on delete set null,
  rejected_at             timestamptz,
  rejected_by             uuid references public.employees(id) on delete set null,
  rejection_reason        text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint expenses_description_not_blank check (length(trim(description)) > 0),
  constraint expenses_reject_stamps_together check (
    (rejected_at is null) = (rejected_by is null)
  )
);

comment on table public.project_expenses is
  'Project expenses. State transitions handled by src/app/(app)/finance/expenses/actions.ts (rules §9).';

create index if not exists project_expenses_tenant_status_idx
  on public.project_expenses (tenant_id, status);
create index if not exists project_expenses_tenant_project_idx
  on public.project_expenses (tenant_id, project_id, status);
create index if not exists project_expenses_tenant_submitter_idx
  on public.project_expenses (tenant_id, submitter_employee_id, created_at desc);
create index if not exists project_expenses_pending_idx
  on public.project_expenses (tenant_id, status)
  where status in (
    'PENDING_L1_SUPERVISOR',
    'PENDING_L2_PROJECT_MANAGER',
    'PENDING_L2_5_FINANCE',
    'PENDING_L3_OPERATIONS_MANAGER',
    'PENDING_L4_HEAD_MANAGER',
    'PENDING_L5_GENERAL_MANAGER'
  );

drop trigger if exists project_expenses_set_updated_at on public.project_expenses;
create trigger project_expenses_set_updated_at
  before update on public.project_expenses
  for each row execute function public.set_updated_at();

alter table public.project_expenses enable row level security;

-- SELECT: any employee of the tenant may read (RSC needs this for approver
-- inbox); column-level guards belong in the API layer.
drop policy if exists expenses_tenant_read on public.project_expenses;
create policy expenses_tenant_read
  on public.project_expenses
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- INSERT: submitter must belong to the tenant + be active in the project.
drop policy if exists expenses_submitter_insert on public.project_expenses;
create policy expenses_submitter_insert
  on public.project_expenses
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.is_assigned_to_project(project_id)
    and exists (
      select 1 from public.employees me
      where me.user_id = auth.uid()
        and me.id = submitter_employee_id
        and me.tenant_id = project_expenses.tenant_id
        and me.is_active
    )
  );

-- UPDATE: allowed for any tenant employee — the server actions enforce
-- the state-machine + role gating. RLS just prevents cross-tenant writes.
drop policy if exists expenses_tenant_update on public.project_expenses;
create policy expenses_tenant_update
  on public.project_expenses
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- DELETE: never — expenses are cancelled, not deleted.
-- (no policy → default deny)

-- ---------------------------------------------------------------------------
-- 4. expense_approval_logs — immutable audit trail for the state machine.
-- ---------------------------------------------------------------------------
create table if not exists public.expense_approval_logs (
  id                      bigint generated always as identity primary key,
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  expense_id              uuid not null references public.project_expenses(id) on delete cascade,
  actor_employee_id       uuid references public.employees(id) on delete set null,
  actor_role              public.employee_role,
  action                  public.approval_action not null,
  from_status             public.expense_status not null,
  to_status               public.expense_status not null,
  comment                 text,
  created_at              timestamptz not null default now()
);

comment on table public.expense_approval_logs is
  'Append-only history of state transitions on project_expenses. Powers the timeline UI.';

create index if not exists expense_approval_logs_expense_idx
  on public.expense_approval_logs (tenant_id, expense_id, created_at desc);

-- Immutable — trigger-enforced.
create or replace function public.expense_approval_logs_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'expense_approval_logs is append-only'
    using errcode = '42501';
end;
$$;

drop trigger if exists eal_no_update on public.expense_approval_logs;
create trigger eal_no_update
  before update or delete on public.expense_approval_logs
  for each row execute function public.expense_approval_logs_immutable();

alter table public.expense_approval_logs enable row level security;

drop policy if exists eal_tenant_read on public.expense_approval_logs;
create policy eal_tenant_read
  on public.expense_approval_logs
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists eal_tenant_insert on public.expense_approval_logs;
create policy eal_tenant_insert
  on public.expense_approval_logs
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- 5. next_approval_level(amount_idr, current) — threshold matrix helper.
--
-- Kept as a SQL function so Postgres migrations / ad-hoc admin scripts can
-- verify the routing without touching TypeScript. The canonical implementation
-- for the app is src/lib/rbac/roles.ts::requiredApprovalChain().
-- ---------------------------------------------------------------------------
create or replace function public.next_expense_status(
  p_amount numeric,
  p_current public.expense_status
)
returns public.expense_status
language plpgsql
immutable
as $$
declare
  requires_l3 boolean := p_amount > 5000000;
  requires_l4 boolean := p_amount > 25000000;
  requires_l5 boolean := p_amount > 100000000;
begin
  case p_current
    when 'DRAFT' then return 'PENDING_L1_SUPERVISOR';
    when 'PENDING_L1_SUPERVISOR' then return 'PENDING_L2_PROJECT_MANAGER';
    when 'PENDING_L2_PROJECT_MANAGER' then return 'PENDING_L2_5_FINANCE';
    when 'PENDING_L2_5_FINANCE' then
      if requires_l3 then
        return 'PENDING_L3_OPERATIONS_MANAGER';
      else
        return 'APPROVED';
      end if;
    when 'PENDING_L3_OPERATIONS_MANAGER' then
      if requires_l4 then
        return 'PENDING_L4_HEAD_MANAGER';
      else
        return 'APPROVED';
      end if;
    when 'PENDING_L4_HEAD_MANAGER' then
      if requires_l5 then
        return 'PENDING_L5_GENERAL_MANAGER';
      else
        return 'APPROVED';
      end if;
    when 'PENDING_L5_GENERAL_MANAGER' then return 'APPROVED';
    else return p_current;
  end case;
end;
$$;
