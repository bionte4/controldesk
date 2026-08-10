-- =============================================================================
-- 0082 — provision_tenant() → also seed lookup master data
--
-- Fixes a gap discovered post-Fase 6: `public.provision_tenant()` (migration
-- 0076) seeded the Chart of Accounts via `seed_default_coa()` but did NOT
-- also call `seed_default_master_data()` (migration 0054). New tenants
-- provisioned via CLI / Super-Admin UI / self-signup would therefore land
-- with 0 rows in the `department`, `position`, and `budget_category`
-- lookup_options domains — breaking dropdowns that depend on those
-- reference values (HR employee form, budget line-item form).
--
-- This migration:
--
--   1. Rewrites `provision_tenant()` to invoke BOTH seed helpers in the
--      same atomic transaction. Signature and audit-log payload
--      unchanged; only step 2 gains a sibling call. Callers
--      (`pnpm tenant:create`, `complete_tenant_signup`, super-admin
--      UI Server Action) get the fix automatically — no client-side
--      changes required.
--
--   2. Backfills every existing tenant to make sure prior tenants that
--      missed the seed (whichever historical cause) end up with the
--      full lookup vocabulary.
--
-- Rollback:
--   - Restore migration 0076's body verbatim (drop the `perform
--     public.seed_default_master_data(...)` line).
--   - The backfilled rows are idempotent — no unique constraint
--     violation on re-run — but hard rollback would need:
--
--     delete from public.lookup_options
--     where domain in ('department', 'position', 'budget_category');
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rewrite provision_tenant() to seed both CoA and master data.
-- ---------------------------------------------------------------------------
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

  -- Step 2a: default Chart of Accounts (~45 accounts). Idempotent,
  -- security-definer, tenant-scoped by `on conflict (tenant_id, code)
  -- do nothing`.
  perform public.seed_default_coa(v_tenant_id);

  -- Step 2b: default lookup master data — departments, positions,
  -- budget categories. Feeds the HR + budget dropdowns that would
  -- otherwise render blank for a brand-new tenant. Also idempotent
  -- via `on conflict do nothing`.
  perform public.seed_default_master_data(v_tenant_id);

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

  -- Step 4: immutable audit trail entry. `metadata.master_data_seeded`
  -- surfaces the new seed so anyone diffing old vs. new
  -- provisioning rows can confirm the fix landed.
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
      'master_data_seeded', true,
      'runbook', 'docs/ops/tenant-provisioning.md'
    )
  );

  tenant_id := v_tenant_id;
  employee_id := v_employee_id;
  return next;
end;
$$;

comment on function public.provision_tenant(text, text, uuid, text, text, text) is
  'Atomic tenant provisioning (rules §3). Called by pnpm tenant:create CLI '
  '(docs/ops/tenant-provisioning.md). Creates tenants row, seeds default '
  'CoA, seeds default lookup master data (departments / positions / '
  'budget_category), inserts TENANT_ADMIN employee, writes audit trail — '
  'all in one transaction. Idempotent seed helpers make re-runs safe.';

revoke all on function public.provision_tenant(text, text, uuid, text, text, text)
  from authenticated, anon, public;

grant execute on function public.provision_tenant(text, text, uuid, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Backfill — call seed_default_master_data() for every existing tenant
--    so tenants provisioned BEFORE this migration land in the same state
--    as tenants provisioned AFTER. Idempotent (`on conflict do nothing`
--    inside the helper).
-- ---------------------------------------------------------------------------
do $$
declare
  t_id uuid;
begin
  for t_id in select id from public.tenants loop
    perform public.seed_default_master_data(t_id);
  end loop;
end $$;
