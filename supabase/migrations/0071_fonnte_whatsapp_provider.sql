-- Migration 0071: Add FONNTE as a WhatsApp provider option.
--
-- Fonnte (https://md.fonnte.com) is an Indonesian WhatsApp gateway
-- that authenticates via a "device token" tied to a WhatsApp Web
-- session on the tenant's phone. It is the fastest way to get
-- WhatsApp messaging live for early-stage / SMB tenants who cannot
-- justify Meta Business verification (weeks) or Twilio paid tier.
--
-- Tradeoffs vs the official providers (documented in the admin form
-- runbook so tenants know what they are opting into):
--   * Unofficial — technically violates WhatsApp ToS, tenant's WA
--     number can be banned if flagged.
--   * Session-tied — the paired phone must stay online / logged into
--     WhatsApp Web for the gateway to relay messages.
--   * No template messages, no interactive buttons — text (+ basic
--     media, not enabled in Phase A) only.
--
-- Only the CHECK constraint changes. Column shape is unchanged; the
-- adapter code stores the device token in `encrypted_api_token` and
-- leaves `encrypted_account_sid` + `webhook_verify_token` NULL for
-- FONNTE rows.
--
-- Rollback:
--   begin;
--   alter table public.tenant_whatsapp_configs
--     drop constraint if exists tenant_whatsapp_configs_provider_ck;
--   alter table public.tenant_whatsapp_configs
--     add  constraint tenant_whatsapp_configs_provider_ck
--     check (provider in ('TWILIO', 'META_CLOUD'));
--   commit;
--
-- Note: run the rollback ONLY if there are no rows with
-- provider='FONNTE'; otherwise the ADD CONSTRAINT will fail. Delete
-- FONNTE rows first.

begin;

alter table public.tenant_whatsapp_configs
  drop constraint if exists tenant_whatsapp_configs_provider_ck;

alter table public.tenant_whatsapp_configs
  add constraint tenant_whatsapp_configs_provider_ck
  check (provider in ('TWILIO', 'META_CLOUD', 'FONNTE'));

commit;
