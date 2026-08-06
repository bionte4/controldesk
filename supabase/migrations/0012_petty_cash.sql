-- ControlDesk — 0012_petty_cash.sql
-- Petty Cash (Kas Kecil Operasional) via Imprest Fund System (rules §10).
--
-- Concept:
--   - Custodian holds a fixed float (imprest) per fund location.
--   - Each expense is a `voucher` line deducting from the fund's balance.
--   - When balance drops below `min_balance`, custodian raises a
--     `replenishment` request → Lead Finance approves → cash injected back
--     up to the imprest ceiling.
--
-- Rules §10 limits vouchers to < Rp 1.000.000. Enforced via CHECK constraint.
--
-- Rollback:
--   drop table if exists public.petty_cash_replenishments;
--   drop table if exists public.petty_cash_vouchers;
--   drop table if exists public.petty_cash_funds;
--   drop type if exists public.petty_cash_replenishment_status;
--   drop type if exists public.petty_cash_voucher_status;

-- ---------------------------------------------------------------------------
-- 1. voucher status
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'petty_cash_voucher_status') then
    create type public.petty_cash_voucher_status as enum (
      'RECORDED',
      'VOIDED'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. replenishment status
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'petty_cash_replenishment_status') then
    create type public.petty_cash_replenishment_status as enum (
      'PENDING_FINANCE',
      'APPROVED',
      'DISBURSED',
      'REJECTED'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. petty_cash_funds — imprest fund per location / custodian.
-- ---------------------------------------------------------------------------
create table if not exists public.petty_cash_funds (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  location_name           text not null,
  custodian_employee_id   uuid not null references public.employees(id) on delete restrict,
  imprest_amount          numeric(18,2) not null check (imprest_amount > 0),
  balance                 numeric(18,2) not null default 0 check (balance >= 0),
  min_balance             numeric(18,2) not null default 0 check (min_balance >= 0),
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint pcf_min_le_imprest check (min_balance <= imprest_amount),
  constraint pcf_location_not_blank check (length(trim(location_name)) > 0)
);

comment on table public.petty_cash_funds is
  'Imprest petty cash fund. One row per location / custodian. Balance is maintained via voucher (debit) + replenishment (credit) triggers.';

create unique index if not exists pcf_tenant_location_uniq
  on public.petty_cash_funds (tenant_id, lower(location_name));

create index if not exists pcf_custodian_idx
  on public.petty_cash_funds (tenant_id, custodian_employee_id);

drop trigger if exists pcf_set_updated_at on public.petty_cash_funds;
create trigger pcf_set_updated_at
  before update on public.petty_cash_funds
  for each row execute function public.set_updated_at();

alter table public.petty_cash_funds enable row level security;

drop policy if exists pcf_tenant_read on public.petty_cash_funds;
create policy pcf_tenant_read
  on public.petty_cash_funds
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists pcf_finance_write on public.petty_cash_funds;
create policy pcf_finance_write
  on public.petty_cash_funds
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in ('LEAD_FINANCE', 'TENANT_ADMIN')
  );

drop policy if exists pcf_finance_update on public.petty_cash_funds;
create policy pcf_finance_update
  on public.petty_cash_funds
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in ('LEAD_FINANCE', 'TENANT_ADMIN', 'PETTY_CASH_CUSTODIAN')
  )
  with check (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- 4. petty_cash_vouchers — one row per petty spend
-- ---------------------------------------------------------------------------
create table if not exists public.petty_cash_vouchers (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  fund_id                 uuid not null references public.petty_cash_funds(id) on delete restrict,
  created_by              uuid not null references public.employees(id) on delete restrict,
  amount                  numeric(18,2) not null check (amount > 0 and amount < 1000000),
  category                text not null,
  description             text not null,
  incurred_on             date not null,
  receipt_url             text,
  status                  public.petty_cash_voucher_status not null default 'RECORDED',
  voided_at               timestamptz,
  voided_by               uuid references public.employees(id) on delete set null,
  void_reason             text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint pcv_description_not_blank check (length(trim(description)) > 0),
  constraint pcv_void_stamps_together check ( (voided_at is null) = (voided_by is null) )
);

comment on table public.petty_cash_vouchers is
  'Petty cash expense (< Rp 1.000.000 per voucher). Debit against fund balance on RECORDED (rules §10).';

create index if not exists pcv_fund_idx
  on public.petty_cash_vouchers (tenant_id, fund_id, created_at desc);
create index if not exists pcv_tenant_status_idx
  on public.petty_cash_vouchers (tenant_id, status);

drop trigger if exists pcv_set_updated_at on public.petty_cash_vouchers;
create trigger pcv_set_updated_at
  before update on public.petty_cash_vouchers
  for each row execute function public.set_updated_at();

alter table public.petty_cash_vouchers enable row level security;

drop policy if exists pcv_tenant_read on public.petty_cash_vouchers;
create policy pcv_tenant_read
  on public.petty_cash_vouchers
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists pcv_custodian_insert on public.petty_cash_vouchers;
create policy pcv_custodian_insert
  on public.petty_cash_vouchers
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'PETTY_CASH_CUSTODIAN', 'LEAD_FINANCE', 'TENANT_ADMIN'
    )
  );

drop policy if exists pcv_custodian_update on public.petty_cash_vouchers;
create policy pcv_custodian_update
  on public.petty_cash_vouchers
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'PETTY_CASH_CUSTODIAN', 'LEAD_FINANCE', 'TENANT_ADMIN'
    )
  )
  with check (tenant_id = public.current_tenant_id());

-- Balance side-effect: debit fund on RECORDED insert, credit back on VOID.
create or replace function public.petty_cash_voucher_apply_balance()
returns trigger
language plpgsql
as $$
declare
  v_delta numeric(18,2);
begin
  if tg_op = 'INSERT' and new.status = 'RECORDED' then
    v_delta := -new.amount;
  elsif tg_op = 'UPDATE' then
    if old.status = 'RECORDED' and new.status = 'VOIDED' then
      v_delta := old.amount;                       -- credit back
    elsif old.status = 'VOIDED' and new.status = 'RECORDED' then
      v_delta := -new.amount;                      -- rare re-instate
    else
      return new;
    end if;
  else
    return new;
  end if;

  update public.petty_cash_funds
     set balance = balance + v_delta
   where id = new.fund_id
     and tenant_id = new.tenant_id;

  if not found then
    raise exception 'petty_cash fund % not found', new.fund_id
      using errcode = 'P0002';
  end if;

  return new;
end;
$$;

drop trigger if exists pcv_apply_balance on public.petty_cash_vouchers;
create trigger pcv_apply_balance
  after insert or update on public.petty_cash_vouchers
  for each row execute function public.petty_cash_voucher_apply_balance();

-- ---------------------------------------------------------------------------
-- 5. petty_cash_replenishments — top-up requests from custodian
-- ---------------------------------------------------------------------------
create table if not exists public.petty_cash_replenishments (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  fund_id                 uuid not null references public.petty_cash_funds(id) on delete restrict,
  requested_by            uuid not null references public.employees(id) on delete restrict,
  requested_amount        numeric(18,2) not null check (requested_amount > 0),
  reason                  text,
  status                  public.petty_cash_replenishment_status not null default 'PENDING_FINANCE',
  approved_at             timestamptz,
  approved_by             uuid references public.employees(id) on delete set null,
  disbursed_at            timestamptz,
  disbursed_by            uuid references public.employees(id) on delete set null,
  disbursement_ref        text,
  rejected_at             timestamptz,
  rejected_by             uuid references public.employees(id) on delete set null,
  rejection_reason        text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint pcr_reject_stamps_together check ( (rejected_at is null) = (rejected_by is null) ),
  constraint pcr_disburse_stamps_together check ( (disbursed_at is null) = (disbursed_by is null) )
);

comment on table public.petty_cash_replenishments is
  'Top-up request from custodian to Lead Finance. Credits fund balance on DISBURSED (rules §10).';

create index if not exists pcr_fund_idx
  on public.petty_cash_replenishments (tenant_id, fund_id, created_at desc);
create index if not exists pcr_status_idx
  on public.petty_cash_replenishments (tenant_id, status);

drop trigger if exists pcr_set_updated_at on public.petty_cash_replenishments;
create trigger pcr_set_updated_at
  before update on public.petty_cash_replenishments
  for each row execute function public.set_updated_at();

alter table public.petty_cash_replenishments enable row level security;

drop policy if exists pcr_tenant_read on public.petty_cash_replenishments;
create policy pcr_tenant_read
  on public.petty_cash_replenishments
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists pcr_custodian_insert on public.petty_cash_replenishments;
create policy pcr_custodian_insert
  on public.petty_cash_replenishments
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'PETTY_CASH_CUSTODIAN', 'LEAD_FINANCE', 'TENANT_ADMIN'
    )
  );

drop policy if exists pcr_finance_update on public.petty_cash_replenishments;
create policy pcr_finance_update
  on public.petty_cash_replenishments
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in ('LEAD_FINANCE', 'TENANT_ADMIN')
  )
  with check (tenant_id = public.current_tenant_id());

-- Balance side-effect: credit fund on DISBURSED.
create or replace function public.petty_cash_replenishment_apply_balance()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.status <> 'DISBURSED'
     and new.status = 'DISBURSED' then
    update public.petty_cash_funds
       set balance = balance + new.requested_amount
     where id = new.fund_id
       and tenant_id = new.tenant_id;

    if not found then
      raise exception 'petty_cash fund % not found', new.fund_id
        using errcode = 'P0002';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pcr_apply_balance on public.petty_cash_replenishments;
create trigger pcr_apply_balance
  after update on public.petty_cash_replenishments
  for each row execute function public.petty_cash_replenishment_apply_balance();
