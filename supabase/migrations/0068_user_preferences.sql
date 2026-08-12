-- Migration 0068: User notification preferences (Phase 1 of Preferences page)
--
-- Rules alignment:
--   §5       — tenant_id NOT NULL + RLS.
--   §17     — one row per (user_id, category, channel) so writers can
--             do a single upsert per toggle without contention.
--   §18     — default state = "all ON" per user's product decision.
--   §20     — dispatcher will read from this table to gate delivery
--             per channel; unset row == implicit ALLOW (fail-open).
--
-- Adds 4 notification_kind values:
--   - TIMESHEET_SUBMITTED   (employee submitted a weekly timesheet)
--   - TIMESHEET_APPROVED    (PM/SPV approved the timesheet)
--   - TIMESHEET_REJECTED    (PM/SPV returned it for changes)
--   - BULK_IMPORT_COMPLETED (HR/Finance finished a bulk import job)
--
-- Rollback:
--   drop policy if exists user_notification_prefs_read on public.user_notification_preferences;
--   drop policy if exists user_notification_prefs_write on public.user_notification_preferences;
--   drop table if exists public.user_notification_preferences;
--   drop type if exists notification_channel;
--   drop type if exists notification_category;

begin;

-- ---------------------------------------------------------------------
-- 1. Enums.
-- ---------------------------------------------------------------------
create type notification_category as enum (
  'APPROVALS',
  'BUDGETS',
  'MILESTONES',
  'ASSIGNMENTS',
  'TIMESHEETS',
  'EMPLOYEES',
  'SYSTEM'
);

create type notification_channel as enum (
  'IN_APP',
  'EMAIL',
  'TELEGRAM'
);

-- ---------------------------------------------------------------------
-- 2. Table: user_notification_preferences.
-- ---------------------------------------------------------------------
create table public.user_notification_preferences (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  category notification_category not null,
  channel notification_channel not null,
  enabled boolean not null default true,
  updated_at timestamp with time zone not null default now(),
  primary key (tenant_id, user_id, category, channel)
);

comment on table public.user_notification_preferences is
  'Per-user × per-category × per-channel toggle for notification delivery. Fail-open — missing rows treated as ALLOW so unmigrated tenants keep getting notifications.';

create index user_notification_prefs_user_idx
  on public.user_notification_preferences (tenant_id, user_id);

-- ---------------------------------------------------------------------
-- 3. RLS — user only reads / writes their own row.
-- ---------------------------------------------------------------------
alter table public.user_notification_preferences enable row level security;

create policy user_notification_prefs_read
  on public.user_notification_preferences
  as permissive
  for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  );

create policy user_notification_prefs_write
  on public.user_notification_preferences
  as permissive
  for all
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  )
  with check (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  );

-- ---------------------------------------------------------------------
-- 4. Add new notification_kind values for the "Timesheets" category
--    (so mockup's Timesheets toggle actually has kinds to gate) and
--    for the bulk-import feature we just shipped.
-- ---------------------------------------------------------------------
do $$
declare
  new_kinds text[] := array[
    'TIMESHEET_SUBMITTED',
    'TIMESHEET_APPROVED',
    'TIMESHEET_REJECTED',
    'BULK_IMPORT_COMPLETED'
  ];
  k text;
begin
  foreach k in array new_kinds loop
    if not exists (
      select 1 from pg_enum
      where enumtypid = 'public.notification_kind'::regtype
        and enumlabel = k
    ) then
      execute format('alter type public.notification_kind add value %L', k);
    end if;
  end loop;
end
$$;

commit;
