-- Migration 0067: Bulk import infrastructure
--
-- Rules alignment:
--   §3 audit  — bulk imports emit ONE audit row per batch, not per data
--                row. `import_jobs.stats` + `errors` retain the full
--                per-row context inside the batch row so investigators
--                can still reconstruct what was ingested (rules §22
--                retention 7 years on `security_audit_logs`).
--   §5       — every `import_jobs` row scoped to `tenant_id`, RLS applied.
--   §17     — resource `import_job` + action `bulk_import` for PDP hooks.
--   §22     — `created_at` indexed for periodic cleanup (>90 days).
--
-- Also extends `employees` to match the "Bulk import" mockup:
--   - `emergency_contact_name`, `emergency_contact_phone`, `notes` — all
--     nullable optional profile fields.
--
-- Rollback:
--   drop policy if exists import_jobs_read on public.import_jobs;
--   drop policy if exists import_jobs_write on public.import_jobs;
--   drop table if exists public.import_jobs;
--   alter table public.employees drop column if exists emergency_contact_name;
--   alter table public.employees drop column if exists emergency_contact_phone;
--   alter table public.employees drop column if exists notes;

begin;

-- ---------------------------------------------------------------------
-- 1. Extend employees with the missing profile columns.
-- ---------------------------------------------------------------------
alter table public.employees
  add column if not exists emergency_contact_name text null,
  add column if not exists emergency_contact_phone text null,
  add column if not exists notes text null;

comment on column public.employees.emergency_contact_name is
  'Free-text emergency contact person. Populated by HR or via bulk import (migration 0067).';
comment on column public.employees.emergency_contact_phone is
  'Free-text emergency contact phone. NOT masked in UI because it is contact information (unlike bank_account_number which is masked).';
comment on column public.employees.notes is
  'HR-owned free-text notes about the employee (probation, watch-list, etc.). Visible only to HR / TENANT_ADMIN roles via PDP `employee.read` gate.';

-- ---------------------------------------------------------------------
-- 2. import_jobs — one row per bulk-import batch (dry-run OR commit).
-- ---------------------------------------------------------------------
create type import_job_resource as enum (
  'EMPLOYEE',
  'CLIENT',
  'PROJECT',
  'BUDGET_LINE',
  'EXPENSE',
  'PETTY_CASH'
);

create type import_job_status as enum (
  'DRY_RUN',
  'COMMITTED',
  'FAILED'
);

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  resource import_job_resource not null,
  status import_job_status not null,
  file_name text not null,
  file_size_bytes integer not null,
  row_count integer not null default 0,
  valid_row_count integer not null default 0,
  invalid_row_count integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  -- errors: array of { row_number, field, message, raw_value } for
  -- both dry-run + committed jobs. Retained with the job.
  errors jsonb not null default '[]'::jsonb,
  -- stats: freeform summary (e.g. `{ departments_resolved: 12,
  -- unknown_codes: ["MKT"] }`).
  stats jsonb not null default '{}'::jsonb,
  -- Convenience: user + timestamps.
  created_by uuid null,
  created_at timestamp with time zone not null default now(),
  committed_at timestamp with time zone null
);

comment on table public.import_jobs is
  'Bulk import job ledger. Each row = one batch. Successful dry-runs and committed imports both retained; failed imports keep their error report for postmortem.';

create index import_jobs_tenant_created_idx
  on public.import_jobs (tenant_id, created_at desc);
create index import_jobs_resource_status_idx
  on public.import_jobs (tenant_id, resource, status);

-- ---------------------------------------------------------------------
-- 3. RLS — tenant read + write.
-- ---------------------------------------------------------------------
alter table public.import_jobs enable row level security;

create policy import_jobs_read on public.import_jobs
  as permissive
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- Write is gated by PDP `bulk_import`. RLS just enforces tenant scope +
-- the write-role matrix so DB is safe even if PDP is bypassed.
create policy import_jobs_write on public.import_jobs
  as permissive
  for all
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'HR_ADMIN',
      'TENANT_ADMIN',
      'GENERAL_MANAGER',
      'HEAD_MANAGER',
      'OPERATIONS_MANAGER',
      'LEAD_FINANCE'
    )
  );

-- ---------------------------------------------------------------------
-- 4. Add `BULK_IMPORT` to audit_action_type enum for observability.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.audit_action_type'::regtype
      and enumlabel = 'BULK_IMPORT'
  ) then
    alter type public.audit_action_type add value 'BULK_IMPORT';
  end if;
end
$$;

commit;
