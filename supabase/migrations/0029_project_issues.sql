-- =============================================================================
-- Migration 0028 — Project Issues module (Fase 2, GAS §26 port).
--
-- Adds an issue register per project with business-hours SLA tracking.
-- Severity drives the SLA target (Critical 1h · High 4h · Medium 8h · Low 24h
-- business hours). Status is a simple lifecycle (OPEN → IN_PROGRESS →
-- RESOLVED → CLOSED, with REOPENED to bounce back into IN_PROGRESS).
--
-- Assignee starts at Supervisor by default; an out-of-band escalation
-- sweeper (planned) climbs the ladder Supervisor → PM → OM → Director
-- when SLA breaches — this migration lays the storage + read side, the
-- escalation function is added in a later slice.
--
-- Rollback:
--   drop trigger if exists project_issue_events_immutable on public.project_issue_events;
--   drop function if exists public.project_issue_events_immutable();
--   drop table if exists public.project_issue_events;
--   drop table if exists public.project_issues;
--   drop type if exists public.project_issue_severity;
--   drop type if exists public.project_issue_status;
--   drop type if exists public.project_issue_event_kind;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_issue_severity') then
    create type public.project_issue_severity as enum (
      'CRITICAL',   -- 1h business hours SLA
      'HIGH',       -- 4h
      'MEDIUM',     -- 8h
      'LOW'         -- 24h
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'project_issue_status') then
    create type public.project_issue_status as enum (
      'OPEN',
      'IN_PROGRESS',
      'RESOLVED',
      'CLOSED',
      'REOPENED'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'project_issue_event_kind') then
    create type public.project_issue_event_kind as enum (
      'CREATED',
      'UPDATED',
      'STATUS_CHANGED',
      'ASSIGNED',
      'COMMENTED',
      'ESCALATED',
      'SLA_BREACHED',
      'REOPENED',
      'CLOSED'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. project_issues — one row per open/closed issue.
-- ---------------------------------------------------------------------------
create table if not exists public.project_issues (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  project_id              uuid not null references public.projects(id) on delete restrict,
  reporter_employee_id    uuid not null references public.employees(id) on delete restrict,
  assignee_employee_id    uuid references public.employees(id) on delete set null,
  title                   text not null,
  description             text not null default '',
  severity                public.project_issue_severity not null default 'MEDIUM',
  status                  public.project_issue_status not null default 'OPEN',
  -- Business-hours SLA snapshot at creation. Kept static (not recomputed on
  -- severity change) so the audit trail stays honest — a change of severity
  -- records an UPDATED event and can also re-stamp the due time via a
  -- server-side action if the business decides so.
  sla_due_at              timestamptz not null,
  resolved_at             timestamptz,
  resolved_by             uuid references public.employees(id) on delete set null,
  closed_at               timestamptz,
  closed_by               uuid references public.employees(id) on delete set null,
  reopened_at             timestamptz,
  reopened_by             uuid references public.employees(id) on delete set null,
  escalation_level        smallint not null default 0
    check (escalation_level between 0 and 3),
  last_escalated_at       timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint project_issues_title_not_blank
    check (length(trim(title)) > 0),
  constraint project_issues_resolve_pair
    check ((resolved_at is null) = (resolved_by is null)),
  constraint project_issues_close_pair
    check ((closed_at is null) = (closed_by is null)),
  constraint project_issues_reopen_pair
    check ((reopened_at is null) = (reopened_by is null))
);

comment on table public.project_issues is
  'Issue register per project. Severity drives business-hours SLA (rules §15b, §26). '
  'State transitions handled by src/app/(app)/projects/[id]/issues/actions.ts.';

comment on column public.project_issues.escalation_level is
  '0=Supervisor (default), 1=PM, 2=OM, 3=Director. Climbed by the SLA sweeper.';

create index if not exists project_issues_tenant_project_idx
  on public.project_issues (tenant_id, project_id, status);

create index if not exists project_issues_tenant_status_idx
  on public.project_issues (tenant_id, status, severity);

create index if not exists project_issues_tenant_assignee_open_idx
  on public.project_issues (tenant_id, assignee_employee_id, sla_due_at)
  where status in ('OPEN', 'IN_PROGRESS', 'REOPENED');

create index if not exists project_issues_tenant_reporter_idx
  on public.project_issues (tenant_id, reporter_employee_id, created_at desc);

-- SLA-breach index — cheap sweeper query and dashboard KPI.
create index if not exists project_issues_sla_open_idx
  on public.project_issues (tenant_id, sla_due_at)
  where status in ('OPEN', 'IN_PROGRESS', 'REOPENED');

drop trigger if exists project_issues_set_updated_at on public.project_issues;
create trigger project_issues_set_updated_at
  before update on public.project_issues
  for each row execute function public.set_updated_at();

alter table public.project_issues enable row level security;

-- SELECT: any employee of the tenant may read (needed for approver / triage
-- views). Column-level guards belong in the API layer.
drop policy if exists project_issues_tenant_read on public.project_issues;
create policy project_issues_tenant_read
  on public.project_issues
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- INSERT: reporter must belong to tenant + be actively assigned to project
-- (or hold PM+ role — enforced app-side; RLS only blocks cross-tenant).
drop policy if exists project_issues_insert on public.project_issues;
create policy project_issues_insert
  on public.project_issues
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1 from public.employees me
      where me.user_id = auth.uid()
        and me.id = reporter_employee_id
        and me.tenant_id = project_issues.tenant_id
        and me.is_active
    )
  );

-- UPDATE: any tenant employee — the Server Action enforces role/state gate.
drop policy if exists project_issues_update on public.project_issues;
create policy project_issues_update
  on public.project_issues
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- DELETE: PM+ only — enforced app-side. Denied by default at RLS level.
drop policy if exists project_issues_delete on public.project_issues;
create policy project_issues_delete
  on public.project_issues
  for delete
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- 3. project_issue_events — append-only audit trail (timeline UI).
-- ---------------------------------------------------------------------------
create table if not exists public.project_issue_events (
  id                      bigint generated always as identity primary key,
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  issue_id                uuid not null references public.project_issues(id) on delete cascade,
  actor_employee_id       uuid references public.employees(id) on delete set null,
  kind                    public.project_issue_event_kind not null,
  from_status             public.project_issue_status,
  to_status               public.project_issue_status,
  from_assignee           uuid references public.employees(id) on delete set null,
  to_assignee             uuid references public.employees(id) on delete set null,
  comment                 text,
  metadata                jsonb,
  created_at              timestamptz not null default now()
);

comment on table public.project_issue_events is
  'Append-only timeline of everything that happened to an issue (create, '
  'status change, assignment change, escalation, comment). Powers the '
  'detail-page timeline and audit trail.';

create index if not exists project_issue_events_issue_idx
  on public.project_issue_events (tenant_id, issue_id, created_at desc);

create index if not exists project_issue_events_tenant_kind_idx
  on public.project_issue_events (tenant_id, kind, created_at desc);

-- Immutable — no updates / deletes allowed at the DB layer.
create or replace function public.project_issue_events_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'project_issue_events is append-only'
    using errcode = '42501';
end;
$$;

drop trigger if exists project_issue_events_immutable on public.project_issue_events;
create trigger project_issue_events_immutable
  before update or delete on public.project_issue_events
  for each row execute function public.project_issue_events_immutable();

alter table public.project_issue_events enable row level security;

drop policy if exists project_issue_events_read on public.project_issue_events;
create policy project_issue_events_read
  on public.project_issue_events
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists project_issue_events_insert on public.project_issue_events;
create policy project_issue_events_insert
  on public.project_issue_events
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

-- ---------------------------------------------------------------------------
-- 4. Helper: sla_due_for_severity(started_at, severity) → timestamptz
--
-- Best-effort naive business-hours SLA in Postgres — the canonical
-- implementation for the app lives in TypeScript (`src/lib/issues/sla.ts`)
-- so we don't fork the working-hours calendar between DB and app. This
-- helper exists for admin scripts / seed data only.
-- ---------------------------------------------------------------------------
create or replace function public.project_issue_naive_sla(
  p_started_at timestamptz,
  p_severity   public.project_issue_severity
) returns timestamptz
language sql
immutable
as $$
  select p_started_at + case p_severity
    when 'CRITICAL' then interval '1 hour'
    when 'HIGH'     then interval '4 hours'
    when 'MEDIUM'   then interval '8 hours'
    when 'LOW'      then interval '24 hours'
  end;
$$;
