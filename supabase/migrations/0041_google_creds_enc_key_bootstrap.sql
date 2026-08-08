-- ControlDesk — 0041_google_creds_enc_key_bootstrap.sql
--
-- Fixes the runtime path for the Google credentials RPCs from 0039/0040.
--
-- The `set_google_credential_refresh_token` and
-- `get_google_credential_refresh_token` functions call
-- `current_setting('app.enc_key')`. In stateless Supabase / PostgREST
-- traffic each RPC call runs on a fresh pooled connection, so a session-
-- level `SET app.enc_key = ...` cannot be relied on.
--
-- Fix: declare `app.enc_key` as a *customized* GUC on the `authenticator`
-- and `service_role` roles so it is inherited by every pooled connection
-- without requiring the client to set it per-request. The runtime value
-- is populated by ops (see below) — this migration only ensures the
-- setting is *recognised* by the role and can be read by SECURITY DEFINER
-- functions.
--
-- For local dev the encryption key is provisioned by:
--   ALTER DATABASE postgres SET app.enc_key TO '<APP_ENCRYPTION_KEY>';
-- Ops runbook lives at docs/ops/secret-rotation.md (rules §22 90-day
-- rotation).
--
-- Rollback:
--   alter role authenticator reset app.enc_key;
--   alter role service_role   reset app.enc_key;

-- NOTE: migration 0042 supersedes this bootstrap by pivoting to Node-side
-- AES-256-GCM (src/lib/security/token-crypto.ts). Under managed Postgres
-- (Supabase pooled / CI), the ALTER ROLE ... SET statement below fails
-- with `permission denied to set parameter "app.enc_key" (SQLSTATE 42501)`
-- because the migration runner is not a superuser. The GUC is no longer
-- required at runtime — the Node service-role client encrypts/decrypts
-- directly — so we swallow the permission error and continue.
do $$
begin
  begin
    if exists (select 1 from pg_roles where rolname = 'authenticator') then
      execute 'alter role authenticator set app.enc_key = ' || quote_literal('bootstrap-placeholder-please-rotate');
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute 'alter role service_role set app.enc_key = ' || quote_literal('bootstrap-placeholder-please-rotate');
    end if;
  exception
    when insufficient_privilege then
      raise notice 'skipping app.enc_key role default (insufficient privilege); node-side crypto in 0042 handles this at runtime';
  end;
end $$;

comment on function public.set_google_credential_refresh_token(uuid, text, text, text) is
  'Upsert a tenant Google refresh token. Encrypts inline via app.enc_key so plaintext never lands in Postgres logs. Callable only by service_role. Requires the deployment to override app.enc_key via `ALTER DATABASE <db> SET app.enc_key TO ...` at bootstrap.';
