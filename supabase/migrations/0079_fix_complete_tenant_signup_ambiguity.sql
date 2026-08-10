-- ControlDesk — 0079_fix_complete_tenant_signup_ambiguity.sql
--
-- Follow-up fix for migration 0078. The `complete_tenant_signup` RPC
-- has `RETURNS TABLE(..., slug text, ...)` which — under plpgsql
-- semantics — creates OUT variables that shadow same-named columns
-- inside the function body. This makes the `where slug = v_req.slug`
-- check ambiguous:
--
--   ERROR: column reference "slug" is ambiguous
--   HINT: It could refer to either a PL/pgSQL variable or a table column.
--
-- The bug surfaced during E2E testing (e2e/tenant-self-signup.spec.ts
-- happy path — verify step returned PROVISIONING_FAILED with the
-- above error).
--
-- Fix: qualify every reference to `tenants.slug` inside the function
-- body with the table alias. Also add the same defensive aliasing to
-- other columns the function touches so future edits don't reintroduce
-- the same class of bug.
--
-- Rollback:
--   Re-apply migration 0078's definition of complete_tenant_signup.

create or replace function public.complete_tenant_signup(
  p_raw_token       text,
  p_admin_user_id   uuid
)
returns table (
  tenant_id   uuid,
  employee_id uuid,
  admin_email text,
  admin_name  text,
  slug        text,
  name        text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_hash text;
  v_provisioned record;
  v_trial_end timestamptz := now() + interval '14 days';
begin
  v_hash := encode(sha256(p_raw_token::bytea), 'hex');

  select r.*
  into v_req
  from public.tenant_signup_requests r
  where r.token_hash = v_hash
    and r.verified_at is null
    and r.expires_at > now()
  for update
  limit 1;

  if v_req is null then
    raise exception 'invalid_or_expired_token'
      using errcode = '22023',
            hint = 'Signup token tidak ditemukan, sudah dipakai, atau kadaluarsa.';
  end if;

  -- Race check: another self-signup may have grabbed this slug in the
  -- interim (email verification took a while). Reject cleanly rather
  -- than let provision_tenant fail with a cryptic FK error.
  --
  -- NOTE: Alias `t` REQUIRED — otherwise unqualified `slug` refers to
  -- the OUT variable of RETURNS TABLE, not the column. Same reason
  -- v_req.slug is bound to the record field explicitly.
  if exists (
    select 1 from public.tenants t where t.slug = v_req.slug
  ) then
    raise exception 'slug_taken'
      using errcode = '23505',
            hint = format(
              'Slug %s sudah dipakai — silakan ulangi pendaftaran dengan slug lain.',
              v_req.slug
            );
  end if;

  -- Reuse Fase 1's provision_tenant() so we get identical semantics:
  -- CoA seed, employee row, audit log entry.
  select p.tenant_id, p.employee_id
  into v_provisioned
  from public.provision_tenant(
    v_req.slug,
    v_req.name,
    p_admin_user_id,
    v_req.admin_email::text,
    v_req.admin_name,
    'self-signup'
  ) p;

  -- Stamp plan + trial expiry + provisioned_via on the freshly-created row.
  update public.tenants t
    set plan            = 'trial',
        trial_ends_at   = v_trial_end,
        provisioned_via = 'self-signup'
    where t.id = v_provisioned.tenant_id;

  -- Consume the request so the token can't be replayed.
  update public.tenant_signup_requests r
    set verified_at        = now(),
        verified_tenant_id = v_provisioned.tenant_id
    where r.id = v_req.id;

  return query select
    v_provisioned.tenant_id,
    v_provisioned.employee_id,
    v_req.admin_email::text,
    v_req.admin_name,
    v_req.slug,
    v_req.name;
end;
$$;

comment on function public.complete_tenant_signup(text, uuid) is
  'Two-phase self-signup commit. Verifies the raw token against '
  'tenant_signup_requests.token_hash, then delegates to provision_tenant() '
  'and stamps plan=trial + trial_ends_at=now()+14 days. Consumes the '
  'signup request so tokens are single-use. '
  '(Migration 0079: aliased every table reference to avoid RETURNS TABLE '
  'column-shadowing ambiguity.)';

revoke all on function public.complete_tenant_signup(text, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_tenant_signup(text, uuid)
  to service_role;
