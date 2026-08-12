-- ControlDesk — 0008_clients_and_projects.sql
-- Clients, BPO contracts, and Project delivery slice (rules §5, §6, §7).
--
-- Introduces:
--   1. clients                        — customer accounts, 1-to-many projects
--   2. bpo_contracts                  — MRR / MSA per client
--   3. project_status enum + projects — project instances
--   4. project_pm_assignments         — PM ↔ project mapping (rules §7)
--   5. project_employee_assignments   — Employee ↔ project alloc% (rules §7)
--   6. project_budgets                — 1:1 rolling budget + spent tracker
--
-- All tables are tenant-isolated and RLS-enforced via
-- `public.current_tenant_id()`. Money columns use `numeric(18,2)` and are
-- read via `parseMoneyFromDb()` in application code (rules §18).

-- ===========================================================================
-- 1. clients — one row per external customer organization.
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'client_status') then
    create type public.client_status as enum ('PROSPECT', 'ACTIVE', 'ON_HOLD', 'CHURNED');
  end if;
end $$;

create table if not exists public.clients (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  name                  text not null,
  industry              text,
  contact_name          text,
  contact_email         citext,
  contact_phone         text,
  status                public.client_status not null default 'PROSPECT',
  onboarded_at          timestamptz,
  notes                 text,
  created_by            uuid references public.employees(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint clients_name_not_blank check (length(trim(name)) > 0)
);

comment on table public.clients is
  'Customer / client accounts. One client → many projects (rules §6).';

create index if not exists clients_tenant_status_idx
  on public.clients (tenant_id, status);
create unique index if not exists clients_tenant_name_uniq
  on public.clients (tenant_id, lower(name));

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

alter table public.clients enable row level security;

drop policy if exists clients_tenant_read on public.clients;
create policy clients_tenant_read
  on public.clients
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists clients_ops_write on public.clients;
create policy clients_ops_write
  on public.clients
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'OPERATIONS_MANAGER', 'HEAD_MANAGER', 'GENERAL_MANAGER', 'TENANT_ADMIN'
    )
  );

drop policy if exists clients_ops_update on public.clients;
create policy clients_ops_update
  on public.clients
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'OPERATIONS_MANAGER', 'HEAD_MANAGER', 'GENERAL_MANAGER', 'TENANT_ADMIN'
    )
  )
  with check (tenant_id = public.current_tenant_id());

drop policy if exists clients_admin_delete on public.clients;
create policy clients_admin_delete
  on public.clients
  for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in ('TENANT_ADMIN', 'GENERAL_MANAGER')
  );

-- ===========================================================================
-- 2. bpo_contracts — MRR / MSA per client (rules §5).
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'contract_status') then
    create type public.contract_status as enum ('DRAFT', 'ACTIVE', 'ENDED', 'RENEWED', 'TERMINATED');
  end if;
end $$;

create table if not exists public.bpo_contracts (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  client_id             uuid not null references public.clients(id) on delete cascade,
  contract_number       text not null,
  mrr_amount            numeric(18,2) not null default 0 check (mrr_amount >= 0),
  currency              char(3) not null default 'IDR' check (currency = 'IDR'),
  start_date            date not null,
  end_date              date,
  status                public.contract_status not null default 'DRAFT',
  notes                 text,
  created_by            uuid references public.employees(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint bpo_contracts_dates_ok check (end_date is null or end_date >= start_date)
);

comment on table public.bpo_contracts is
  'BPO / Managed Services contract per client. Feeds real-time gross margin (rules §5, §14).';

create unique index if not exists bpo_contracts_tenant_number_uniq
  on public.bpo_contracts (tenant_id, contract_number);
create index if not exists bpo_contracts_tenant_client_idx
  on public.bpo_contracts (tenant_id, client_id, status);

drop trigger if exists bpo_contracts_set_updated_at on public.bpo_contracts;
create trigger bpo_contracts_set_updated_at
  before update on public.bpo_contracts
  for each row execute function public.set_updated_at();

alter table public.bpo_contracts enable row level security;

drop policy if exists bpo_contracts_tenant_read on public.bpo_contracts;
create policy bpo_contracts_tenant_read
  on public.bpo_contracts
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists bpo_contracts_finance_write on public.bpo_contracts;
create policy bpo_contracts_finance_write
  on public.bpo_contracts
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'LEAD_FINANCE', 'HEAD_MANAGER', 'GENERAL_MANAGER', 'TENANT_ADMIN'
    )
  );

drop policy if exists bpo_contracts_finance_update on public.bpo_contracts;
create policy bpo_contracts_finance_update
  on public.bpo_contracts
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'LEAD_FINANCE', 'HEAD_MANAGER', 'GENERAL_MANAGER', 'TENANT_ADMIN'
    )
  )
  with check (tenant_id = public.current_tenant_id());

drop policy if exists bpo_contracts_admin_delete on public.bpo_contracts;
create policy bpo_contracts_admin_delete
  on public.bpo_contracts
  for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in ('TENANT_ADMIN', 'GENERAL_MANAGER')
  );

-- ===========================================================================
-- 3. projects — one row per active engagement.
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_status') then
    create type public.project_status as enum (
      'PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'
    );
  end if;
end $$;

create table if not exists public.projects (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  client_id             uuid not null references public.clients(id) on delete restrict,
  contract_id           uuid references public.bpo_contracts(id) on delete set null,
  code                  text not null,
  name                  text not null,
  description           text,
  status                public.project_status not null default 'PLANNING',
  start_date            date,
  end_date              date,
  created_by            uuid references public.employees(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint projects_name_not_blank check (length(trim(name)) > 0),
  constraint projects_dates_ok check (end_date is null or start_date is null or end_date >= start_date)
);

comment on table public.projects is
  'Project delivery instances. Each project belongs to exactly one client (rules §6).';

create unique index if not exists projects_tenant_code_uniq
  on public.projects (tenant_id, code);
create index if not exists projects_tenant_client_idx
  on public.projects (tenant_id, client_id, status);
create index if not exists projects_tenant_status_idx
  on public.projects (tenant_id, status);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

drop policy if exists projects_tenant_read on public.projects;
create policy projects_tenant_read
  on public.projects
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists projects_ops_write on public.projects;
create policy projects_ops_write
  on public.projects
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'OPERATIONS_MANAGER', 'HEAD_MANAGER', 'GENERAL_MANAGER', 'TENANT_ADMIN'
    )
  );

drop policy if exists projects_ops_update on public.projects;
create policy projects_ops_update
  on public.projects
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'OPERATIONS_MANAGER', 'HEAD_MANAGER', 'GENERAL_MANAGER', 'TENANT_ADMIN'
    )
  )
  with check (tenant_id = public.current_tenant_id());

drop policy if exists projects_admin_delete on public.projects;
create policy projects_admin_delete
  on public.projects
  for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in ('TENANT_ADMIN', 'GENERAL_MANAGER')
  );

-- ===========================================================================
-- 4. project_pm_assignments — PM ↔ project (rules §7).
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'pm_assignment_role') then
    create type public.pm_assignment_role as enum ('PRIMARY_PM', 'CO_PM');
  end if;
  if not exists (select 1 from pg_type where typname = 'assignment_status') then
    create type public.assignment_status as enum ('ACTIVE', 'ENDED');
  end if;
end $$;

create table if not exists public.project_pm_assignments (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  project_id            uuid not null references public.projects(id) on delete cascade,
  pm_employee_id        uuid not null references public.employees(id) on delete restrict,
  assignment_role       public.pm_assignment_role not null default 'PRIMARY_PM',
  status                public.assignment_status not null default 'ACTIVE',
  started_at            timestamptz not null default now(),
  ended_at              timestamptz,
  created_by            uuid references public.employees(id) on delete set null,
  created_at            timestamptz not null default now()
);

comment on table public.project_pm_assignments is
  'PM ↔ Project mapping. One project may have 1 PRIMARY_PM + N CO_PM at a time (rules §7).';

-- Only one ACTIVE PRIMARY_PM per project at any time.
create unique index if not exists project_pm_assignments_one_primary_active
  on public.project_pm_assignments (project_id)
  where status = 'ACTIVE' and assignment_role = 'PRIMARY_PM';

create index if not exists project_pm_assignments_tenant_pm_idx
  on public.project_pm_assignments (tenant_id, pm_employee_id, status);

alter table public.project_pm_assignments enable row level security;

drop policy if exists ppa_tenant_read on public.project_pm_assignments;
create policy ppa_tenant_read
  on public.project_pm_assignments
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists ppa_ops_write on public.project_pm_assignments;
create policy ppa_ops_write
  on public.project_pm_assignments
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'OPERATIONS_MANAGER', 'HEAD_MANAGER', 'GENERAL_MANAGER', 'TENANT_ADMIN'
    )
  );

drop policy if exists ppa_ops_update on public.project_pm_assignments;
create policy ppa_ops_update
  on public.project_pm_assignments
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'OPERATIONS_MANAGER', 'HEAD_MANAGER', 'GENERAL_MANAGER', 'TENANT_ADMIN'
    )
  )
  with check (tenant_id = public.current_tenant_id());

-- ===========================================================================
-- 5. project_employee_assignments — Employee ↔ project (rules §7).
--    total ACTIVE allocation_percentage across projects MUST be ≤ 100.
-- ===========================================================================
create table if not exists public.project_employee_assignments (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  project_id            uuid not null references public.projects(id) on delete cascade,
  employee_id           uuid not null references public.employees(id) on delete restrict,
  allocation_percentage smallint not null check (allocation_percentage between 1 and 100),
  status                public.assignment_status not null default 'ACTIVE',
  started_at            timestamptz not null default now(),
  ended_at              timestamptz,
  created_by            uuid references public.employees(id) on delete set null,
  created_at            timestamptz not null default now()
);

comment on table public.project_employee_assignments is
  'Employee ↔ Project mapping with allocation%. Enforces ≤100% total ACTIVE via trigger (rules §7).';

-- One ACTIVE assignment per (employee, project) at a time — additional edits
-- must END the previous row and create a new one.
create unique index if not exists pea_active_per_employee_project
  on public.project_employee_assignments (employee_id, project_id)
  where status = 'ACTIVE';

create index if not exists pea_tenant_employee_idx
  on public.project_employee_assignments (tenant_id, employee_id, status);
create index if not exists pea_tenant_project_idx
  on public.project_employee_assignments (tenant_id, project_id, status);

-- Rules §7: total ACTIVE alloc across all projects must not exceed 100%.
create or replace function public.check_employee_allocation_capacity()
returns trigger
language plpgsql
as $$
declare
  v_total smallint;
begin
  if new.status <> 'ACTIVE' then
    return new;
  end if;

  select coalesce(sum(allocation_percentage), 0)::smallint into v_total
  from public.project_employee_assignments
  where employee_id = new.employee_id
    and status = 'ACTIVE'
    and (tg_op = 'INSERT' or id <> new.id);

  if (v_total + new.allocation_percentage) > 100 then
    -- PL/pgSQL `raise exception` uses %-substitution (not printf), so
    -- literal `%` requires `%%` and every `%` consumes an arg. Compose
    -- the message via format() so the printf-style %s / %% grammar
    -- keeps the intent readable.
    raise exception '%', format(
      'Employee %s over-allocated: current active %s%% + new %s%% > 100%%',
      new.employee_id, v_total, new.allocation_percentage
    )
    using errcode = '23514';  -- check_violation
  end if;

  return new;
end;
$$;

drop trigger if exists pea_alloc_capacity_check on public.project_employee_assignments;
create trigger pea_alloc_capacity_check
  before insert or update on public.project_employee_assignments
  for each row execute function public.check_employee_allocation_capacity();

alter table public.project_employee_assignments enable row level security;

drop policy if exists pea_tenant_read on public.project_employee_assignments;
create policy pea_tenant_read
  on public.project_employee_assignments
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists pea_pm_write on public.project_employee_assignments;
create policy pea_pm_write
  on public.project_employee_assignments
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'PROJECT_MANAGER',
      'OPERATIONS_MANAGER',
      'HEAD_MANAGER',
      'GENERAL_MANAGER',
      'TENANT_ADMIN'
    )
  );

drop policy if exists pea_pm_update on public.project_employee_assignments;
create policy pea_pm_update
  on public.project_employee_assignments
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'PROJECT_MANAGER',
      'OPERATIONS_MANAGER',
      'HEAD_MANAGER',
      'GENERAL_MANAGER',
      'TENANT_ADMIN'
    )
  )
  with check (tenant_id = public.current_tenant_id());

-- ===========================================================================
-- 6. project_budgets — 1:1 rolling budget + spent tracker.
-- ===========================================================================
create table if not exists public.project_budgets (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  project_id            uuid not null references public.projects(id) on delete cascade,
  budget_amount         numeric(18,2) not null default 0 check (budget_amount >= 0),
  spent_amount          numeric(18,2) not null default 0 check (spent_amount >= 0),
  currency              char(3) not null default 'IDR' check (currency = 'IDR'),
  updated_at            timestamptz not null default now(),
  constraint project_budgets_project_unique unique (project_id)
);

comment on table public.project_budgets is
  '1:1 with projects. `spent_amount` is bumped by settled expenses / cash advances / petty cash (rules §9-§11).';

create index if not exists project_budgets_tenant_idx
  on public.project_budgets (tenant_id);

drop trigger if exists project_budgets_set_updated_at on public.project_budgets;
create trigger project_budgets_set_updated_at
  before update on public.project_budgets
  for each row execute function public.set_updated_at();

alter table public.project_budgets enable row level security;

drop policy if exists pb_tenant_read on public.project_budgets;
create policy pb_tenant_read
  on public.project_budgets
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists pb_finance_write on public.project_budgets;
create policy pb_finance_write
  on public.project_budgets
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'LEAD_FINANCE',
      'OPERATIONS_MANAGER',
      'HEAD_MANAGER',
      'GENERAL_MANAGER',
      'TENANT_ADMIN'
    )
  );

drop policy if exists pb_finance_update on public.project_budgets;
create policy pb_finance_update
  on public.project_budgets
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in (
      'LEAD_FINANCE',
      'OPERATIONS_MANAGER',
      'HEAD_MANAGER',
      'GENERAL_MANAGER',
      'TENANT_ADMIN'
    )
  )
  with check (tenant_id = public.current_tenant_id());

-- ===========================================================================
-- 7. Convenience helper — is the current caller actively assigned to project?
-- ===========================================================================
create or replace function public.is_assigned_to_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_employee_assignments pea
    join public.employees me on me.id = pea.employee_id
    where pea.project_id = p_project_id
      and pea.status = 'ACTIVE'
      and pea.tenant_id = public.current_tenant_id()
      and me.user_id = auth.uid()
  );
$$;

revoke all on function public.is_assigned_to_project(uuid) from public;
grant execute on function public.is_assigned_to_project(uuid) to authenticated, service_role;
