-- ControlDesk — 0025_budgets_gas_align.sql
-- Fase 0 slice 5 — GAS-aligned budgets model (rules §9.2 · GAS Budgets).
--
-- Design (additive, no changes to legacy `project_budgets`):
--   1. `budgets` — one header row per (project, fiscal_year). A project may
--      have multiple budget documents across years; only ONE is APPROVED at
--      a time per fiscal year (unique partial index).
--   2. `budget_details` — line items linked to a budget with:
--        - `planned_amount`     : budgeted spend (frozen at APPROVE)
--        - `realized_amount`    : materialized spend to date
--        - `outstanding_amount` : committed but not yet realized (open PO/CA)
--        - `remaining_amount`   : GENERATED (planned - realized - outstanding)
--      GAS uses this structure to render the executive dashboard tiles and
--      to gate budget requests (Increase/Decrease/Transfer).
--   3. `budget_status` enum — DRAFT → PENDING_FINANCE → PENDING_DIRECTOR
--      → APPROVED → REVISED (in-place edit lifecycle).
--
-- Rollback:
--   drop table if exists public.budget_details;
--   drop table if exists public.budgets;
--   drop type if exists public.budget_status;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'budget_status') then
    create type public.budget_status as enum (
      'DRAFT',
      'PENDING_FINANCE',
      'PENDING_DIRECTOR',
      'APPROVED',
      'REVISED',
      'CANCELLED'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. `budgets` — header per (project, fiscal_year).
-- ---------------------------------------------------------------------------
create table if not exists public.budgets (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  project_id             uuid not null references public.projects(id) on delete cascade,
  fiscal_year            integer not null check (fiscal_year between 2000 and 2100),
  title                  text not null,
  currency               char(3) not null default 'IDR',
  status                 public.budget_status not null default 'DRAFT',
  total_planned_amount   numeric(18, 2) not null default 0 check (total_planned_amount >= 0),
  notes                  text,
  approved_at            timestamptz,
  approved_by            uuid references public.employees(id) on delete set null,
  created_by             uuid references public.employees(id) on delete set null,
  updated_by             uuid references public.employees(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint budgets_title_not_blank check (length(trim(title)) > 0)
);

comment on table public.budgets is
  'GAS-aligned budget header per (project, fiscal_year). Follows a DRAFT → PENDING_FINANCE → PENDING_DIRECTOR → APPROVED lifecycle (rules §9.2). One APPROVED budget per (project, fiscal_year).';

create index if not exists budgets_tenant_project_year_idx
  on public.budgets (tenant_id, project_id, fiscal_year);
create index if not exists budgets_tenant_status_idx
  on public.budgets (tenant_id, status);
create unique index if not exists budgets_one_approved_per_year_uniq
  on public.budgets (tenant_id, project_id, fiscal_year)
  where status = 'APPROVED';

drop trigger if exists budgets_set_updated_at on public.budgets;
create trigger budgets_set_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

alter table public.budgets enable row level security;

drop policy if exists budgets_tenant_read on public.budgets;
create policy budgets_tenant_read
  on public.budgets
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists budgets_authors_write on public.budgets;
create policy budgets_authors_write
  on public.budgets
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('PM', 'OM', 'DIRECTOR', 'FINANCE', 'ADMIN')
  );

drop policy if exists budgets_authors_update on public.budgets;
create policy budgets_authors_update
  on public.budgets
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('PM', 'OM', 'DIRECTOR', 'FINANCE', 'ADMIN')
  )
  with check (tenant_id = public.current_tenant_id());

drop policy if exists budgets_director_delete on public.budgets;
create policy budgets_director_delete
  on public.budgets
  for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('DIRECTOR', 'ADMIN')
  );

-- ---------------------------------------------------------------------------
-- 2. `budget_details` — line items with planned / realized / outstanding.
-- ---------------------------------------------------------------------------
create table if not exists public.budget_details (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  budget_id              uuid not null references public.budgets(id) on delete cascade,
  seq                    integer not null,
  category               text not null,
  description            text,
  planned_amount         numeric(18, 2) not null default 0 check (planned_amount >= 0),
  realized_amount        numeric(18, 2) not null default 0 check (realized_amount >= 0),
  outstanding_amount     numeric(18, 2) not null default 0 check (outstanding_amount >= 0),
  remaining_amount       numeric(18, 2) generated always as
    (planned_amount - realized_amount - outstanding_amount) stored,
  created_by             uuid references public.employees(id) on delete set null,
  updated_by             uuid references public.employees(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint budget_details_category_not_blank check (length(trim(category)) > 0)
);

comment on table public.budget_details is
  'Budget line items (GAS structure). `remaining_amount` is GENERATED — do not write. `outstanding_amount` tracks committed-but-unrealized spend (open PO / disbursed CA awaiting settlement).';

create unique index if not exists budget_details_tenant_budget_seq_uniq
  on public.budget_details (tenant_id, budget_id, seq);
create index if not exists budget_details_tenant_budget_idx
  on public.budget_details (tenant_id, budget_id);

drop trigger if exists budget_details_set_updated_at on public.budget_details;
create trigger budget_details_set_updated_at
  before update on public.budget_details
  for each row execute function public.set_updated_at();

alter table public.budget_details enable row level security;

drop policy if exists budget_details_tenant_read on public.budget_details;
create policy budget_details_tenant_read
  on public.budget_details
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists budget_details_authors_write on public.budget_details;
create policy budget_details_authors_write
  on public.budget_details
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('PM', 'OM', 'DIRECTOR', 'FINANCE', 'ADMIN')
  );

drop policy if exists budget_details_authors_update on public.budget_details;
create policy budget_details_authors_update
  on public.budget_details
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('PM', 'OM', 'DIRECTOR', 'FINANCE', 'ADMIN')
  )
  with check (tenant_id = public.current_tenant_id());

drop policy if exists budget_details_authors_delete on public.budget_details;
create policy budget_details_authors_delete
  on public.budget_details
  for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('PM', 'OM', 'DIRECTOR', 'FINANCE', 'ADMIN')
  );

-- ---------------------------------------------------------------------------
-- 3. Rollup trigger — refresh `budgets.total_planned_amount` when line items
--    change so the executive dashboard doesn't have to aggregate on every read.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_budget_total_planned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget_id uuid;
  v_total numeric(18, 2);
begin
  v_budget_id := coalesce(new.budget_id, old.budget_id);

  select coalesce(sum(planned_amount), 0)
    into v_total
    from public.budget_details
   where budget_id = v_budget_id;

  update public.budgets
     set total_planned_amount = v_total
   where id = v_budget_id;

  return null;
end;
$$;

comment on function public.refresh_budget_total_planned() is
  'Rollup trigger — refreshes `budgets.total_planned_amount` as sum of `budget_details.planned_amount` for the same budget.';

drop trigger if exists budget_details_total_refresh on public.budget_details;
create trigger budget_details_total_refresh
  after insert or update or delete on public.budget_details
  for each row execute function public.refresh_budget_total_planned();
