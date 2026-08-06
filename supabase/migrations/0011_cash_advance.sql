-- ControlDesk — 0011_cash_advance.sql
-- Cash Advance (Uang Muka Kerja) + Settlement slice (rules §11).
--
-- Introduces:
--   1. cash_advance_status enum
--   2. cash_advance_settlement_status enum
--   3. cash_advances table
--   4. cash_advance_settlements table
--   5. cash_advance_approval_logs table (append-only)
--   6. Helper: next_cash_advance_status(amount, current)
--
-- Rules §11 lifecycle:
--   Request phase (threshold matrix chain like expenses §9) →
--   Disbursed by Lead Finance →
--   Settlement phase (owner uploads nota/struk) →
--   Balance clearance (refund / top-up) →
--   Budget spent decremented resmi saat status `SETTLED`.
--
-- Rollback:
--   drop function if exists public.next_cash_advance_status(numeric, public.cash_advance_status);
--   drop table if exists public.cash_advance_approval_logs;
--   drop table if exists public.cash_advance_settlements;
--   drop table if exists public.cash_advances;
--   drop type if exists public.cash_advance_settlement_status;
--   drop type if exists public.cash_advance_status;

-- ---------------------------------------------------------------------------
-- 1. cash_advance_status
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'cash_advance_status') then
    create type public.cash_advance_status as enum (
      'DRAFT',
      'PENDING_L1_SUPERVISOR',
      'PENDING_L2_PROJECT_MANAGER',
      'PENDING_L2_5_FINANCE',
      'PENDING_L3_OPERATIONS_MANAGER',
      'PENDING_L4_HEAD_MANAGER',
      'PENDING_L5_GENERAL_MANAGER',
      'APPROVED',
      'DISBURSED',
      'SETTLED',
      'REJECTED',
      'CANCELLED'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. cash_advance_settlement_status
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'cash_advance_settlement_status') then
    create type public.cash_advance_settlement_status as enum (
      'DRAFT',
      'SUBMITTED',
      'ACCEPTED',
      'RETURNED'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. cash_advances
-- ---------------------------------------------------------------------------
create table if not exists public.cash_advances (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  project_id              uuid not null references public.projects(id) on delete restrict,
  requester_employee_id   uuid not null references public.employees(id) on delete restrict,
  amount                  numeric(18,2) not null check (amount > 0),
  currency                char(3) not null default 'IDR' check (currency = 'IDR'),
  purpose                 text not null,
  needed_by               date,
  status                  public.cash_advance_status not null default 'DRAFT',
  finance_approved_at     timestamptz,
  finance_approver_id     uuid references public.employees(id) on delete set null,
  final_approved_at       timestamptz,
  final_approver_id       uuid references public.employees(id) on delete set null,
  disbursed_at            timestamptz,
  disbursed_by            uuid references public.employees(id) on delete set null,
  disbursement_ref        text,                             -- bank transfer ref / voucher number
  rejected_at             timestamptz,
  rejected_by             uuid references public.employees(id) on delete set null,
  rejection_reason        text,
  settled_at              timestamptz,
  net_settlement_amount   numeric(18,2),                    -- positive: refund from employee to co; negative: top-up owed to employee
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint ca_purpose_not_blank check (length(trim(purpose)) > 0),
  constraint ca_reject_stamps_together check ( (rejected_at is null) = (rejected_by is null) ),
  constraint ca_disburse_stamps_together check ( (disbursed_at is null) = (disbursed_by is null) )
);

comment on table public.cash_advances is
  'Cash advance (uang muka kerja). State machine + threshold matrix identical to expenses (rules §9, §11).';

create index if not exists ca_tenant_status_idx
  on public.cash_advances (tenant_id, status);
create index if not exists ca_tenant_project_idx
  on public.cash_advances (tenant_id, project_id, status);
create index if not exists ca_tenant_requester_idx
  on public.cash_advances (tenant_id, requester_employee_id, created_at desc);
create index if not exists ca_pending_idx
  on public.cash_advances (tenant_id, status)
  where status in (
    'PENDING_L1_SUPERVISOR',
    'PENDING_L2_PROJECT_MANAGER',
    'PENDING_L2_5_FINANCE',
    'PENDING_L3_OPERATIONS_MANAGER',
    'PENDING_L4_HEAD_MANAGER',
    'PENDING_L5_GENERAL_MANAGER',
    'APPROVED'
  );

drop trigger if exists ca_set_updated_at on public.cash_advances;
create trigger ca_set_updated_at
  before update on public.cash_advances
  for each row execute function public.set_updated_at();

alter table public.cash_advances enable row level security;

drop policy if exists ca_tenant_read on public.cash_advances;
create policy ca_tenant_read
  on public.cash_advances
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists ca_requester_insert on public.cash_advances;
create policy ca_requester_insert
  on public.cash_advances
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.is_assigned_to_project(project_id)
    and exists (
      select 1 from public.employees me
      where me.user_id = auth.uid()
        and me.id = requester_employee_id
        and me.tenant_id = cash_advances.tenant_id
        and me.is_active
    )
  );

drop policy if exists ca_tenant_update on public.cash_advances;
create policy ca_tenant_update
  on public.cash_advances
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- 4. cash_advance_settlements — receipts + reconciliation lines
-- ---------------------------------------------------------------------------
create table if not exists public.cash_advance_settlements (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  cash_advance_id         uuid not null references public.cash_advances(id) on delete cascade,
  submitted_by            uuid references public.employees(id) on delete set null,
  status                  public.cash_advance_settlement_status not null default 'DRAFT',
  total_spent             numeric(18,2) not null default 0 check (total_spent >= 0),
  notes                   text,
  submitted_at            timestamptz,
  accepted_at             timestamptz,
  accepted_by             uuid references public.employees(id) on delete set null,
  returned_at             timestamptz,
  returned_by             uuid references public.employees(id) on delete set null,
  return_reason           text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.cash_advance_settlements is
  'Settlement (nota/struk) submissions for a given cash advance. Multiple attempts allowed if RETURNED.';

create index if not exists cas_advance_idx
  on public.cash_advance_settlements (tenant_id, cash_advance_id, created_at desc);

drop trigger if exists cas_set_updated_at on public.cash_advance_settlements;
create trigger cas_set_updated_at
  before update on public.cash_advance_settlements
  for each row execute function public.set_updated_at();

alter table public.cash_advance_settlements enable row level security;

drop policy if exists cas_tenant_read on public.cash_advance_settlements;
create policy cas_tenant_read
  on public.cash_advance_settlements
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists cas_tenant_write on public.cash_advance_settlements;
create policy cas_tenant_write
  on public.cash_advance_settlements
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists cas_tenant_update on public.cash_advance_settlements;
create policy cas_tenant_update
  on public.cash_advance_settlements
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- 5. cash_advance_approval_logs — immutable audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.cash_advance_approval_logs (
  id                      bigint generated always as identity primary key,
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  cash_advance_id         uuid not null references public.cash_advances(id) on delete cascade,
  actor_employee_id       uuid references public.employees(id) on delete set null,
  actor_role              public.employee_role,
  action                  public.approval_action not null,
  from_status             public.cash_advance_status not null,
  to_status               public.cash_advance_status not null,
  comment                 text,
  created_at              timestamptz not null default now()
);

comment on table public.cash_advance_approval_logs is
  'Append-only cash-advance approval trail. Powers the timeline UI.';

create index if not exists caal_advance_idx
  on public.cash_advance_approval_logs (tenant_id, cash_advance_id, created_at desc);

create or replace function public.cash_advance_approval_logs_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'cash_advance_approval_logs is append-only'
    using errcode = '42501';
end;
$$;

drop trigger if exists caal_no_update on public.cash_advance_approval_logs;
create trigger caal_no_update
  before update or delete on public.cash_advance_approval_logs
  for each row execute function public.cash_advance_approval_logs_immutable();

alter table public.cash_advance_approval_logs enable row level security;

drop policy if exists caal_tenant_read on public.cash_advance_approval_logs;
create policy caal_tenant_read
  on public.cash_advance_approval_logs
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists caal_tenant_insert on public.cash_advance_approval_logs;
create policy caal_tenant_insert
  on public.cash_advance_approval_logs
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- 6. next_cash_advance_status — mirrors expense state machine (rules §9)
--    then extends into DISBURSED → SETTLED terminal path (rules §11).
-- ---------------------------------------------------------------------------
create or replace function public.next_cash_advance_status(
  p_amount numeric,
  p_current public.cash_advance_status
)
returns public.cash_advance_status
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
    when 'APPROVED' then return 'DISBURSED';
    when 'DISBURSED' then return 'SETTLED';
    else return p_current;
  end case;
end;
$$;
