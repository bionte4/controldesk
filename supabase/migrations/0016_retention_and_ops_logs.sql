-- ControlDesk — 0016_retention_and_ops_logs.sql
-- Rules §20 (digest email log) + §22 (retention worker + HR anonymisation).
--
-- Adds:
--   * `employees.terminated_at`   — canonical termination timestamp used by the
--     5-year anonymisation cron.
--   * `employees.pii_anonymized_at` — set once anonymisation has been applied.
--   * function `anonymize_terminated_employee(uuid)` — replaces PII fields with
--     deterministic redactions while keeping FK references intact.
--   * `cron_run_log`  — one row per cron invocation (retention + digest).
--   * `email_outbox`  — audit log of every email we dispatch (digest,
--     approval notifications, etc.). Enables "who received what, when".
--
-- Rollback:
--   drop table if exists public.email_outbox;
--   drop table if exists public.cron_run_log;
--   drop function if exists public.anonymize_terminated_employee(uuid);
--   alter table public.employees drop column if exists pii_anonymized_at;
--   alter table public.employees drop column if exists terminated_at;

-- ---------------------------------------------------------------------------
-- 1. employees termination + anonymisation columns
-- ---------------------------------------------------------------------------
alter table public.employees
  add column if not exists terminated_at        timestamptz,
  add column if not exists pii_anonymized_at    timestamptz;

comment on column public.employees.terminated_at is
  'Termination timestamp. Feeds retention anonymisation cron (rules §22).';
comment on column public.employees.pii_anonymized_at is
  'Set by anonymize_terminated_employee(). Once populated, PII columns hold redacted values only.';

create index if not exists employees_terminated_at_idx
  on public.employees (tenant_id, terminated_at)
  where terminated_at is not null;

-- ---------------------------------------------------------------------------
-- 2. anonymize_terminated_employee(employee_id)
--
-- Idempotent: if already anonymised, exits without changes. Otherwise replaces
-- name/email/bank_account with deterministic redactions derived from md5 of
-- the row id, then marks pii_anonymized_at.
--
-- Keeps `id`, `tenant_id`, `role`, `is_active`, `terminated_at` intact so
-- historical FKs (timesheets, expenses, approvals) still resolve.
-- ---------------------------------------------------------------------------
create or replace function public.anonymize_terminated_employee(
  p_employee_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash        text;
  v_tenant      uuid;
  v_terminated  timestamptz;
  v_anon        timestamptz;
begin
  select tenant_id, terminated_at, pii_anonymized_at
    into v_tenant, v_terminated, v_anon
    from public.employees
    where id = p_employee_id;

  if v_tenant is null then
    raise exception 'employee not found: %', p_employee_id;
  end if;
  if v_anon is not null then
    return; -- already anonymised
  end if;
  if v_terminated is null then
    raise exception 'cannot anonymise active employee %', p_employee_id;
  end if;
  if v_terminated > now() - interval '5 years' then
    raise exception 'employee % not yet past retention window', p_employee_id;
  end if;

  v_hash := substr(md5(p_employee_id::text), 1, 8);

  update public.employees
    set full_name             = '[REDACTED_' || v_hash || ']',
        email                 = 'redacted+' || v_hash || '@anonymized.controldesk.app',
        bank_account_number   = null,
        monthly_salary        = 0,
        hourly_rate           = 0,
        preferred_locale      = null,
        pii_anonymized_at     = now()
    where id = p_employee_id;
end;
$$;

comment on function public.anonymize_terminated_employee is
  'Rules §22 — anonymise a terminated employee''s PII after the 5-year retention window. Idempotent.';

revoke all on function public.anonymize_terminated_employee(uuid) from public;
grant execute on function public.anonymize_terminated_employee(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. cron_run_log — observability for scheduled jobs.
-- ---------------------------------------------------------------------------
create table if not exists public.cron_run_log (
  id             uuid primary key default gen_random_uuid(),
  job_name       text not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'RUNNING' check (status in ('RUNNING','SUCCESS','FAILED','SKIPPED')),
  dry_run        boolean not null default false,
  rows_processed integer not null default 0,
  details        jsonb,
  error_message  text
);

comment on table public.cron_run_log is
  'One row per cron invocation (retention, digest, etc.). Rules §21 observability.';

create index if not exists cron_run_log_job_idx
  on public.cron_run_log (job_name, started_at desc);

-- No RLS: cron_run_log is service-role only.
alter table public.cron_run_log enable row level security;

drop policy if exists cron_run_log_service_all on public.cron_run_log;
create policy cron_run_log_service_all
  on public.cron_run_log
  for all
  to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- 4. email_outbox — auditable log of dispatched emails.
-- ---------------------------------------------------------------------------
create table if not exists public.email_outbox (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid references public.tenants(id) on delete cascade,
  to_address        text not null,
  from_address      text not null,
  subject           text not null,
  body_text         text,
  body_html         text,
  status            text not null default 'PENDING'
                    check (status in ('PENDING','SENT','FAILED','SKIPPED')),
  provider          text,
  provider_message_id text,
  error_message     text,
  metadata          jsonb,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz
);

comment on table public.email_outbox is
  'Audit log of every transactional email dispatched (digest, approvals, etc.). Rules §20.';

create index if not exists email_outbox_tenant_idx
  on public.email_outbox (tenant_id, created_at desc);
create index if not exists email_outbox_status_idx
  on public.email_outbox (status, created_at desc)
  where status in ('PENDING','FAILED');

alter table public.email_outbox enable row level security;

drop policy if exists email_outbox_service_all on public.email_outbox;
create policy email_outbox_service_all
  on public.email_outbox
  for all
  to service_role
  using (true)
  with check (true);

-- Tenant admins may read their own tenant's outbox for troubleshooting.
drop policy if exists email_outbox_tenant_admin_read on public.email_outbox;
create policy email_outbox_tenant_admin_read
  on public.email_outbox
  for select
  to authenticated
  using (
    tenant_id is not null
    and tenant_id = public.current_tenant_id()
    and public.current_employee_role() in ('TENANT_ADMIN','GENERAL_MANAGER')
  );
