-- ControlDesk — 0010_hris_requests.sql
-- HRIS request slice: leave / overtime / sick + approval trail (rules §12).
--
-- Introduces:
--   1. hr_request_kind enum       (LEAVE / OVERTIME / SICK)
--   2. hr_request_status enum     (DRAFT → PENDING_L1 … PENDING_HR → APPROVED / REJECTED / CANCELLED)
--   3. hr_leave_type enum         (annual / unpaid / maternity / paternity / bereavement)
--   4. hr_requests table
--   5. hr_approval_logs table (append-only)
--   6. Helper: next_hr_request_status(kind, current)
--
-- Rollback:
--   drop function if exists public.next_hr_request_status(public.hr_request_kind, public.hr_request_status);
--   drop table if exists public.hr_approval_logs;
--   drop table if exists public.hr_requests;
--   drop type if exists public.hr_leave_type;
--   drop type if exists public.hr_request_status;
--   drop type if exists public.hr_request_kind;

-- ---------------------------------------------------------------------------
-- 1. hr_request_kind
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'hr_request_kind') then
    create type public.hr_request_kind as enum ('LEAVE', 'OVERTIME', 'SICK');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. hr_request_status
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'hr_request_status') then
    create type public.hr_request_status as enum (
      'DRAFT',
      'PENDING_L1_SUPERVISOR',
      'PENDING_L2_PROJECT_MANAGER',
      'PENDING_L3_OPERATIONS_MANAGER',
      'PENDING_HR_ADMIN',
      'APPROVED',
      'REJECTED',
      'CANCELLED'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. hr_leave_type
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'hr_leave_type') then
    create type public.hr_leave_type as enum (
      'ANNUAL',
      'UNPAID',
      'MATERNITY',
      'PATERNITY',
      'BEREAVEMENT',
      'MARRIAGE',
      'OTHER'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. hr_requests — one row per HR request (leave / overtime / sick).
-- ---------------------------------------------------------------------------
create table if not exists public.hr_requests (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete cascade,
  requester_employee_id     uuid not null references public.employees(id) on delete restrict,
  kind                      public.hr_request_kind not null,
  project_id                uuid references public.projects(id) on delete set null,
  leave_type                public.hr_leave_type,          -- only for LEAVE
  start_at                  timestamptz not null,
  end_at                    timestamptz not null,
  hours_estimate            numeric(6,2),                  -- only for OVERTIME
  reason                    text not null,
  attachment_url            text,                          -- surat dokter (SICK)
  status                    public.hr_request_status not null default 'DRAFT',
  final_approved_at         timestamptz,
  final_approver_id         uuid references public.employees(id) on delete set null,
  rejected_at               timestamptz,
  rejected_by               uuid references public.employees(id) on delete set null,
  rejection_reason          text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint hr_requests_reason_not_blank check (length(trim(reason)) > 0),
  constraint hr_requests_time_order check (end_at > start_at),
  constraint hr_requests_overtime_hours check (
    (kind = 'OVERTIME' and hours_estimate is not null and hours_estimate > 0)
    or (kind <> 'OVERTIME')
  ),
  constraint hr_requests_leave_type check (
    (kind = 'LEAVE' and leave_type is not null)
    or (kind <> 'LEAVE')
  ),
  constraint hr_requests_sick_attachment check (
    (kind = 'SICK' and attachment_url is not null)
    or (kind <> 'SICK')
  ),
  constraint hr_requests_reject_stamps_together check (
    (rejected_at is null) = (rejected_by is null)
  )
);

comment on table public.hr_requests is
  'HR requests: leave, overtime, or sick. State machine handled in src/app/(app)/hr/requests/actions.ts (rules §12).';

create index if not exists hr_requests_tenant_status_idx
  on public.hr_requests (tenant_id, status);
create index if not exists hr_requests_tenant_requester_idx
  on public.hr_requests (tenant_id, requester_employee_id, created_at desc);
create index if not exists hr_requests_tenant_pending_idx
  on public.hr_requests (tenant_id, status)
  where status in (
    'PENDING_L1_SUPERVISOR',
    'PENDING_L2_PROJECT_MANAGER',
    'PENDING_L3_OPERATIONS_MANAGER',
    'PENDING_HR_ADMIN'
  );

drop trigger if exists hr_requests_set_updated_at on public.hr_requests;
create trigger hr_requests_set_updated_at
  before update on public.hr_requests
  for each row execute function public.set_updated_at();

alter table public.hr_requests enable row level security;

drop policy if exists hr_requests_tenant_read on public.hr_requests;
create policy hr_requests_tenant_read
  on public.hr_requests
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists hr_requests_self_insert on public.hr_requests;
create policy hr_requests_self_insert
  on public.hr_requests
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1 from public.employees me
      where me.user_id = auth.uid()
        and me.id = requester_employee_id
        and me.tenant_id = hr_requests.tenant_id
        and me.is_active
    )
  );

drop policy if exists hr_requests_tenant_update on public.hr_requests;
create policy hr_requests_tenant_update
  on public.hr_requests
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- No DELETE policy: use CANCELLED status instead.

-- ---------------------------------------------------------------------------
-- 5. hr_approval_logs — immutable audit trail per request.
-- ---------------------------------------------------------------------------
create table if not exists public.hr_approval_logs (
  id                      bigint generated always as identity primary key,
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  request_id              uuid not null references public.hr_requests(id) on delete cascade,
  actor_employee_id       uuid references public.employees(id) on delete set null,
  actor_role              public.employee_role,
  action                  public.approval_action not null,
  from_status             public.hr_request_status not null,
  to_status               public.hr_request_status not null,
  comment                 text,
  created_at              timestamptz not null default now()
);

comment on table public.hr_approval_logs is
  'Append-only HR approval trail. Powers the timeline UI on request detail page.';

create index if not exists hr_approval_logs_request_idx
  on public.hr_approval_logs (tenant_id, request_id, created_at desc);

create or replace function public.hr_approval_logs_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'hr_approval_logs is append-only'
    using errcode = '42501';
end;
$$;

drop trigger if exists hal_no_update on public.hr_approval_logs;
create trigger hal_no_update
  before update or delete on public.hr_approval_logs
  for each row execute function public.hr_approval_logs_immutable();

alter table public.hr_approval_logs enable row level security;

drop policy if exists hal_tenant_read on public.hr_approval_logs;
create policy hal_tenant_read
  on public.hr_approval_logs
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists hal_tenant_insert on public.hr_approval_logs;
create policy hal_tenant_insert
  on public.hr_approval_logs
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- 6. next_hr_request_status — canonical state machine (rules §12).
--
--   LEAVE / OVERTIME → L1 Supervisor → L2 PM → L3 OM → HR Admin (Final).
--   SICK             → L1 Supervisor → HR Admin (Final).
--
--   Terminal states (APPROVED/REJECTED/CANCELLED) return themselves.
-- ---------------------------------------------------------------------------
create or replace function public.next_hr_request_status(
  p_kind public.hr_request_kind,
  p_current public.hr_request_status
)
returns public.hr_request_status
language plpgsql
immutable
as $$
begin
  case p_current
    when 'DRAFT' then return 'PENDING_L1_SUPERVISOR';
    when 'PENDING_L1_SUPERVISOR' then
      if p_kind = 'SICK' then
        return 'PENDING_HR_ADMIN';
      else
        return 'PENDING_L2_PROJECT_MANAGER';
      end if;
    when 'PENDING_L2_PROJECT_MANAGER' then return 'PENDING_L3_OPERATIONS_MANAGER';
    when 'PENDING_L3_OPERATIONS_MANAGER' then return 'PENDING_HR_ADMIN';
    when 'PENDING_HR_ADMIN' then return 'APPROVED';
    else return p_current;
  end case;
end;
$$;
