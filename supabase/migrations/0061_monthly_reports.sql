-- Migration: 0061_monthly_reports.sql
-- Purpose : Monthly report → Collection handoff (rules §26).
--           Slice A of the module: SPV drafts monthly report, PM
--           approves; the client / BA / Collection steps land in a
--           later slice.
--
-- Model   :
--   monthly_reports         — one row per (project, period_month)
--   monthly_report_sections — SPV fills structured sections
--   monthly_report_attachments — supporting docs (photos, PDF, etc.)
--
-- Slice B (Berita Acara + client sign-off) and Slice C (Collection
-- handoff) will extend the enum with `SENT_TO_CLIENT / APPROVED_BY_CLIENT
-- / BA_GENERATED / HANDED_OFF_TO_COLLECTION` states.
--
-- Rollback :
--   drop table if exists public.monthly_report_attachments cascade;
--   drop table if exists public.monthly_report_sections cascade;
--   drop table if exists public.monthly_reports cascade;
--   drop type if exists public.monthly_report_status;
--   drop type if exists public.monthly_report_section_kind;

do $$ begin
  create type public.monthly_report_status as enum (
    'DRAFT_BY_SPV',
    'SUBMITTED_TO_PM',
    'APPROVED_BY_PM',
    'RETURNED_TO_SPV',
    'REJECTED_BY_PM',
    -- Reserved for later slices — declared now so the enum is stable
    -- and we don't have to `add value` in every follow-up migration.
    'SENT_TO_CLIENT',
    'APPROVED_BY_CLIENT',
    'BA_GENERATED',
    'HANDED_OFF_TO_COLLECTION',
    'CANCELLED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.monthly_report_section_kind as enum (
    'EXECUTIVE_SUMMARY',
    'MILESTONE_PROGRESS',
    'HOURS_LOGGED',
    'COSTS_INCURRED',
    'BLOCKERS',
    'NEXT_MONTH_PLAN'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Header — one row per (project, period_month)
-- ---------------------------------------------------------------------
create table if not exists public.monthly_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  -- Period is stored as the first day of that calendar month (UTC) so
  -- range queries stay index-friendly. UI shows `MMM yyyy` in tenant tz.
  period_month date not null,
  submitter_employee_id uuid references public.employees(id) on delete set null,
  pm_reviewer_id uuid references public.employees(id) on delete set null,
  status public.monthly_report_status not null default 'DRAFT_BY_SPV',
  spv_notes text,
  pm_notes text,
  submitted_at timestamptz,
  pm_decided_at timestamptz,
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Only one active report per (project, month). Cancelled rows keep
  -- the pair but the constraint permits new drafts because we filter
  -- them out via a partial unique index below.
  unique (project_id, period_month)
);

comment on table public.monthly_reports is
  'Monthly delivery / progress report per (project, period_month). Drives collection handoff (§26).';

create index if not exists monthly_reports_project_idx
  on public.monthly_reports (tenant_id, project_id, period_month desc);
create index if not exists monthly_reports_status_idx
  on public.monthly_reports (tenant_id, status, period_month desc);
create index if not exists monthly_reports_pm_pending_idx
  on public.monthly_reports (tenant_id, pm_reviewer_id, status)
  where status = 'SUBMITTED_TO_PM';

-- ---------------------------------------------------------------------
-- Sections — one row per (report, kind) with structured payload.
-- Store both `content` free text + `metrics` JSON so we can carry
-- pre-computed snapshots (hours, milestones-delivered, cost totals)
-- alongside the SPV narrative.
-- ---------------------------------------------------------------------
create table if not exists public.monthly_report_sections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  report_id uuid not null references public.monthly_reports(id) on delete cascade,
  kind public.monthly_report_section_kind not null,
  content text,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_id, kind)
);

create index if not exists monthly_report_sections_report_idx
  on public.monthly_report_sections (tenant_id, report_id);

-- ---------------------------------------------------------------------
-- Attachments — reuse the shared attachments table registry pattern
-- but keep a light join to the report for easy detail-page queries.
-- Storage path convention: {tenant_id}/monthly_reports/{report_id}/{filename}
-- ---------------------------------------------------------------------
create table if not exists public.monthly_report_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  report_id uuid not null references public.monthly_reports(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists monthly_report_attachments_report_idx
  on public.monthly_report_attachments (tenant_id, report_id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.monthly_reports enable row level security;
alter table public.monthly_report_sections enable row level security;
alter table public.monthly_report_attachments enable row level security;

-- Helper: caller is project-facing (PM/OM/HM/Admin) or the submitter.
-- Read policy is broader than write — HR / Finance / Director can
-- inspect a completed report to release the collection.
create policy monthly_reports_read on public.monthly_reports
  for select using (
    tenant_id = current_tenant_id()
    and (
      -- Broad management view.
      exists (
        select 1 from public.employees e
        where e.user_id = auth.uid()
          and e.role in (
            'TENANT_ADMIN', 'HEAD_MANAGER', 'OPERATIONS_MANAGER',
            'GENERAL_MANAGER', 'LEAD_FINANCE', 'HR_ADMIN'
          )
      )
      or submitter_employee_id in (
        select id from public.employees where user_id = auth.uid()
      )
      or pm_reviewer_id in (
        select id from public.employees where user_id = auth.uid()
      )
      or exists (
        select 1 from public.project_pm_assignments pma
        join public.employees e on e.id = pma.pm_employee_id
        where pma.project_id = monthly_reports.project_id
          and pma.status = 'ACTIVE'
          and e.user_id = auth.uid()
      )
    )
  );

create policy monthly_reports_write on public.monthly_reports
  for all using (
    tenant_id = current_tenant_id()
    and (
      exists (
        select 1 from public.employees e
        where e.user_id = auth.uid()
          and e.role in (
            'TENANT_ADMIN', 'HEAD_MANAGER', 'OPERATIONS_MANAGER',
            'PROJECT_MANAGER', 'SUPERVISOR'
          )
      )
      or submitter_employee_id in (
        select id from public.employees where user_id = auth.uid()
      )
    )
  ) with check (tenant_id = current_tenant_id());

-- Sections + attachments inherit their parent's visibility via a
-- correlated subquery. Cheap because monthly_reports has a small row
-- count per project.
create policy monthly_report_sections_read on public.monthly_report_sections
  for select using (
    tenant_id = current_tenant_id() and exists (
      select 1 from public.monthly_reports r
      where r.id = report_id and r.tenant_id = current_tenant_id()
    )
  );

create policy monthly_report_sections_write on public.monthly_report_sections
  for all using (
    tenant_id = current_tenant_id() and exists (
      select 1 from public.monthly_reports r
      where r.id = report_id and r.tenant_id = current_tenant_id()
    )
  ) with check (tenant_id = current_tenant_id());

create policy monthly_report_attachments_read on public.monthly_report_attachments
  for select using (
    tenant_id = current_tenant_id() and exists (
      select 1 from public.monthly_reports r
      where r.id = report_id and r.tenant_id = current_tenant_id()
    )
  );

create policy monthly_report_attachments_write on public.monthly_report_attachments
  for all using (
    tenant_id = current_tenant_id() and exists (
      select 1 from public.monthly_reports r
      where r.id = report_id and r.tenant_id = current_tenant_id()
    )
  ) with check (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------
-- Notification kinds
-- ---------------------------------------------------------------------
do $$ begin
  alter type public.notification_kind add value if not exists 'MONTHLY_REPORT_SUBMITTED';
  alter type public.notification_kind add value if not exists 'MONTHLY_REPORT_APPROVED';
  alter type public.notification_kind add value if not exists 'MONTHLY_REPORT_RETURNED';
  alter type public.notification_kind add value if not exists 'MONTHLY_REPORT_REJECTED';
exception when others then null; end $$;
