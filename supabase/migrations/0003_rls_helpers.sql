-- ControlDesk — 0003_rls_helpers.sql
-- SQL helpers referenced by every future module's RLS policies plus the
-- Supabase Auth custom access token hook that injects `tenant_id` /
-- `tenant_slug` / `role` claims into every issued JWT.

-- ---------------------------------------------------------------------------
-- 1. current_tenant_id() — canonical helper for tenant-scoped RLS policies.
-- ---------------------------------------------------------------------------
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id',
    ''
  )::uuid;
$$;

comment on function public.current_tenant_id() is
  'Returns the tenant_id claim from the current auth JWT, or null when anonymous. Use in RLS: `tenant_id = public.current_tenant_id()`.';

revoke all on function public.current_tenant_id() from public;
grant execute on function public.current_tenant_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. current_employee_role() — sibling helper for role-gated policies.
-- ---------------------------------------------------------------------------
create or replace function public.current_employee_role()
returns public.employee_role
language sql
stable
security definer
set search_path = public
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  )::public.employee_role;
$$;

revoke all on function public.current_employee_role() from public;
grant execute on function public.current_employee_role() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. custom_access_token_hook — invoked by GoTrue on every token issuance.
--
-- Reads the caller's employees row and appends tenant_id, tenant_slug, and
-- role to the JWT `app_metadata`. proxy.ts reads these to enforce the
-- cross-tenant guard and RLS policies read them for row-level filtering.
-- Signature contract: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
-- ---------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claims        jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  app_metadata  jsonb := coalesce(claims -> 'app_metadata', '{}'::jsonb);
  caller_uid    uuid;
  emp           record;
begin
  caller_uid := (event ->> 'user_id')::uuid;

  select e.tenant_id, e.role::text as role, t.slug as tenant_slug, e.id as employee_id
    into emp
  from public.employees e
    join public.tenants t on t.id = e.tenant_id
  where e.user_id = caller_uid
    and e.is_active
  order by e.created_at asc
  limit 1;

  if emp.tenant_id is not null then
    app_metadata := app_metadata
      || jsonb_build_object(
           'tenant_id',   emp.tenant_id,
           'tenant_slug', emp.tenant_slug,
           'role',        emp.role,
           'employee_id', emp.employee_id
         );

    claims := claims
      || jsonb_build_object(
           'tenant_id',   emp.tenant_id,
           'tenant_slug', emp.tenant_slug,
           'role',        emp.role,
           'employee_id', emp.employee_id,
           'app_metadata', app_metadata
         );
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Supabase Auth hook. Injects tenant_id, tenant_slug, role, and employee_id claims into every JWT issued for an active employee.';

-- GoTrue (supabase_auth_admin) must be able to execute the hook.
revoke all on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- The hook needs to read from public.employees + public.tenants bypassing RLS.
-- Because the function is SECURITY DEFINER (owned by postgres), it does bypass
-- RLS automatically. We additionally grant explicit table access to make the
-- intent obvious to future maintainers.
grant usage on schema public to supabase_auth_admin;
grant select on public.employees to supabase_auth_admin;
grant select on public.tenants to supabase_auth_admin;
