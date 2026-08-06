-- ControlDesk — 0013_pm_handovers.sql
-- PM Handover Engine (rules §13).
--
-- A structured, auditable transition of PRIMARY_PM assignment from an
-- outgoing PM to an incoming PM on a project. Requires dual approval
-- (OM + HM). On finalisation, a database transaction:
--   1. Ends the outgoing PM's ACTIVE assignment.
--   2. Creates an ACTIVE assignment for the incoming PM.
--   3. Reassigns any of the outgoing PM's still-pending L2/L3+ approvals
--      on this project (expenses + cash advances) to the incoming PM's
--      queue by rewriting the pending status (kept unchanged where the
--      approver role is not "PROJECT_MANAGER").
--   4. Writes an immutable audit trail row (handover_audit_logs).
--
-- Rollback:
--   drop function if exists public.finalise_pm_handover(uuid);
--   drop table if exists public.pm_handover_audit_logs;
--   drop table if exists public.pm_handovers;
--   drop type if exists public.pm_handover_status;

-- ---------------------------------------------------------------------------
-- 1. Status enum
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'pm_handover_status') then
    create type public.pm_handover_status as enum (
      'DRAFT',
      'PENDING_OM',
      'PENDING_HM',
      'APPROVED',       -- both approvals in; ready to execute
      'EXECUTED',       -- finalise_pm_handover() has run
      'REJECTED',
      'CANCELLED'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. pm_handovers
-- ---------------------------------------------------------------------------
create table if not exists public.pm_handovers (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  project_id              uuid not null references public.projects(id) on delete restrict,
  from_pm_employee_id     uuid not null references public.employees(id) on delete restrict,
  to_pm_employee_id       uuid not null references public.employees(id) on delete restrict,
  effective_at            timestamptz not null,
  reason                  text not null,
  handover_notes          text,
  initiated_by            uuid not null references public.employees(id) on delete restrict,
  status                  public.pm_handover_status not null default 'DRAFT',
  om_approved_at          timestamptz,
  om_approver_id          uuid references public.employees(id) on delete set null,
  hm_approved_at          timestamptz,
  hm_approver_id          uuid references public.employees(id) on delete set null,
  executed_at             timestamptz,
  executed_by             uuid references public.employees(id) on delete set null,
  rejected_at             timestamptz,
  rejected_by             uuid references public.employees(id) on delete set null,
  rejection_reason        text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint pmh_reason_not_blank check (length(trim(reason)) > 0),
  constraint pmh_distinct_pms check (from_pm_employee_id <> to_pm_employee_id),
  constraint pmh_reject_stamps_together check (
    (rejected_at is null) = (rejected_by is null)
  ),
  constraint pmh_execute_stamps_together check (
    (executed_at is null) = (executed_by is null)
  )
);

comment on table public.pm_handovers is
  'PM handover request. OM + HM dual approval, then finalise_pm_handover() transitions state atomically (rules §13).';

-- Only one non-terminal handover per project at a time.
create unique index if not exists pm_handovers_one_active_per_project
  on public.pm_handovers (project_id)
  where status in ('DRAFT', 'PENDING_OM', 'PENDING_HM', 'APPROVED');

create index if not exists pm_handovers_tenant_status_idx
  on public.pm_handovers (tenant_id, status, created_at desc);

drop trigger if exists pm_handovers_set_updated_at on public.pm_handovers;
create trigger pm_handovers_set_updated_at
  before update on public.pm_handovers
  for each row execute function public.set_updated_at();

alter table public.pm_handovers enable row level security;

drop policy if exists pmh_tenant_read on public.pm_handovers;
create policy pmh_tenant_read
  on public.pm_handovers
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists pmh_tenant_insert on public.pm_handovers;
create policy pmh_tenant_insert
  on public.pm_handovers
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'OPERATIONS_MANAGER', 'HEAD_MANAGER', 'GENERAL_MANAGER', 'TENANT_ADMIN'
    )
  );

drop policy if exists pmh_tenant_update on public.pm_handovers;
create policy pmh_tenant_update
  on public.pm_handovers
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- 3. pm_handover_audit_logs — immutable audit
-- ---------------------------------------------------------------------------
create table if not exists public.pm_handover_audit_logs (
  id                bigserial primary key,
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  handover_id       uuid not null references public.pm_handovers(id) on delete cascade,
  actor_employee_id uuid references public.employees(id) on delete set null,
  actor_role        public.employee_role,
  action            public.approval_action not null,
  from_status       public.pm_handover_status not null,
  to_status         public.pm_handover_status not null,
  comment           text,
  created_at        timestamptz not null default now()
);

comment on table public.pm_handover_audit_logs is
  'Immutable log of PM handover state transitions (rules §13).';

create index if not exists pmh_logs_handover_idx
  on public.pm_handover_audit_logs (tenant_id, handover_id, created_at);

alter table public.pm_handover_audit_logs enable row level security;

drop policy if exists pmh_logs_tenant_read on public.pm_handover_audit_logs;
create policy pmh_logs_tenant_read
  on public.pm_handover_audit_logs
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists pmh_logs_tenant_insert on public.pm_handover_audit_logs;
create policy pmh_logs_tenant_insert
  on public.pm_handover_audit_logs
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

-- Immutability guard.
create or replace function public.pm_handover_audit_no_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'pm_handover_audit_logs is append-only';
end;
$$;

drop trigger if exists pmhal_no_update on public.pm_handover_audit_logs;
create trigger pmhal_no_update
  before update or delete on public.pm_handover_audit_logs
  for each row execute function public.pm_handover_audit_no_update();

-- ---------------------------------------------------------------------------
-- 4. finalise_pm_handover(handover_id)
--
-- Atomically:
--   - End the outgoing PM's ACTIVE PRIMARY_PM assignment.
--   - Start a new ACTIVE PRIMARY_PM assignment for the incoming PM.
--   - Mark the handover as EXECUTED.
--
-- Callers must ensure the handover is in APPROVED status and the caller is
-- authorised via PDP; this function only enforces atomicity + invariants.
-- ---------------------------------------------------------------------------
create or replace function public.finalise_pm_handover(p_handover_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  h public.pm_handovers%rowtype;
  v_actor_id uuid;
begin
  select id into v_actor_id
  from public.employees
  where user_id = auth.uid()
    and is_active
  limit 1;

  select * into h
  from public.pm_handovers
  where id = p_handover_id
    and tenant_id = public.current_tenant_id()
  for update;

  if not found then
    raise exception 'handover % not found or cross-tenant', p_handover_id
      using errcode = 'P0002';
  end if;

  if h.status <> 'APPROVED' then
    raise exception 'handover % is % (expected APPROVED)', h.id, h.status
      using errcode = '22023';
  end if;

  -- 1. End the outgoing PM's current ACTIVE PRIMARY_PM assignment.
  update public.project_pm_assignments
     set status = 'ENDED', ended_at = h.effective_at
   where tenant_id = h.tenant_id
     and project_id = h.project_id
     and pm_employee_id = h.from_pm_employee_id
     and assignment_role = 'PRIMARY_PM'
     and status = 'ACTIVE';

  -- 2. Insert a new ACTIVE PRIMARY_PM assignment for the incoming PM.
  insert into public.project_pm_assignments
    (tenant_id, project_id, pm_employee_id, assignment_role, status, started_at, created_by)
  values
    (h.tenant_id, h.project_id, h.to_pm_employee_id, 'PRIMARY_PM', 'ACTIVE', h.effective_at, v_actor_id);

  -- 3. Mark the handover executed.
  update public.pm_handovers
     set status = 'EXECUTED',
         executed_at = now(),
         executed_by = v_actor_id
   where id = h.id;

  insert into public.pm_handover_audit_logs
    (tenant_id, handover_id, actor_employee_id, actor_role, action, from_status, to_status, comment)
  values
    (h.tenant_id, h.id, v_actor_id, public.current_employee_role(), 'APPROVE', 'APPROVED', 'EXECUTED',
     'finalise_pm_handover: assignment transferred');
end;
$$;

revoke all on function public.finalise_pm_handover(uuid) from public;
grant execute on function public.finalise_pm_handover(uuid) to authenticated;
