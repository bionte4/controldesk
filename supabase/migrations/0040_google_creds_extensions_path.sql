-- ControlDesk — 0040_google_creds_extensions_path.sql
--
-- Follow-up to 0039: the SECURITY DEFINER RPCs
-- `set_google_credential_refresh_token` / `get_google_credential_refresh_token`
-- were declared with `set search_path = public`, but Supabase installs
-- `pgcrypto` (which provides `pgp_sym_encrypt` / `pgp_sym_decrypt`) into
-- the `extensions` schema. Result: the RPCs failed at runtime with
-- `function pgp_sym_encrypt(text, text) does not exist`.
--
-- Fix: extend the fixed search_path to include `extensions`, matching the
-- pattern already used elsewhere in the codebase for pgcrypto callers.
--
-- Rollback: reapply the definition from 0039.

create or replace function public.set_google_credential_refresh_token(
  p_tenant_id     uuid,
  p_refresh_token text,
  p_calendar_id   text default 'primary',
  p_client_email  text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.google_calendar_credentials (
    tenant_id, calendar_id, client_email, encrypted_refresh_token, is_active
  ) values (
    p_tenant_id,
    coalesce(p_calendar_id, 'primary'),
    p_client_email,
    extensions.pgp_sym_encrypt(p_refresh_token, current_setting('app.enc_key')),
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
set search_path = public, extensions
as $$
begin
  return query
    select
      extensions.pgp_sym_decrypt(gcc.encrypted_refresh_token::bytea, current_setting('app.enc_key')),
      gcc.calendar_id,
      gcc.client_email
    from public.google_calendar_credentials gcc
    where gcc.tenant_id = p_tenant_id
      and gcc.is_active = true;
end;
$$;
