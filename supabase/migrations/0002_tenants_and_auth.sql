-- ControlDesk — 0002_tenants_and_auth.sql
-- Core tenancy + employee identity slice (rules §3 + §4).
--
-- This migration deliberately covers ONLY what the auth + tenancy skeleton
-- needs. All other tables from rules §14 (projects, cash_advances, petty_cash*,
-- hr_requests, approval_workflows, ...) will land in their own module
-- migrations.

-- ---------------------------------------------------------------------------
-- 1. tenants — one row per customer organization renting ControlDesk.
-- ---------------------------------------------------------------------------
create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),
  slug        citext unique not null,
  name        text not null,
  created_at  timestamptz not null default now(),
  constraint tenants_slug_shape check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$')
);

comment on table public.tenants is
  'One row per customer organization. `slug` is the subdomain label used by proxy.ts.';

-- Tenants are a global lookup table. Reads are only performed by the auth
-- token hook (service role) and admin tooling; regular tenants never SELECT
-- from other tenants' rows because they only need their own row anyway.
-- We enable RLS and expose one narrow policy: users can see the tenant they
-- belong to.
alter table public.tenants enable row level security;

drop policy if exists tenants_self_read on public.tenants;
create policy tenants_self_read
  on public.tenants
  for select
  to authenticated
  using (
    id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id')::uuid
  );

-- ---------------------------------------------------------------------------
-- 2. employee_role enum — rules §4 leadership hierarchy.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'employee_role') then
    create type public.employee_role as enum (
      'EMPLOYEE',
      'SUPERVISOR',
      'PROJECT_MANAGER',
      'OPERATIONS_MANAGER',
      'HEAD_MANAGER',
      'GENERAL_MANAGER',
      'PETTY_CASH_CUSTODIAN',
      'LEAD_FINANCE',
      'HR_ADMIN',
      'TENANT_ADMIN'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. employees — one row per person, scoped to a tenant, linked to auth.users.
-- ---------------------------------------------------------------------------
create table if not exists public.employees (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants(id) on delete cascade,
  user_id                   uuid not null references auth.users(id) on delete cascade,
  role                      public.employee_role not null default 'EMPLOYEE',
  reports_to_employee_id    uuid references public.employees(id) on delete set null,
  full_name                 text not null,
  email                     citext not null,
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint employees_user_unique_per_tenant unique (tenant_id, user_id),
  constraint employees_email_unique_per_tenant unique (tenant_id, email),
  constraint employees_not_self_report check (id <> reports_to_employee_id)
);

comment on table public.employees is
  'One row per staff member. `tenant_id` isolates rows; `reports_to_employee_id` builds the org tree from rules §4.';

create index if not exists employees_tenant_role_idx on public.employees(tenant_id, role);
create index if not exists employees_reports_to_idx on public.employees(reports_to_employee_id);

-- keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists employees_set_updated_at on public.employees;
create trigger employees_set_updated_at
  before update on public.employees
  for each row
  execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS on employees — everyone can only see their own tenant.
-- ---------------------------------------------------------------------------
alter table public.employees enable row level security;

-- SELECT: any authenticated user can read employees from their tenant.
drop policy if exists employees_tenant_read on public.employees;
create policy employees_tenant_read
  on public.employees
  for select
  to authenticated
  using (
    tenant_id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id')::uuid
  );

-- INSERT: only TENANT_ADMIN or HR_ADMIN of the same tenant can add new
-- employees. (Sign-up is handled server-side via the service role during
-- registration, which bypasses RLS.)
drop policy if exists employees_admin_insert on public.employees;
create policy employees_admin_insert
  on public.employees
  for insert
  to authenticated
  with check (
    tenant_id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id')::uuid
    and exists (
      select 1
      from public.employees me
      where me.user_id = auth.uid()
        and me.tenant_id = employees.tenant_id
        and me.role in ('TENANT_ADMIN', 'HR_ADMIN')
        and me.is_active
    )
  );

-- UPDATE: TENANT_ADMIN / HR_ADMIN of the tenant, OR the employee themselves
-- (to edit their own profile fields — actual column-level control comes from
-- server actions, not RLS).
drop policy if exists employees_self_or_admin_update on public.employees;
create policy employees_self_or_admin_update
  on public.employees
  for update
  to authenticated
  using (
    tenant_id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id')::uuid
    and (
      user_id = auth.uid()
      or exists (
        select 1 from public.employees me
        where me.user_id = auth.uid()
          and me.tenant_id = employees.tenant_id
          and me.role in ('TENANT_ADMIN', 'HR_ADMIN')
          and me.is_active
      )
    )
  )
  with check (
    tenant_id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id')::uuid
  );

-- DELETE: only TENANT_ADMIN can hard-delete; soft-deletion via is_active is preferred.
drop policy if exists employees_admin_delete on public.employees;
create policy employees_admin_delete
  on public.employees
  for delete
  to authenticated
  using (
    tenant_id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant_id')::uuid
    and exists (
      select 1 from public.employees me
      where me.user_id = auth.uid()
        and me.tenant_id = employees.tenant_id
        and me.role = 'TENANT_ADMIN'
        and me.is_active
    )
  );
