-- ControlDesk — 0077_platform_admin_tenant_lifecycle.sql
--
-- Fase 2 + 3 of the tenant lifecycle roadmap
-- (docs/ops/tenant-provisioning.md). Introduces three cross-cutting
-- schema additions:
--
--   1. platform_admins — cross-tenant super-admin identities. Not in
--      the employees table because platform admins are not scoped to
--      any single tenant; they manage the tenant catalog itself.
--   2. tenants.status — soft-suspension enum ('active', 'suspended',
--      'terminated') so operators can freeze a tenant without
--      hard-deleting data (preserves audit trail immutability, rules §3).
--   3. tenant_feature_flags — per-tenant feature gating so new features
--      can be canaried to a subset of tenants without redeploy.
--
-- Plus:
--   4. platform_admin_audit_logs — separate audit trail for
--      cross-tenant super-admin actions (tenant CRUD, feature toggles,
--      suspensions). Kept OUT of security_audit_logs because that
--      table's tenant_id is NOT NULL and cross-tenant events
--      conceptually don't belong to a single tenant.
--   5. Update custom_access_token_hook to inject is_platform_admin
--      claim on JWTs issued to platform admins.
--
-- Rollback:
--   drop function public.custom_access_token_hook(jsonb);   -- restore from 0020
--   drop table public.platform_admin_audit_logs;
--   drop table public.tenant_feature_flags;
--   alter table public.tenants drop column status;
--   drop type public.tenant_status;
--   drop table public.platform_admins;

-- ---------------------------------------------------------------------------
-- 1. tenant_status enum + column on tenants
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tenant_status') then
    create type public.tenant_status as enum ('active', 'suspended', 'terminated');
  end if;
end $$;

alter table public.tenants
  add column if not exists status public.tenant_status not null default 'active';

comment on column public.tenants.status is
  'Lifecycle status. Proxy blocks non-active tenants at request time. '
  'terminated is soft-delete — data retained per rules §22.';

create index if not exists tenants_status_idx on public.tenants(status);

-- ---------------------------------------------------------------------------
-- 2. platform_admins — cross-tenant super-admin users
-- ---------------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       citext not null unique,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

comment on table public.platform_admins is
  'Cross-tenant super-admin identities. Not in public.employees because '
  'platform admins are not scoped to any single tenant — they manage the '
  'tenant catalog itself. Login via apex domain /login → /super-admin/*.';

create index if not exists platform_admins_active_idx
  on public.platform_admins(is_active) where is_active = true;

drop trigger if exists platform_admins_set_updated_at on public.platform_admins;
create trigger platform_admins_set_updated_at
  before update on public.platform_admins
  for each row
  execute function public.set_updated_at();

-- RLS: only service_role reads/writes. authenticated users cannot see
-- this table at all — the JWT hook checks membership out-of-band via
-- security definer function.
alter table public.platform_admins enable row level security;
-- No policies → no access for anon/authenticated. service_role bypasses RLS.

-- Helper: is the CURRENT session a platform admin? Used by RLS on
-- other tables that platform admins need cross-tenant access to.
create or replace function public.is_current_user_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb
      ->> 'is_platform_admin')::boolean,
    false
  );
$$;

comment on function public.is_current_user_platform_admin() is
  'Reads the is_platform_admin JWT claim injected by custom_access_token_hook. '
  'Used inside RLS policies + Server Actions to gate cross-tenant access.';

grant execute on function public.is_current_user_platform_admin()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. tenant_feature_flags — per-tenant feature gating
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_feature_flags (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  feature_key text not null,
  enabled    boolean not null default false,
  notes      text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint tenant_feature_flags_unique unique (tenant_id, feature_key)
);

comment on table public.tenant_feature_flags is
  'Per-tenant feature gating. Feature keys are canonical constants in '
  'src/lib/ops/feature-flags.ts. Rows missing = default (usually false). '
  'Managed by platform admins via /super-admin/tenants/{id}.';

create index if not exists tenant_feature_flags_tenant_idx
  on public.tenant_feature_flags(tenant_id);

drop trigger if exists tenant_feature_flags_set_updated_at on public.tenant_feature_flags;
create trigger tenant_feature_flags_set_updated_at
  before update on public.tenant_feature_flags
  for each row
  execute function public.set_updated_at();

alter table public.tenant_feature_flags enable row level security;

-- Tenants can SEE their own flags (read-only) so tenant admins know
-- what's enabled for them.
drop policy if exists tenant_feature_flags_self_read on public.tenant_feature_flags;
create policy tenant_feature_flags_self_read
  on public.tenant_feature_flags
  for select
  to authenticated
  using (
    tenant_id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb
      ->> 'tenant_id')::uuid
    or public.is_current_user_platform_admin()
  );

-- Only platform admins can INSERT/UPDATE/DELETE. Tenant admins CANNOT
-- toggle their own flags — that's a platform-team decision.
drop policy if exists tenant_feature_flags_platform_write on public.tenant_feature_flags;
create policy tenant_feature_flags_platform_write
  on public.tenant_feature_flags
  for all
  to authenticated
  using (public.is_current_user_platform_admin())
  with check (public.is_current_user_platform_admin());

-- ---------------------------------------------------------------------------
-- 4. platform_admin_audit_logs — separate audit trail for super-admin actions
-- ---------------------------------------------------------------------------
create table if not exists public.platform_admin_audit_logs (
  id             bigint generated always as identity primary key,
  actor_user_id  uuid references auth.users(id) on delete set null,
  actor_email    citext,
  action_type    public.audit_action_type not null,
  resource_name  text not null,      -- e.g. 'tenants', 'tenant_feature_flags'
  resource_id    text,               -- stringified PK (usually tenant_id)
  target_tenant_id uuid references public.tenants(id) on delete set null,
  old_values     jsonb,
  new_values     jsonb,
  metadata       jsonb,
  ip_address     inet,
  user_agent     text,
  created_at     timestamptz not null default now()
);

comment on table public.platform_admin_audit_logs is
  'Immutable audit trail for cross-tenant super-admin actions. Separate '
  'from security_audit_logs because those require tenant_id NOT NULL '
  'and platform admin actions can predate tenant creation (e.g. logging '
  'a failed create attempt).';

create index if not exists platform_admin_audit_logs_time_idx
  on public.platform_admin_audit_logs (created_at desc);

create index if not exists platform_admin_audit_logs_actor_idx
  on public.platform_admin_audit_logs (actor_user_id, created_at desc);

create index if not exists platform_admin_audit_logs_target_idx
  on public.platform_admin_audit_logs (target_tenant_id, created_at desc);

-- Immutability trigger — same pattern as security_audit_logs.
create or replace function public.platform_admin_audit_logs_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'platform_admin_audit_logs is append-only; UPDATE/DELETE forbidden'
    using errcode = '42501';
end;
$$;

drop trigger if exists platform_admin_audit_logs_no_update on public.platform_admin_audit_logs;
create trigger platform_admin_audit_logs_no_update
  before update or delete on public.platform_admin_audit_logs
  for each row
  execute function public.platform_admin_audit_logs_immutable();

-- RLS: read allowed for platform admins only; write via service_role or
-- platform admin. authenticated tenant users have zero visibility.
alter table public.platform_admin_audit_logs enable row level security;

drop policy if exists platform_admin_audit_read on public.platform_admin_audit_logs;
create policy platform_admin_audit_read
  on public.platform_admin_audit_logs
  for select
  to authenticated
  using (public.is_current_user_platform_admin());

drop policy if exists platform_admin_audit_insert on public.platform_admin_audit_logs;
create policy platform_admin_audit_insert
  on public.platform_admin_audit_logs
  for insert
  to authenticated
  with check (
    public.is_current_user_platform_admin()
    and (actor_user_id is null or actor_user_id = auth.uid())
  );

-- Convenience RPC — Node.js writes an audit row via a single stable call.
create or replace function public.record_platform_admin_audit(
  p_action_type   public.audit_action_type,
  p_resource_name text,
  p_resource_id   text default null,
  p_target_tenant uuid default null,
  p_old_values    jsonb default null,
  p_new_values    jsonb default null,
  p_metadata      jsonb default null,
  p_ip_address    inet default null,
  p_user_agent    text default null
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id bigint;
  v_email text;
begin
  if not public.is_current_user_platform_admin() then
    raise exception 'record_platform_admin_audit: caller is not a platform admin'
      using errcode = '42501';
  end if;

  select email into v_email
  from public.platform_admins
  where user_id = auth.uid();

  insert into public.platform_admin_audit_logs (
    actor_user_id, actor_email, action_type, resource_name, resource_id,
    target_tenant_id, old_values, new_values, metadata,
    ip_address, user_agent
  ) values (
    auth.uid(), v_email, p_action_type, p_resource_name, p_resource_id,
    p_target_tenant, p_old_values, p_new_values, p_metadata,
    p_ip_address, p_user_agent
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.record_platform_admin_audit(
  public.audit_action_type, text, text, uuid, jsonb, jsonb, jsonb, inet, text
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Update custom_access_token_hook — inject is_platform_admin claim
-- ---------------------------------------------------------------------------
-- Supersedes migration 0020. Additions: reads platform_admins first;
-- if the user is an active platform admin, injects is_platform_admin=true
-- claim into the JWT (in addition to any tenant/employee claims that
-- may also apply — a user MAY be both, though the CLI won't provision
-- overlapping identities).
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
  is_pa boolean := false;
begin
  caller_uid := (event ->> 'user_id')::uuid;

  -- Check platform admin membership first — cheap indexed lookup.
  select true into is_pa
  from public.platform_admins
  where user_id = caller_uid
    and is_active = true
  limit 1;

  if is_pa then
    app_metadata := app_metadata || jsonb_build_object('is_platform_admin', true);
    claims := claims || jsonb_build_object(
      'is_platform_admin', true,
      'app_metadata', app_metadata
    );
  end if;

  -- Tenant / employee claims (unchanged from 0020).
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
  'Supabase Auth hook. Injects (a) is_platform_admin (bool) for platform '
  'admins and (b) tenant_id/tenant_slug/user_role/employee_id for tenant '
  'users. A single user may hold both claims. Rules §3 + §17.';

revoke all on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 6. resolve_tenant_status_by_slug — proxy uses this to block suspended tenants
-- ---------------------------------------------------------------------------
create or replace function public.resolve_tenant_status_by_slug(p_slug text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select status::text
  from public.tenants
  where slug = lower(p_slug)
  limit 1;
$$;

comment on function public.resolve_tenant_status_by_slug(text) is
  'Anon-callable status lookup used by src/proxy.ts to short-circuit '
  'suspended tenants before serving any app content.';

grant execute on function public.resolve_tenant_status_by_slug(text)
  to anon, authenticated, service_role;
