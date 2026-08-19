-- 0096_fix_provision_tenant_ambiguous_column.sql
--
-- Fixes: `provision_tenant RPC failed: column reference "tenant_id" is ambiguous`
--
-- Root cause — migration 0088 rewrote `provision_tenant()` with
-- `RETURNS TABLE (tenant_id uuid, employee_id uuid)` OUT parameters
-- that share names with columns on referenced tables (notably
-- `public.evaluation_templates.tenant_id`). Inside the function body
-- Postgres treats each OUT column as a plpgsql variable, so any bare
-- reference to `tenant_id` in a query targeting a table that ALSO
-- has a `tenant_id` column raises `42702: column reference "tenant_id"
-- is ambiguous`.
--
-- The specific offending statement is Step 3b — backfilling
-- `created_by` on the templates that Step 2c seeded:
--
--     update public.evaluation_templates
--       set created_by = v_employee_id
--     where tenant_id = v_tenant_id      -- <— ambiguous
--       and created_by is null;
--
-- This only surfaces from the super-admin UI form which calls the
-- RPC directly. `pnpm tenant:create` shells out via the same RPC but
-- happened to work in dev because plpgsql's variable-conflict
-- resolution can be looser at parse time depending on session
-- settings; a fresh prod session with default `variable_conflict =
-- 'error'` explodes as expected.
--
-- Fix — qualify column references with the table name so the parser
-- has no choice between the OUT variable and the column. Same shape
-- as migration 0088 otherwise; the only functional change is the
-- Step 3b UPDATE.
--
-- Rollback:
--   restore migration 0088's `provision_tenant()` body verbatim
--   (the version with unqualified `where tenant_id = v_tenant_id`).

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

  -- Step 2a: default Chart of Accounts.
  perform public.seed_default_coa(v_tenant_id);

  -- Step 2b: default lookup master data (departments / positions /
  -- budget_category).
  perform public.seed_default_master_data(v_tenant_id);

  -- Step 2c: default performance-evaluation templates. Helper does
  -- its own admin-employee lookup with NULL fallback, so calling it
  -- here before Step 3 is safe.
  perform public.seed_default_eval_templates(v_tenant_id);

  -- Step 3: initial TENANT_ADMIN employees row.
  insert into public.employees (
    tenant_id, user_id, role, reports_to_employee_id,
    full_name, email, is_active
  ) values (
    v_tenant_id, p_admin_user_id, 'TENANT_ADMIN', null,
    p_admin_name, p_admin_email, true
  )
  returning id into v_employee_id;

  -- Step 3b: backfill created_by on the templates we just seeded so
  -- the /hr/performance/templates author column shows the admin who
  -- provisioned this tenant instead of NULL. Cheap update — 2 rows.
  --
  -- Column reference MUST be qualified — `tenant_id` alone would
  -- collide with the OUT parameter of the same name (see migration
  -- header for the full 42702 story).
  update public.evaluation_templates
    set created_by = v_employee_id
  where public.evaluation_templates.tenant_id = v_tenant_id
    and public.evaluation_templates.created_by is null;

  -- Step 4: immutable audit trail.
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
      'eval_templates_seeded', true,
      'runbook', 'docs/ops/tenant-provisioning.md'
    )
  );

  -- Return the newly-minted identifiers.
  tenant_id   := v_tenant_id;
  employee_id := v_employee_id;
  return next;
end;
$$;

comment on function public.provision_tenant(text, text, uuid, text, text, text) is
  'Atomically create a tenant + seed master data + insert first '
  'TENANT_ADMIN employee. Fixed in migration 0096 to qualify column '
  'references that collided with RETURNS TABLE OUT parameter names.';
