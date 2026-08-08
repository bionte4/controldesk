-- Migration 0070: WhatsApp integration (Preferences page Phase A).
--
-- Extends the multi-channel notification stack with WhatsApp support.
-- Follows the same "service-role only" RLS pattern as
-- `google_calendar_credentials` (migration 0039) and
-- `tenant_telegram_bots` (migration 0069): the browser never touches
-- the encrypted rows — server actions read/write via
-- `createServiceRoleClient()` and application-side AES-256-GCM
-- (`src/lib/security/token-crypto.ts`, rules §3).
--
-- Provider choice is a per-tenant column, not hard-coded, because:
--   * Dev/sandbox: Twilio WhatsApp Sandbox (instant, free, dev-only).
--   * Prod option A: Twilio Production (paid, faster onboarding).
--   * Prod option B: Meta WhatsApp Cloud API (cheaper, ~2-week
--                    business verification).
-- Rules §22 forbids storing per-provider secrets in env vars —
-- everything is per-tenant so multi-tenant deployments are isolated.
--
-- Rollback:
--   drop policy if exists user_whatsapp_links_service on public.user_whatsapp_links;
--   drop policy if exists user_whatsapp_links_no_direct on public.user_whatsapp_links;
--   drop policy if exists tenant_whatsapp_configs_service on public.tenant_whatsapp_configs;
--   drop policy if exists tenant_whatsapp_configs_no_direct on public.tenant_whatsapp_configs;
--   drop table if exists public.user_whatsapp_links;
--   drop table if exists public.tenant_whatsapp_configs;
--   -- Note: cannot easily drop a value from an enum; downgrade path
--   -- would require rewriting to a new enum. Rows tagged WHATSAPP in
--   -- `user_notification_preferences` are dropped when the table
--   -- itself is dropped via CASCADE, so leaving the enum member is
--   -- safe.

begin;

-- ---------------------------------------------------------------------
-- 1. Extend the notification_channel enum with WHATSAPP.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.notification_channel'::regtype
      and enumlabel = 'WHATSAPP'
  ) then
    alter type public.notification_channel add value 'WHATSAPP';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 2. tenant_whatsapp_configs — provider + credentials per tenant.
-- ---------------------------------------------------------------------
create table public.tenant_whatsapp_configs (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  provider text not null,
  -- Business phone identifier. Meaning is provider-specific:
  --   TWILIO      — `whatsapp:+14155238886` (Sandbox) or
  --                 `whatsapp:+62xxxxxxxxxx` (Production Sender)
  --   META_CLOUD  — phone_number_id (numeric string)
  phone_number_id text not null,
  -- Encrypted API token (Twilio auth token, or Meta system-user token).
  encrypted_api_token text not null,
  -- Twilio needs Account SID; Meta needs Business ID. Keep both nullable
  -- to avoid tenant-migration churn later.
  encrypted_account_sid text null,
  -- Verify token used to bootstrap the webhook (only relevant for
  -- Meta Cloud API subscribe handshake; Twilio ignores it).
  webhook_verify_token text null,
  is_active boolean not null default true,
  last_error text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint tenant_whatsapp_configs_provider_ck
    check (provider in ('TWILIO', 'META_CLOUD'))
);

comment on table public.tenant_whatsapp_configs is
  'Per-tenant WhatsApp Business config (provider + credentials). Token stored encrypted (AES-256-GCM app-side, see token-crypto.ts).';

create index tenant_whatsapp_configs_active_idx
  on public.tenant_whatsapp_configs (is_active) where is_active = true;

alter table public.tenant_whatsapp_configs enable row level security;

-- Deny direct client access; server actions must use service_role.
create policy tenant_whatsapp_configs_no_direct
  on public.tenant_whatsapp_configs
  as permissive
  for all
  to authenticated
  using (false)
  with check (false);

create policy tenant_whatsapp_configs_service
  on public.tenant_whatsapp_configs
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------
-- 3. user_whatsapp_links — per-user WA phone linkage (encrypted).
-- ---------------------------------------------------------------------
create table public.user_whatsapp_links (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Encrypted E.164 phone number (`+62812xxxxxxx`). Provider-neutral —
  -- both Twilio and Meta accept E.164 as the recipient address.
  encrypted_wa_id text not null,
  -- Cleartext display name (safe to surface in UI, "Linked as <name>").
  display_name text null,
  -- Cleartext WhatsApp profile name if the provider exposes it via the
  -- inbound webhook (Meta does, Twilio does with `ProfileName`).
  profile_name text null,
  -- 24-hour messaging window bookkeeping (WhatsApp policy §MSG-WINDOW).
  --   * `last_inbound_at` — the last time the user replied to our bot,
  --     which restarts the 24-hour window for free-form messaging.
  --   Notifications sent outside the window must use a pre-approved
  --   template. Phase A of ControlDesk always uses templates so the
  --   window is informational only — Phase B will consume it.
  last_inbound_at timestamp with time zone null,
  -- Opt-in bookkeeping (WhatsApp compliance §OPT-IN).
  opted_in_at timestamp with time zone not null default now(),
  linked_at timestamp with time zone not null default now(),
  last_used_at timestamp with time zone null,
  last_error text null,
  primary key (tenant_id, user_id)
);

comment on table public.user_whatsapp_links is
  'Per-user WhatsApp link. Phone number encrypted; display_name / profile_name cleartext for UI convenience. `opted_in_at` retained for compliance audit trails.';

create index user_whatsapp_links_user_idx
  on public.user_whatsapp_links (tenant_id, user_id);

alter table public.user_whatsapp_links enable row level security;

create policy user_whatsapp_links_no_direct
  on public.user_whatsapp_links
  as permissive
  for all
  to authenticated
  using (false)
  with check (false);

create policy user_whatsapp_links_service
  on public.user_whatsapp_links
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

commit;
