-- ControlDesk — 0042_google_creds_node_crypto.sql
--
-- Pivots the Google Calendar credentials flow from pgcrypto-inside-Postgres
-- to Node-side AES-256-GCM (see src/lib/security/token-crypto.ts).
--
-- Rationale:
--   * The pgcrypto approach requires the `app.enc_key` session GUC to be
--     set on every pooled connection. Supabase's PostgREST pool cannot
--     set custom GUCs at connection open without superuser hooks, and
--     `ALTER ROLE ... SET app.enc_key = ...` fails with permission-denied
--     under managed Postgres 16 policies.
--   * The runtime already has `APP_ENCRYPTION_KEY` in-process for other
--     workloads (rate-limit Redis, JWT signing, etc). Encrypting Node-
--     side removes a network round-trip AND drops the coordination
--     burden of the session GUC.
--
-- Changes:
--   1. `google_calendar_credentials.encrypted_refresh_token` becomes
--      `text` (Node-produced compact ciphertext `v1.<iv>.<ct>.<tag>`).
--   2. The `set_google_credential_refresh_token` /
--      `get_google_credential_refresh_token` SECURITY DEFINER RPCs are
--      dropped — the Node service-role client writes/reads the table
--      directly (RLS already forbids any other principal).
--
-- No production data yet lives in this table (feature just landed), so
-- an ALTER COLUMN + drop function is safe. If you deploy this to an env
-- that already collected pgcrypto-encoded rows, add a migration step
-- that re-encrypts them Node-side first.
--
-- Rollback:
--   alter table public.google_calendar_credentials
--     alter column encrypted_refresh_token type bytea using encrypted_refresh_token::bytea;
--   (then reapply 0039 + 0040 RPC bodies)

alter table public.google_calendar_credentials
  alter column encrypted_refresh_token type text
  using convert_from(encrypted_refresh_token, 'UTF8');

drop function if exists public.set_google_credential_refresh_token(uuid, text, text, text);
drop function if exists public.get_google_credential_refresh_token(uuid);
