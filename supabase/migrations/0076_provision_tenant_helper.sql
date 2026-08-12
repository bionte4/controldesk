-- ControlDesk — 0076_provision_tenant_helper.sql
-- Atomic tenant provisioning helper for the `pnpm tenant:create` CLI
-- (docs/ops/tenant-provisioning.md). Wraps the 4 DB operations that
-- must succeed together:
--
--   1. Insert public.tenants
--   2. Seed default Chart of Accounts (via seed_default_coa)
--   3. Insert public.employees for the initial TENANT_ADMIN
--   4. Insert public.security_audit_logs row (immutable trail)
--
-- The auth.users row is created by the CLI *before* invoking this
-- function (via Supabase Admin API); this function only needs the
-- resulting user_id. Keeping auth user creation outside the tx is
-- unavoidable because GoTrue manages auth.users independently, but
-- the CLI rolls back the auth user on RPC failure so the end result
-- is still all-or-nothing.
--
-- SECURITY:
--   security definer + limited grant → only supabase service_role
--   may execute. authenticated / anon are revoked. Regular users can
--   never call this: RLS on public.tenants would block anyway, but
--   the explicit revoke makes intent obvious.
--
-- Rollback:
--   drop function public.provision_tenant(text, text, uuid, text, text, text);

create or replace function public.provision_tenant(
  p_slug          text,
  p_name          text,
  p_admin_user_id uuid,
  p_admin_email   text,
  p_admin_name    text,
  p_source        text default 'ops-cli'
)
returns table (
  tenant_id   uuid,
  employee_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id   uuid;
  v_employee_id uuid;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'SLUG_INVALID: slug must match ^[a-z0-9][a-z0-9-]{1,62}$'
      using errcode = 'check_violation';
  end if;

  if p_admin_user_id is null then
    raise exception 'ADMIN_USER_ID_REQUIRED: auth user must exist before provisioning'
      using errcode = 'not_null_violation';
  end if;

  if p_admin_email is null or length(trim(p_admin_email)) = 0 then
    raise exception 'ADMIN_EMAIL_REQUIRED';
  end if;

  if p_admin_name is null or length(trim(p_admin_name)) = 0 then
    raise exception 'ADMIN_NAME_REQUIRED';
  end if;

  -- Step 1: tenants row.
  insert into public.tenants (slug, name)
  values (lower(p_slug), p_name)
  returning id into v_tenant_id;

  -- Step 2: default CoA (~45 accounts). This helper is itself idempotent
  -- and security-definer, so it succeeds even with the current
  -- authenticated context restricted by RLS.
  perform public.seed_default_coa(v_tenant_id);

  -- Step 3: initial TENANT_ADMIN employees row. reports_to_employee_id
  -- is null (top of chain). The custom_access_token_hook (migration
  -- 0020) will start injecting tenant_id/user_role/employee_id claims
  -- on the next login for this user.
  insert into public.employees (
    tenant_id, user_id, role, reports_to_employee_id,
    full_name, email, is_active
  ) values (
    v_tenant_id, p_admin_user_id, 'TENANT_ADMIN', null,
    p_admin_name, p_admin_email, true
  )
  returning id into v_employee_id;

  -- Step 4: immutable audit trail entry. action_type='CREATE' on
  -- resource_name='tenants' — searchable via
  --   select * from security_audit_logs
  --   where resource_name='tenants' and action_type='CREATE'
  --   order by created_at desc;
  insert into public.security_audit_logs (
    tenant_id, actor_user_id, actor_employee_id, actor_role,
    action_type, resource_name, resource_id, new_values, metadata
  ) values (
    v_tenant_id,
    p_admin_user_id,
    v_employee_id,
    'TENANT_ADMIN',
    'CREATE',
    'tenants',
    v_tenant_id::text,
    jsonb_build_object(
      'slug', lower(p_slug),
      'name', p_name,
      'admin_email', p_admin_email,
      'admin_name', p_admin_name
    ),
    jsonb_build_object(
      'provisioned_by', p_source,
      'coa_seeded', true,
      'runbook', 'docs/ops/tenant-provisioning.md'
    )
  );

  tenant_id := v_tenant_id;
  employee_id := v_employee_id;
  return next;
end;
$$;

comment on function public.provision_tenant(text, text, uuid, text, text, text) is
  'Atomic tenant provisioning (rules §3). Called by pnpm tenant:create CLI (docs/ops/tenant-provisioning.md). Creates tenants row + seeds CoA + inserts TENANT_ADMIN employee + writes audit trail — all in one transaction.';

revoke all on function public.provision_tenant(text, text, uuid, text, text, text)
  from authenticated, anon, public;

grant execute on function public.provision_tenant(text, text, uuid, text, text, text)
  to service_role;
