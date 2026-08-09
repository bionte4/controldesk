-- Migration 0073: Per-tenant SMTP configuration.
--
-- Enables each tenant to send outbound email (digest, settlement
-- reminders, invites) from their own SMTP relay with their own
-- "From" identity. Currently `src/lib/notify/mailer.ts` reads a
-- single set of SMTP env vars (`SMTP_HOST`, `SMTP_PORT`, etc.) that
-- all tenants share — a Postmark relay + `no-reply@controldesk.app`
-- sender for the whole deployment. That breaks the promise every
-- tenant expects: mail from their own domain, aligned with their
-- SPF/DKIM/DMARC posture.
--
-- This migration adds `tenant_smtp_configs` (one row per tenant) with
-- the transport tuple (host/port/username/password) and the sender
-- identity (from_address / from_name / reply_to). When a row is
-- present and `is_active = true`, `sendEmail(tenantId, ...)` uses it;
-- otherwise the mailer falls back to the env-global config so the
-- refactor is backward-compatible.
--
-- Security posture:
--   * Credentials AES-256-GCM encrypted app-side via
--     `src/lib/security/token-crypto.ts` (rules §3). Nothing here
--     touches the DB as cleartext.
--   * RLS `no_direct` (deny-all to `authenticated`) + `service`
--     (allow to `service_role`) — mirrors the pattern used by
--     `tenant_whatsapp_configs` (migration 0070) and
--     `tenant_telegram_bots` (migration 0069). Reads/writes only
--     via `createServiceRoleClient()` from Server Actions / cron.
--   * `provider` column stays permissive (CHECK includes 'SMTP'
--     plus placeholders for future API adapters). Phase A only
--     writes 'SMTP' — the send path in `mailer.ts` still uses
--     nodemailer regardless of the value. Future migrations can
--     wire Resend / Postmark / SES API adapters without another
--     schema change.
--
-- Rollback:
--   drop policy if exists tenant_smtp_configs_service on public.tenant_smtp_configs;
--   drop policy if exists tenant_smtp_configs_no_direct on public.tenant_smtp_configs;
--   drop table if exists public.tenant_smtp_configs;

begin;

create table public.tenant_smtp_configs (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,

  -- Provider selector. Phase A: 'SMTP' only (nodemailer to any RFC
  -- 5321 relay). Placeholders left in the CHECK so future migrations
  -- can add API-based adapters without a schema swap. The mailer
  -- ignores anything other than 'SMTP' today and falls back to env.
  provider text not null default 'SMTP',

  -- Transport tuple (SMTP). Cleartext because host + port are not
  -- secrets; port defaults to 587 (submission with STARTTLS) which
  -- is the modern norm. Callers may override secure/tls policy via
  -- the `secure` column (nullable → auto-detect: port 465 → true,
  -- everything else → false with STARTTLS-if-offered).
  host text not null,
  port integer not null default 587,
  secure boolean null,

  -- Optional auth. Nullable to support anonymous relays (dev mailpit,
  -- internal MTAs that trust the network path). Both encrypted to
  -- avoid credential disclosure via the audit-log payload; the
  -- crypto helper handles unencrypted → encrypted transparently on
  -- the first save.
  encrypted_username text null,
  encrypted_password text null,

  -- Sender identity. `from_address` is the RFC 5322 mailbox
  -- (`no-reply@acme.com`). `from_name` is the optional display name
  -- (`Acme HR`). Rendered as `From: "Acme HR" <no-reply@acme.com>`.
  from_address text not null,
  from_name text null,
  reply_to text null,

  -- Optional webhook secret used to verify bounce / complaint
  -- callbacks from transactional providers (Resend, Postmark, SES).
  -- Unused in Phase A; nullable for forward-compat.
  webhook_secret text null,

  is_active boolean not null default true,
  last_error text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint tenant_smtp_configs_provider_ck
    check (provider in ('SMTP', 'RESEND', 'POSTMARK', 'SES', 'SENDGRID')),

  constraint tenant_smtp_configs_port_ck
    check (port > 0 and port <= 65535),

  -- Basic sanity — must look like an email address. Full RFC 5322
  -- lives at the application layer (Zod); this is a cheap DB guard.
  constraint tenant_smtp_configs_from_address_ck
    check (from_address ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

comment on table public.tenant_smtp_configs is
  'Per-tenant SMTP transport + sender identity. Credentials AES-256-GCM encrypted app-side (see token-crypto.ts). Fallback to env-global SMTP_* when no row is present.';

create index tenant_smtp_configs_active_idx
  on public.tenant_smtp_configs (is_active) where is_active = true;

alter table public.tenant_smtp_configs enable row level security;

create policy tenant_smtp_configs_no_direct
  on public.tenant_smtp_configs
  as permissive
  for all
  to authenticated
  using (false)
  with check (false);

create policy tenant_smtp_configs_service
  on public.tenant_smtp_configs
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

commit;
