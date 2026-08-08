-- Migration: 0060_upk_notes.sql
-- Purpose : Uang Penghentian Kontrak (UPK) — severance draft note.
--           PM drafts, Finance approves, Director approves (if ≥ threshold),
--           then Finance marks paid. Auto-created stub when a
--           performance evaluation is finalized with NOT_EXTEND.
--
-- Chain   : DRAFT → PENDING_FINANCE → PENDING_DIRECTOR (if ≥ 50M)
--           → APPROVED → PAID
--           REJECTED_BY_FINANCE / REJECTED_BY_DIRECTOR terminal states.
--
-- Payroll : This module does NOT execute payroll stop — it emits a
--           notification `PAYROLL_STOP_REQUEST` to Finance so the
--           external payroll system can be updated manually.
--
-- Rollback :
--   drop table if exists public.upk_notes cascade;
--   drop type if exists public.upk_status;

do $$ begin
  create type public.upk_status as enum (
    'DRAFT',
    'PENDING_FINANCE',
    'PENDING_DIRECTOR',
    'APPROVED',
    'REJECTED_BY_FINANCE',
    'REJECTED_BY_DIRECTOR',
    'PAID',
    'CANCELLED'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.upk_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  evaluation_id uuid references public.performance_evaluations(id) on delete set null,
  contract_end_date date not null,
  -- Service length in months (rounded up). Used for UPK calc.
  service_months int not null default 0 check (service_months >= 0),
  -- Snapshot of base salary at draft time (numeric(18,2) IDR).
  base_salary numeric(18, 2) not null default 0
    check (base_salary >= 0),
  -- Multiplier applied (e.g. 1.0 = one month salary per year of
  -- service, capped elsewhere). Adjustable per row.
  multiplier numeric(6, 3) not null default 1.000
    check (multiplier >= 0 and multiplier <= 12),
  -- Computed at draft time; can be overridden manually by PM.
  computed_upk numeric(18, 2) not null default 0
    check (computed_upk >= 0),
  justification text,
  drafted_by uuid references public.employees(id) on delete set null,
  status public.upk_status not null default 'DRAFT',
  submitted_at timestamptz,
  finance_approved_by uuid references public.employees(id) on delete set null,
  finance_approved_at timestamptz,
  director_approved_by uuid references public.employees(id) on delete set null,
  director_approved_at timestamptz,
  paid_by uuid references public.employees(id) on delete set null,
  paid_at timestamptz,
  paid_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists upk_notes_tenant_status_idx
  on public.upk_notes (tenant_id, status, contract_end_date);
create index if not exists upk_notes_employee_idx
  on public.upk_notes (tenant_id, employee_id);
create index if not exists upk_notes_finance_pending_idx
  on public.upk_notes (tenant_id, status)
  where status = 'PENDING_FINANCE';
create index if not exists upk_notes_director_pending_idx
  on public.upk_notes (tenant_id, status)
  where status = 'PENDING_DIRECTOR';

comment on table public.upk_notes is
  'Uang Penghentian Kontrak (severance) draft note. Auto-created when a performance evaluation finalizes with NOT_EXTEND. Approval chain: PM → Finance → Director (if ≥ 50M).';

alter table public.upk_notes enable row level security;

-- Read: HR / management full view; drafter can read their own drafts.
create policy upk_notes_read on public.upk_notes
  for select using (
    tenant_id = current_tenant_id() and (
      public.is_hr_or_management()
      or drafted_by in (select id from public.employees where user_id = auth.uid())
    )
  );

-- Write: PM+ can draft; approval steps are guarded server-side via
-- withSecureAction (PDP checks role at each step).
create policy upk_notes_write on public.upk_notes
  for all using (
    tenant_id = current_tenant_id() and (
      public.is_hr_or_management()
      or drafted_by in (select id from public.employees where user_id = auth.uid())
      or exists (
        select 1 from public.employees e
        where e.user_id = auth.uid()
          and e.role in (
            'PROJECT_MANAGER', 'LEAD_FINANCE'
          )
      )
    )
  ) with check (tenant_id = current_tenant_id());

do $$ begin
  alter type public.notification_kind add value if not exists 'UPK_DRAFT_CREATED';
  alter type public.notification_kind add value if not exists 'UPK_SUBMITTED';
  alter type public.notification_kind add value if not exists 'UPK_APPROVED';
  alter type public.notification_kind add value if not exists 'UPK_REJECTED';
  alter type public.notification_kind add value if not exists 'UPK_PAID';
  alter type public.notification_kind add value if not exists 'PAYROLL_STOP_REQUEST';
exception when others then null; end $$;
