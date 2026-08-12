-- ControlDesk — 0020_jwt_role_claim_fix.sql
--
-- Fix: the custom access-token hook (see 0003_rls_helpers.sql) was writing
-- the employee role (e.g. `TENANT_ADMIN`) into the JWT's top-level `role`
-- claim. PostgREST reads that claim and issues `SET LOCAL ROLE <role>` on
-- every request — which fails with `role "TENANT_ADMIN" does not exist`
-- because ControlDesk employee roles are **application** roles, not
-- Postgres roles.
--
-- Resolution:
--   1. Stop writing to the `role` claim so PostgREST keeps using the
--      built-in `authenticated` role.
--   2. Publish the employee role under a dedicated `user_role` claim.
--   3. Update `current_employee_role()` to read `user_role` (with a
--      fallback to legacy `role` for pre-existing sessions).
--
-- Application code that reads the JWT (proxy.ts, session.ts) already
-- accepts either claim name via `AppJwtClaims.user_role ?? role`.
--
-- Rollback:
--   Re-apply 0003_rls_helpers.sql to restore the previous hook body.

-- ---------------------------------------------------------------------------
-- 1. Replace the access-token hook: inject `user_role` instead of `role`.
-- ---------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  app_metadata jsonb := coalesce(claims -> 'app_metadata', '{}'::jsonb);
  emp record;
  caller_uid uuid;
begin
  caller_uid := (event ->> 'user_id')::uuid;

  select
    e.tenant_id,
    e.role::text as role,
    t.slug as tenant_slug,
    e.id as employee_id
  into emp
  from public.employees e
    join public.tenants t on t.id = e.tenant_id
  where e.user_id = caller_uid
    and e.is_active = true
  order by e.created_at asc
  limit 1;

  if emp.tenant_id is not null then
    app_metadata := app_metadata
      || jsonb_build_object(
           'tenant_id',   emp.tenant_id,
           'tenant_slug', emp.tenant_slug,
           'user_role',   emp.role,
           'employee_id', emp.employee_id
         );

    claims := claims
      || jsonb_build_object(
           'tenant_id',   emp.tenant_id,
           'tenant_slug', emp.tenant_slug,
           'user_role',   emp.role,
           'employee_id', emp.employee_id,
           'app_metadata', app_metadata
         );
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Supabase Auth hook. Injects tenant_id, tenant_slug, user_role, and employee_id claims into every JWT issued for an active employee. The Postgres `role` claim is left untouched so PostgREST keeps using `authenticated`.';

revoke all on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 2. Update current_employee_role() to read `user_role` (with legacy fallback).
-- ---------------------------------------------------------------------------
create or replace function public.current_employee_role()
returns public.employee_role
language sql
stable
security definer
set search_path = public
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'user_role',
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
    ),
    ''
  )::public.employee_role;
$$;

revoke all on function public.current_employee_role() from public;
grant execute on function public.current_employee_role() to authenticated, service_role;
