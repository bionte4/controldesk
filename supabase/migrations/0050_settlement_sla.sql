-- ControlDesk — 0050_settlement_sla.sql
-- Settlement SLA + reminder infrastructure (rules §11 + §20).
--
-- Introduces:
--   1. New notification_kind enum values:
--        SETTLEMENT_DUE_SOON       — T-3 / T-0 to submitter
--        SETTLEMENT_OVERDUE        — T+1 / T+3 / T+7 to submitter + escalation
--        EXPENSE_DRAFT_STALE       — expense draft > 7 wd ke submitter
--        EXPENSE_INCURRED_STALE    — nota lebih tua 7 wd, flag ke approvers
--   2. cash_advances.settlement_due_at — deadline 7 hari kerja setelah DISBURSED
--   3. project_expenses.late_submission_reason — justifikasi kalau incurred_on > 7 wd
--   4. public.add_business_days(start, n, tz) — helper skip Sat/Sun
--   5. BEFORE UPDATE trigger set settlement_due_at saat status → DISBURSED
--   6. Backfill row DISBURSED existing dengan grace period +3 wd
--   7. Tabel settlement_sla_reminders — audit + idempotensi cron
--
-- Business rule (rules §11 revision):
--   Pengaju wajib submit settlement (cash_advance_settlements dgn status
--   SUBMITTED) dalam 7 hari kerja setelah `disbursed_at`. Cron
--   /api/cron/settlement-reminders mengirim reminder di offset -3, 0, +1,
--   +3, +7 (business days), dan mengekskalasi ke Supervisor/PM/OM pada
--   T+1/+3/+7 sesuai `docs/modules/finance.md`.
--
-- Rollback:
--   drop table if exists public.settlement_sla_reminders;
--   drop trigger if exists ca_set_settlement_due on public.cash_advances;
--   drop function if exists public.set_cash_advance_settlement_due();
--   drop function if exists public.add_business_days(timestamptz, integer, text);
--   alter table public.project_expenses drop column if exists late_submission_reason;
--   alter table public.cash_advances drop column if exists settlement_due_at;
--   -- notification_kind enum values are additive; see 0038 for the manual
--   -- rebuild sequence if a hard rollback of the enum is ever required.

-- ---------------------------------------------------------------------------
-- 1. notification_kind — extend enum
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'notification_kind' and e.enumlabel = 'SETTLEMENT_DUE_SOON'
  ) then
    alter type public.notification_kind add value 'SETTLEMENT_DUE_SOON';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'notification_kind' and e.enumlabel = 'SETTLEMENT_OVERDUE'
  ) then
    alter type public.notification_kind add value 'SETTLEMENT_OVERDUE';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'notification_kind' and e.enumlabel = 'EXPENSE_DRAFT_STALE'
  ) then
    alter type public.notification_kind add value 'EXPENSE_DRAFT_STALE';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'notification_kind' and e.enumlabel = 'EXPENSE_INCURRED_STALE'
  ) then
    alter type public.notification_kind add value 'EXPENSE_INCURRED_STALE';
  end if;
end $$;

comment on type public.notification_kind is
  'Top-level classification for internal in-app notifications. SETTLEMENT_DUE_SOON / SETTLEMENT_OVERDUE are emitted by /api/cron/settlement-reminders. EXPENSE_DRAFT_STALE / EXPENSE_INCURRED_STALE flag expenses that violate the 7 business day SLA.';

-- ---------------------------------------------------------------------------
-- 2. cash_advances.settlement_due_at
-- ---------------------------------------------------------------------------
alter table public.cash_advances
  add column if not exists settlement_due_at timestamptz;

comment on column public.cash_advances.settlement_due_at is
  'Deadline (7 business days after DISBURSED) untuk submitter submit settlement. Diset otomatis oleh trigger ca_set_settlement_due. NULL untuk row yang belum pernah DISBURSED.';

create index if not exists ca_settlement_due_idx
  on public.cash_advances (tenant_id, settlement_due_at)
  where status = 'DISBURSED' and settled_at is null;

-- ---------------------------------------------------------------------------
-- 3. project_expenses.late_submission_reason
-- ---------------------------------------------------------------------------
alter table public.project_expenses
  add column if not exists late_submission_reason text,
  add constraint project_expenses_late_reason_len check (
    late_submission_reason is null
    or length(trim(late_submission_reason)) between 5 and 500
  );

comment on column public.project_expenses.late_submission_reason is
  'Justifikasi wajib saat submit expense dengan incurred_on lebih tua dari 7 hari kerja. Divalidasi di Zod + surfaced sebagai EXPENSE_INCURRED_STALE ke approver.';

-- ---------------------------------------------------------------------------
-- 4. add_business_days(start, n, tz)
-- ---------------------------------------------------------------------------
create or replace function public.add_business_days(
  p_start timestamptz,
  p_n integer,
  p_tz text default 'Asia/Jakarta'
)
returns timestamptz
language plpgsql
immutable
as $$
declare
  v_local timestamp;
  v_step integer;
  v_days integer;
  v_wd integer;
begin
  if p_n is null then
    return null;
  end if;
  -- Snap to start-of-day wall-clock in the target TZ.
  v_local := date_trunc('day', p_start at time zone p_tz);
  if p_n = 0 then
    return ((v_local + interval '23 hours 59 minutes 59 seconds 999 milliseconds') at time zone p_tz);
  end if;
  v_step := case when p_n > 0 then 1 else -1 end;
  v_days := abs(p_n);
  while v_days > 0 loop
    v_local := v_local + (v_step || ' day')::interval;
    v_wd := extract(dow from v_local)::integer; -- 0 = Sun, 6 = Sat
    if v_wd not in (0, 6) then
      v_days := v_days - 1;
    end if;
  end loop;
  return ((v_local + interval '23 hours 59 minutes 59 seconds 999 milliseconds') at time zone p_tz);
end;
$$;

comment on function public.add_business_days(timestamptz, integer, text) is
  'Tambah `n` hari kerja (skip Sat/Sun) ke `p_start` di zona waktu `p_tz`. Hari awal tidak dihitung. Hasil = 23:59:59.999 wall-clock di tenant TZ. Kembar mirror src/lib/format/business-days.ts.';

-- ---------------------------------------------------------------------------
-- 5. Trigger: set settlement_due_at on transition to DISBURSED
-- ---------------------------------------------------------------------------
create or replace function public.set_cash_advance_settlement_due()
returns trigger
language plpgsql
as $$
declare
  v_tz text;
begin
  if new.status = 'DISBURSED'
     and new.disbursed_at is not null
     and new.settlement_due_at is null
  then
    select coalesce(t.timezone, 'Asia/Jakarta') into v_tz
      from public.tenants t
     where t.id = new.tenant_id;
    new.settlement_due_at := public.add_business_days(
      new.disbursed_at, 7, coalesce(v_tz, 'Asia/Jakarta')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists ca_set_settlement_due on public.cash_advances;
create trigger ca_set_settlement_due
  before insert or update on public.cash_advances
  for each row execute function public.set_cash_advance_settlement_due();

comment on function public.set_cash_advance_settlement_due() is
  'BEFORE UPDATE trigger: saat status → DISBURSED, set settlement_due_at = disbursed_at + 7 wd di zona waktu tenant. Idempotent — tidak overwrite value yang sudah ada.';

-- ---------------------------------------------------------------------------
-- 6. Backfill DISBURSED existing rows dengan grace period +3 wd
-- ---------------------------------------------------------------------------
update public.cash_advances ca
   set settlement_due_at = greatest(
     public.add_business_days(ca.disbursed_at, 7, coalesce(t.timezone, 'Asia/Jakarta')),
     public.add_business_days(now(), 3, coalesce(t.timezone, 'Asia/Jakarta'))
   )
  from public.tenants t
 where t.id = ca.tenant_id
   and ca.status = 'DISBURSED'
   and ca.settled_at is null
   and ca.settlement_due_at is null
   and ca.disbursed_at is not null;

-- ---------------------------------------------------------------------------
-- 7. settlement_sla_reminders — audit + idempotency for the reminder cron
-- ---------------------------------------------------------------------------
create table if not exists public.settlement_sla_reminders (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  resource_type            text not null check (
    resource_type in ('cash_advance', 'expense_draft', 'expense_incurred')
  ),
  resource_id              uuid not null,
  reminder_kind            text not null check (
    reminder_kind in ('T-3', 'T-0', 'T+1', 'T+3', 'T+7', 'DRAFT_STALE', 'INCURRED_STALE')
  ),
  business_days_offset     integer not null,
  sent_at                  timestamptz not null default now(),
  sent_to_employee_id      uuid references public.employees(id) on delete set null,
  metadata                 jsonb
);

comment on table public.settlement_sla_reminders is
  'Audit + idempotency guard untuk /api/cron/settlement-reminders. Satu row per (resource, reminder_kind) memastikan cron tidak spam. `resource_type` mengunci polymorphic reference: cash_advance, expense_draft, expense_incurred.';

create unique index if not exists ssr_uniq
  on public.settlement_sla_reminders (tenant_id, resource_type, resource_id, reminder_kind);

create index if not exists ssr_tenant_sent_idx
  on public.settlement_sla_reminders (tenant_id, sent_at desc);

alter table public.settlement_sla_reminders enable row level security;

drop policy if exists ssr_tenant_read on public.settlement_sla_reminders;
create policy ssr_tenant_read
  on public.settlement_sla_reminders
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- Writes go through service_role from the cron endpoint; no self-service INSERT policy.
