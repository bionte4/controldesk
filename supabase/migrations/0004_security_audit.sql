-- ControlDesk — 0004_security_audit.sql
-- Immutable enterprise audit trail per rules §3 + §16.
--
-- Every mutating Server Action MUST write one row to `security_audit_logs`
-- via `src/lib/security/audit.ts`. The table is INSERT-only: no UPDATE / no
-- DELETE, enforced by both RLS policies and a rewind trigger.

-- ---------------------------------------------------------------------------
-- 1. Enum of high-level action verbs. Kept intentionally small so the audit
--    log stays greppable; module-specific detail lives in `resource_name` +
--    `metadata`.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'audit_action_type') then
    create type public.audit_action_type as enum (
      'CREATE',
      'UPDATE',
      'DELETE',
      'APPROVE',
      'REJECT',
      'SUBMIT',
      'CANCEL',
      'DISBURSE',
      'SETTLE',
      'LOGIN',
      'LOGOUT',
      'IMPERSONATE',
      'EXPORT',
      'ROLE_CHANGE'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Table.
-- ---------------------------------------------------------------------------
create table if not exists public.security_audit_logs (
  id             bigint generated always as identity primary key,
  tenant_id      uuid not null references public.tenants(id) on delete restrict,
  actor_user_id  uuid references auth.users(id) on delete set null,
  actor_employee_id uuid references public.employees(id) on delete set null,
  actor_role     public.employee_role,
  action_type    public.audit_action_type not null,
  resource_name  text not null,      -- e.g. 'project_expenses', 'cash_advances'
  resource_id    text,               -- stringified PK, nullable for LOGIN/LOGOUT
  old_values     jsonb,              -- redacted snapshot before mutation
  new_values     jsonb,              -- redacted snapshot after mutation
  metadata       jsonb,              -- free-form module-specific detail
  ip_address     inet,
  user_agent     text,
  created_at     timestamptz not null default now()
);

comment on table public.security_audit_logs is
  'Immutable, tenant-isolated audit trail for every sensitive mutation. INSERT-only.';

create index if not exists security_audit_logs_tenant_time_idx
  on public.security_audit_logs (tenant_id, created_at desc);

create index if not exists security_audit_logs_resource_idx
  on public.security_audit_logs (tenant_id, resource_name, resource_id);

create index if not exists security_audit_logs_actor_idx
  on public.security_audit_logs (tenant_id, actor_employee_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Immutability guard — reject UPDATE / DELETE at the trigger level so
--    even super-users writing SQL directly cannot rewrite history.
-- ---------------------------------------------------------------------------
create or replace function public.security_audit_logs_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'security_audit_logs is append-only; UPDATE/DELETE forbidden'
    using errcode = '42501';
end;
$$;

drop trigger if exists security_audit_logs_no_update on public.security_audit_logs;
create trigger security_audit_logs_no_update
  before update or delete on public.security_audit_logs
  for each row execute function public.security_audit_logs_immutable();

-- ---------------------------------------------------------------------------
-- 4. RLS — SELECT scoped to the caller's tenant with role gating.
-- ---------------------------------------------------------------------------
alter table public.security_audit_logs enable row level security;

-- SELECT: any employee of the tenant can read their own audit entries; only
-- privileged roles can see the full tenant-wide log.
drop policy if exists audit_read_own on public.security_audit_logs;
create policy audit_read_own
  on public.security_audit_logs
  for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      actor_user_id = auth.uid()
      or public.current_employee_role() in (
        'TENANT_ADMIN', 'GENERAL_MANAGER', 'HEAD_MANAGER',
        'LEAD_FINANCE', 'HR_ADMIN'
      )
    )
  );

-- INSERT: authenticated employees can only insert rows for their own tenant,
-- and only with their own actor identity. The service role bypasses RLS
-- entirely (used by cron / background hooks).
drop policy if exists audit_insert_own on public.security_audit_logs;
create policy audit_insert_own
  on public.security_audit_logs
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and (actor_user_id is null or actor_user_id = auth.uid())
  );

-- No UPDATE / DELETE policies exist — combined with the trigger above,
-- rows are effectively immutable.

-- ---------------------------------------------------------------------------
-- 5. Convenience RPC — allows the Node.js runtime to write an audit row
--    with a single stable signature. Rules §17.3.
-- ---------------------------------------------------------------------------
create or replace function public.record_audit_log(
  p_action_type   public.audit_action_type,
  p_resource_name text,
  p_resource_id   text default null,
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
  v_tenant_id uuid := public.current_tenant_id();
  v_role public.employee_role := public.current_employee_role();
  v_employee_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'record_audit_log: caller has no tenant claim'
      using errcode = '42501';
  end if;

  select id into v_employee_id
  from public.employees
  where user_id = auth.uid()
    and tenant_id = v_tenant_id
  limit 1;

  insert into public.security_audit_logs (
    tenant_id, actor_user_id, actor_employee_id, actor_role,
    action_type, resource_name, resource_id,
    old_values, new_values, metadata,
    ip_address, user_agent
  ) values (
    v_tenant_id, auth.uid(), v_employee_id, v_role,
    p_action_type, p_resource_name, p_resource_id,
    p_old_values, p_new_values, p_metadata,
    p_ip_address, p_user_agent
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_audit_log(
  public.audit_action_type, text, text, jsonb, jsonb, jsonb, inet, text
) from public;
grant execute on function public.record_audit_log(
  public.audit_action_type, text, text, jsonb, jsonb, jsonb, inet, text
) to authenticated, service_role;
