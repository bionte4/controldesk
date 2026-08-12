-- ControlDesk — 0023_client_users.sql
-- Fase 0 slice 2 — Client Portal external auth (rules §28 GAS Client Portal).
--
-- Introduces a *separate* auth surface for external client contacts who need
-- read-only access to their own projects, milestones, invoices, and issues.
-- These users are NOT `auth.users` / `employees` — they authenticate against
-- their own credentials so we can keep employee JWT + RBAC space isolated
-- from customer identities.
--
-- This migration lands the SCHEMA only. Wire-up to a JWT / session cookie
-- lives in Fase 1 (`src/app/(portal)/*` route group). Until then the table
-- is inaccessible except via service_role.
--
-- Rollback:
--   drop table if exists public.client_user_sessions;
--   drop table if exists public.client_users;
--   drop type if exists public.client_user_status;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'client_user_status') then
    create type public.client_user_status as enum (
      'PENDING_ACTIVATION',
      'ACTIVE',
      'DISABLED',
      'LOCKED'
    );
  end if;
end $$;

create table if not exists public.client_users (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  client_id             uuid not null references public.clients(id) on delete cascade,
  email                 citext not null,
  password_hash         text not null,
  full_name             text not null,
  status                public.client_user_status not null default 'PENDING_ACTIVATION',
  activation_token_hash text,
  activation_expires_at timestamptz,
  last_login_at         timestamptz,
  failed_login_count    integer not null default 0,
  locked_until          timestamptz,
  created_by            uuid references public.employees(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint client_users_email_shape check (position('@' in email) > 1),
  constraint client_users_name_not_blank check (length(trim(full_name)) > 0)
);

comment on table public.client_users is
  'External client portal users (rules §28). Separate auth from `auth.users`/`employees` — one row per client contact. Password hashed with bcrypt at the app layer.';

create unique index if not exists client_users_tenant_email_uniq
  on public.client_users (tenant_id, lower(email));
create index if not exists client_users_tenant_client_idx
  on public.client_users (tenant_id, client_id, status);

drop trigger if exists client_users_set_updated_at on public.client_users;
create trigger client_users_set_updated_at
  before update on public.client_users
  for each row execute function public.set_updated_at();

alter table public.client_users enable row level security;

-- Fase 0: service_role only. Fase 1 introduces a `is_client_portal_user()`
-- claim helper that lets a portal-session user SELECT their own row.
drop policy if exists client_users_service_role_only on public.client_users;
create policy client_users_service_role_only
  on public.client_users
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- 2. Portal session tokens (opaque, hashed, TTL-scoped).
--    Emitted by the portal login Server Action; validated on every portal
--    request. NOT a JWT — we keep client sessions revocable server-side.
-- ---------------------------------------------------------------------------
create table if not exists public.client_user_sessions (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  client_user_id        uuid not null references public.client_users(id) on delete cascade,
  token_hash            text not null,
  ip_address            inet,
  user_agent            text,
  issued_at             timestamptz not null default now(),
  expires_at            timestamptz not null,
  revoked_at            timestamptz,
  constraint client_user_sessions_ttl_ok check (expires_at > issued_at)
);

comment on table public.client_user_sessions is
  'Server-side portal sessions (rules §28). Tokens are hashed (never stored plaintext) and TTL-bounded. Revoke by setting `revoked_at`.';

create index if not exists client_user_sessions_client_user_idx
  on public.client_user_sessions (client_user_id, expires_at)
  where revoked_at is null;
create index if not exists client_user_sessions_expiry_idx
  on public.client_user_sessions (expires_at)
  where revoked_at is null;

alter table public.client_user_sessions enable row level security;

drop policy if exists client_user_sessions_service_role_only on public.client_user_sessions;
create policy client_user_sessions_service_role_only
  on public.client_user_sessions
  as permissive
  for all
  to service_role
  using (true)
  with check (true);
