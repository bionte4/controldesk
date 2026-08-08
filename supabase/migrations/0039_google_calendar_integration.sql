-- ControlDesk — 0039_google_calendar_integration.sql
--
-- Google Calendar publisher scaffolding (rules §7, §18, §19).
--
-- Two additions:
--
--   1. `google_calendar_credentials` — one row per tenant that has opted in
--      to Calendar sync. Stores an OAuth refresh_token encrypted at rest
--      (pgcrypto pgp_sym_encrypt using the session GUC `app.enc_key`; see
--      src/lib/security/crypto.ts). The plaintext token never touches the
--      Postgres wire log because callers write via
--      `set_google_credential_refresh_token()` (SECURITY DEFINER RPC below)
--      which does the encryption inside a single SQL expression.
--
--   2. `project_calendar_events` — outbox table drained by the
--      `/api/cron/google-calendar-drain` route. Every project mutation the
--      wizard opted-in to (`projects.sync_calendar = true`) writes one
--      PENDING row per event kind. The drain cron picks these up, calls the
--      Google Calendar API, and moves the row to SENT (or FAILED with
--      `attempts` bumped and `last_error` populated).
--
-- Rollback:
--   drop function if exists public.set_google_credential_refresh_token(uuid, text, text, text);
--   drop function if exists public.get_google_credential_refresh_token(uuid);
--   drop table if exists public.project_calendar_events;
--   drop table if exists public.google_calendar_credentials;
--   drop type  if exists public.calendar_event_kind;
--   drop type  if exists public.calendar_event_status;

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'calendar_event_kind') then
    create type public.calendar_event_kind as enum (
      'PROJECT_CREATED',
      'PROJECT_UPDATED',
      'PROJECT_DELETED',
      'MILESTONE_CREATED',
      'MILESTONE_UPDATED',
      'MILESTONE_DELETED'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'calendar_event_status') then
    create type public.calendar_event_status as enum (
      'PENDING',
      'SENT',
      'FAILED',
      'SKIPPED'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. google_calendar_credentials — one row per tenant
-- ---------------------------------------------------------------------------
create table if not exists public.google_calendar_credentials (
  tenant_id                 uuid primary key references public.tenants(id) on delete cascade,
  calendar_id               text not null default 'primary',
  client_email              text,
  encrypted_refresh_token   bytea not null,
  is_active                 boolean not null default true,
  last_refreshed_at         timestamptz,
  last_error                text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint google_credentials_calendar_id_len
    check (calendar_id = 'primary' or char_length(calendar_id) between 3 and 254),
  constraint google_credentials_client_email_shape
    check (client_email is null or client_email ~ '^[^@]+@[^@]+\.[^@]+$')
);

comment on table public.google_calendar_credentials is
  'Per-tenant Google Calendar OAuth credentials (rules §7 + §18). refresh_token is stored encrypted via pgp_sym_encrypt(app.enc_key). Only service_role and the SECURITY DEFINER RPCs below may read/write this table.';

create index if not exists google_credentials_active_idx
  on public.google_calendar_credentials (is_active)
  where is_active = true;

alter table public.google_calendar_credentials enable row level security;

drop policy if exists google_credentials_service_all
  on public.google_calendar_credentials;
create policy google_credentials_service_all
  on public.google_calendar_credentials
  for all
  to service_role
  using (true)
  with check (true);

-- Deny-all for regular authenticated users — refresh tokens are strictly
-- server-side. Reads happen through the SECURITY DEFINER RPC below so the
-- Node runtime never sees ciphertext directly either.
drop policy if exists google_credentials_no_direct_access
  on public.google_calendar_credentials;
create policy google_credentials_no_direct_access
  on public.google_calendar_credentials
  for all
  to authenticated
  using (false)
  with check (false);

-- SECURITY DEFINER write helper. Encrypts the refresh_token inside a single
-- SQL expression so the plaintext never appears in logs even if
-- `log_statement = 'all'` is enabled.
create or replace function public.set_google_credential_refresh_token(
  p_tenant_id     uuid,
  p_refresh_token text,
  p_calendar_id   text default 'primary',
  p_client_email  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.google_calendar_credentials (
    tenant_id, calendar_id, client_email, encrypted_refresh_token, is_active
  ) values (
    p_tenant_id,
    coalesce(p_calendar_id, 'primary'),
    p_client_email,
    pgp_sym_encrypt(p_refresh_token, current_setting('app.enc_key')),
    true
  )
  on conflict (tenant_id) do update set
    calendar_id             = coalesce(excluded.calendar_id, google_calendar_credentials.calendar_id),
    client_email            = coalesce(excluded.client_email, google_calendar_credentials.client_email),
    encrypted_refresh_token = excluded.encrypted_refresh_token,
    is_active               = true,
    last_error              = null,
    updated_at              = now();
end;
$$;

comment on function public.set_google_credential_refresh_token(uuid, text, text, text) is
  'Upsert a tenant Google refresh token. Encrypts inline via app.enc_key so plaintext never lands in Postgres logs. Callable only by service_role.';

revoke all on function public.set_google_credential_refresh_token(uuid, text, text, text) from public;
grant execute on function public.set_google_credential_refresh_token(uuid, text, text, text) to service_role;

-- SECURITY DEFINER read helper — decrypts refresh_token for the drain cron.
create or replace function public.get_google_credential_refresh_token(
  p_tenant_id uuid
)
returns table (
  refresh_token text,
  calendar_id   text,
  client_email  text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select
      pgp_sym_decrypt(gcc.encrypted_refresh_token::bytea, current_setting('app.enc_key')),
      gcc.calendar_id,
      gcc.client_email
    from public.google_calendar_credentials gcc
    where gcc.tenant_id = p_tenant_id
      and gcc.is_active = true;
end;
$$;

comment on function public.get_google_credential_refresh_token(uuid) is
  'Return decrypted refresh_token + calendar metadata for a tenant. Callable only by service_role.';

revoke all on function public.get_google_credential_refresh_token(uuid) from public;
grant execute on function public.get_google_credential_refresh_token(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. project_calendar_events outbox
-- ---------------------------------------------------------------------------
create table if not exists public.project_calendar_events (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  project_id        uuid not null references public.projects(id) on delete cascade,
  milestone_id      uuid references public.project_milestones(id) on delete cascade,
  kind              public.calendar_event_kind not null,
  status            public.calendar_event_status not null default 'PENDING',
  attempts          integer not null default 0 check (attempts >= 0),
  google_event_id   text,
  last_error        text,
  scheduled_at      timestamptz not null default now(),
  sent_at           timestamptz,
  payload           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint project_calendar_events_milestone_kind_agrees
    check (
      -- Milestone-scoped kinds require a milestone_id; project-scoped kinds
      -- must not set one. Keeps the outbox self-describing without a
      -- runtime lookup on drain.
      (kind in ('MILESTONE_CREATED','MILESTONE_UPDATED','MILESTONE_DELETED')
        and milestone_id is not null)
      or
      (kind in ('PROJECT_CREATED','PROJECT_UPDATED','PROJECT_DELETED')
        and milestone_id is null)
    )
);

comment on table public.project_calendar_events is
  'Outbox for Google Calendar sync (rules §7 + §19). Written when a project or milestone changes on a tenant whose `google_calendar_credentials.is_active = true`. Drained every 10 minutes by /api/cron/google-calendar-drain.';

-- Drain lookup: pending or retry-eligible rows, oldest first.
create index if not exists project_calendar_events_drain_idx
  on public.project_calendar_events (tenant_id, status, scheduled_at)
  where status in ('PENDING', 'FAILED');

-- Reverse lookup for observability + admin UI (e.g. "show sync history for
-- this project").
create index if not exists project_calendar_events_project_idx
  on public.project_calendar_events (tenant_id, project_id, created_at desc);

alter table public.project_calendar_events enable row level security;

drop policy if exists project_calendar_events_service_all
  on public.project_calendar_events;
create policy project_calendar_events_service_all
  on public.project_calendar_events
  for all
  to service_role
  using (true)
  with check (true);

-- Tenant admins can SELECT their own tenant's outbox for observability.
drop policy if exists project_calendar_events_tenant_admin_read
  on public.project_calendar_events;
create policy project_calendar_events_tenant_admin_read
  on public.project_calendar_events
  for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1
        from public.employees e
       where e.user_id = auth.uid()
         and e.tenant_id = public.current_tenant_id()
         and e.role in ('TENANT_ADMIN'::public.employee_role,
                        'GENERAL_MANAGER'::public.employee_role)
    )
  );

-- No INSERT / UPDATE / DELETE for authenticated — only server code writes.
drop policy if exists project_calendar_events_no_client_write
  on public.project_calendar_events;
create policy project_calendar_events_no_client_write
  on public.project_calendar_events
  for insert
  to authenticated
  with check (false);
