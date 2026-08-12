-- =============================================================================
-- Migration 0053 — Admin user management RPCs (Fase 3).
--
-- Introduces two SECURITY DEFINER RPCs used by the `/settings/users` mutating
-- server actions:
--
--   1. `revoke_user_sessions(uuid)` — invalidate every Supabase session
--      belonging to `target_user_id` by deleting the corresponding rows in
--      `auth.refresh_tokens` and `auth.sessions`. The Supabase JS client
--      does not expose a supported API for this (it only exposes single-
--      session sign-out via JWT), so we ship our own tenant-safe helper.
--
--   2. `set_user_ban(uuid, timestamptz)` — set/clear `auth.users.banned_until`
--      by direct update. `null` clears the ban (reactivate); `'infinity'` or
--      a far-future timestamp deactivates the account.
--
-- Both RPCs enforce three invariants:
--   * caller must be an authenticated employee
--   * caller must be `TENANT_ADMIN` (canonical `ADMIN`)
--   * target user must have an `employees` row in the SAME tenant as the
--     caller — this is the multi-tenant guard, since `auth.users` itself is
--     global.
--
-- These are called EXCLUSIVELY from `withSecureAction` handlers on the
-- server, so we also keep an audit-log write path in the app layer.
--
-- Rollback:
--   drop function if exists public.revoke_user_sessions(uuid);
--   drop function if exists public.set_user_ban(uuid, timestamptz);
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Guard helper — inlined into every RPC below.
--
--    Returns TRUE only when the caller is TENANT_ADMIN (legacy or canonical
--    ADMIN mapping) AND the target user belongs to the caller's tenant.
-- ---------------------------------------------------------------------------
create or replace function public.can_admin_target_user(p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with actor as (
    select
      public.current_tenant_id()     as tenant_id,
      public.current_employee_role() as role
  )
  select exists (
    select 1
    from actor a
    join public.employees e_target
      on e_target.user_id = p_target
     and e_target.tenant_id = a.tenant_id
    where a.role in ('TENANT_ADMIN', 'ADMIN')
  );
$$;

comment on function public.can_admin_target_user(uuid) is
  'True when the current caller is TENANT_ADMIN and target user has an '
  'employees row in the caller''s tenant. Used as gate for admin RPCs '
  'that touch `auth.users` cross-schema.';

revoke all on function public.can_admin_target_user(uuid) from public;
grant execute on function public.can_admin_target_user(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. revoke_user_sessions — kill every refresh_token + session row for a user.
--
--    After this returns, the target user's existing JWTs remain valid until
--    their (short) TTL expires (~1 hour default). The refresh cycle then
--    fails, which forces the client to re-authenticate. Combined with a
--    subsequent ban via `set_user_ban`, this yields near-immediate lockout.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_deleted integer := 0;
begin
  if not public.can_admin_target_user(p_user_id) then
    raise exception 'not authorized to revoke sessions for this user'
      using errcode = '42501';
  end if;

  delete from auth.refresh_tokens where user_id = p_user_id::text;
  get diagnostics v_deleted = row_count;
  delete from auth.sessions where user_id = p_user_id;
  return v_deleted;
end;
$$;

comment on function public.revoke_user_sessions(uuid) is
  'Delete every auth.refresh_tokens + auth.sessions row for the target '
  'user, forcing re-authentication on next refresh cycle. Returns the '
  'number of refresh tokens removed. Guarded by can_admin_target_user().';

revoke all on function public.revoke_user_sessions(uuid) from public;
grant execute on function public.revoke_user_sessions(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. set_user_ban — set or clear auth.users.banned_until.
--
--    Passing NULL clears the ban (reactivate). Passing a future timestamp
--    deactivates the account for that duration. Sessions are NOT
--    automatically revoked — call `revoke_user_sessions` first for
--    immediate effect.
-- ---------------------------------------------------------------------------
create or replace function public.set_user_ban(
  p_user_id uuid,
  p_banned_until timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.can_admin_target_user(p_user_id) then
    raise exception 'not authorized to ban/unban this user'
      using errcode = '42501';
  end if;
  update auth.users
     set banned_until = p_banned_until,
         updated_at   = now()
   where id = p_user_id;
end;
$$;

comment on function public.set_user_ban(uuid, timestamptz) is
  'Set auth.users.banned_until for the target user. Pass NULL to unban. '
  'Guarded by can_admin_target_user() — cross-tenant bans are rejected.';

revoke all on function public.set_user_ban(uuid, timestamptz) from public;
grant execute on function public.set_user_ban(uuid, timestamptz) to authenticated, service_role;
