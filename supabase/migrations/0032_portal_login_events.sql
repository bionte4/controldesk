-- =============================================================================
-- ControlDesk — 0032_portal_login_events.sql
-- Fase 2 · Client Portal wire-up (GAS §28, rules §3 audit trail, rules §21).
--
-- Migration 0023 landed the `client_users` and `client_user_sessions` schema.
-- This migration adds the append-only audit trail for portal authentication
-- events. Portal users don't have `auth.users` rows, so they cannot be logged
-- via `security_audit_logs.actor_id`; we need a dedicated table.
--
-- Events captured:
--   • SUCCESS               — password verified, session issued
--   • FAILURE_UNKNOWN_USER  — email did not match any `client_users` row
--   • FAILURE_BAD_PASSWORD  — email matched but password verify failed
--   • FAILURE_LOCKED        — account locked (`locked_until > now()`)
--   • LOGOUT                — session revoked via server action
--   • SESSION_EXPIRED       — expired session presented to middleware
--
-- The table is INSERT-only (UPDATE / DELETE blocked via trigger). Rules §22
-- retention: keep 7 years alongside `security_audit_logs`.
--
-- Rollback:
--   drop trigger if exists portal_login_events_immutable
--     on public.portal_login_events;
--   drop function if exists public.portal_login_events_immutable();
--   drop table if exists public.portal_login_events;
--   drop function if exists public.resolve_tenant_id_by_slug(citext);
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. resolve_tenant_id_by_slug — required by the Client Portal proxy branch
--    to resolve tenant_id from the URL host BEFORE the visitor has
--    authenticated. Enumeration-safe: callers must already know the slug.
--    Returns NULL for unknown slugs; never exposes other columns.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_tenant_id_by_slug(p_slug citext)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.tenants where slug = p_slug;
$$;

comment on function public.resolve_tenant_id_by_slug(citext) is
  'Client Portal proxy helper (rules §28). Returns the tenant id for a given subdomain slug or NULL. Enumeration-safe: exposes only the id, no PII.';

revoke all on function public.resolve_tenant_id_by_slug(citext) from public;
grant execute on function public.resolve_tenant_id_by_slug(citext)
  to anon, authenticated, service_role;

create table if not exists public.portal_login_events (
  id                bigint generated always as identity primary key,
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  -- Nullable because failures with UNKNOWN_USER have no client_users row.
  client_user_id    uuid references public.client_users(id) on delete set null,
  -- Preserved for forensics even when the email doesn't resolve to a user.
  email_attempted   citext,
  event             text not null check (event in (
    'SUCCESS',
    'FAILURE_UNKNOWN_USER',
    'FAILURE_BAD_PASSWORD',
    'FAILURE_LOCKED',
    'LOGOUT',
    'SESSION_EXPIRED'
  )),
  ip_address        inet,
  user_agent        text,
  created_at        timestamptz not null default now()
);

comment on table public.portal_login_events is
  'Append-only audit trail for Client Portal authentication (rules §3, §22 retention 7y).';

create index if not exists portal_login_events_tenant_ts_idx
  on public.portal_login_events (tenant_id, created_at desc);

create index if not exists portal_login_events_email_idx
  on public.portal_login_events (tenant_id, email_attempted, created_at desc)
  where email_attempted is not null;

create index if not exists portal_login_events_client_user_idx
  on public.portal_login_events (tenant_id, client_user_id, created_at desc)
  where client_user_id is not null;

-- ---------------------------------------------------------------------------
-- Append-only enforcement.
-- ---------------------------------------------------------------------------
create or replace function public.portal_login_events_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'portal_login_events is append-only'
    using errcode = '42501';
end;
$$;

drop trigger if exists portal_login_events_immutable
  on public.portal_login_events;
create trigger portal_login_events_immutable
  before update or delete on public.portal_login_events
  for each row execute function public.portal_login_events_immutable();

-- ---------------------------------------------------------------------------
-- RLS — service_role only (writes happen from the portal login Server Action
-- using the service-role Supabase client).
-- ---------------------------------------------------------------------------
alter table public.portal_login_events enable row level security;

drop policy if exists portal_login_events_service_role_only
  on public.portal_login_events;
create policy portal_login_events_service_role_only
  on public.portal_login_events
  as permissive
  for all
  to service_role
  using (true)
  with check (true);
