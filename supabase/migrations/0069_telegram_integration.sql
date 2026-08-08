-- Migration 0069: Telegram integration (Phase 2 of Preferences page).
--
-- Two tables, both leveraging the same "service-role only" RLS pattern
-- as `google_calendar_credentials` — the client never reads / writes
-- the raw encrypted rows; server actions go through the service-role
-- client and application-side AES-256-GCM (see
-- `src/lib/security/token-crypto.ts`, rules §3).
--
--   1. `tenant_telegram_bots`  — bot token per tenant (per-tenant model
--                                agreed with product; each tenant admin
--                                registers their own bot via BotFather).
--   2. `user_telegram_links`   — chat_id per user (encrypted).
--
-- Rollback:
--   drop policy if exists user_telegram_links_no_direct on public.user_telegram_links;
--   drop policy if exists user_telegram_links_service on public.user_telegram_links;
--   drop policy if exists tenant_telegram_bots_no_direct on public.tenant_telegram_bots;
--   drop policy if exists tenant_telegram_bots_service on public.tenant_telegram_bots;
--   drop table if exists public.user_telegram_links;
--   drop table if exists public.tenant_telegram_bots;

begin;

-- ---------------------------------------------------------------------
-- 1. tenant_telegram_bots — bot token per tenant.
-- ---------------------------------------------------------------------
create table public.tenant_telegram_bots (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  bot_username text not null,
  encrypted_bot_token text not null,
  is_active boolean not null default true,
  last_error text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

comment on table public.tenant_telegram_bots is
  'Per-tenant Telegram bot config. Tenant admin registers a bot via @BotFather then pastes the token in /settings/secrets. Token stored encrypted (AES-256-GCM app-side).';

create index tenant_telegram_bots_active_idx
  on public.tenant_telegram_bots (is_active) where is_active = true;

alter table public.tenant_telegram_bots enable row level security;

-- Deny direct client access; only server actions using service_role
-- may read / write. RLS mirrors the pattern used for
-- `google_calendar_credentials`.
create policy tenant_telegram_bots_no_direct
  on public.tenant_telegram_bots
  as permissive
  for all
  to authenticated
  using (false)
  with check (false);

create policy tenant_telegram_bots_service
  on public.tenant_telegram_bots
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------
-- 2. user_telegram_links — chat_id per user.
-- ---------------------------------------------------------------------
create table public.user_telegram_links (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Encrypted numeric chat_id (Telegram may issue large signed ints).
  encrypted_chat_id text not null,
  -- Public metadata safe to surface in UI (e.g. `Linked as Bontea`).
  display_name text null,
  telegram_username text null,
  linked_at timestamp with time zone not null default now(),
  last_used_at timestamp with time zone null,
  last_error text null,
  primary key (tenant_id, user_id)
);

comment on table public.user_telegram_links is
  'Per-user Telegram linkage. Chat ID is encrypted; display_name and telegram_username are cleartext for UI convenience only.';

create index user_telegram_links_user_idx
  on public.user_telegram_links (tenant_id, user_id);

alter table public.user_telegram_links enable row level security;

create policy user_telegram_links_no_direct
  on public.user_telegram_links
  as permissive
  for all
  to authenticated
  using (false)
  with check (false);

create policy user_telegram_links_service
  on public.user_telegram_links
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

commit;
