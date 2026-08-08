-- =============================================================================
-- 0049 — Generic per-tenant reference-data table (`lookup_options`).
--
-- A single polymorphic table that backs every admin-managed dropdown/combobox
-- in the app. Initial domains (rules §17-style vocabulary):
--   - unit_pengaju      — organizational unit filing the request
--   - transport_need    — transportation category on field-ops CA
--   - area              — geographic region for field visits
--   - rab_category      — line-item category on the RAB (Rincian Anggaran)
--
-- Adding a new domain later = extend the CHECK vocabulary in a new
-- migration, no schema change. Storage in downstream tables stays as
-- plain `text` (denormalised label snapshot) so historical rows remain
-- immutable even if admins rename options. Retention rules §22 assume
-- this snapshot pattern for compliance archives.
--
-- RLS: tenant-scoped read for all authenticated users, write restricted to
--      TENANT_ADMIN + GENERAL_MANAGER via `current_employee_role()`.
--
-- Rollback:
--   drop trigger  if exists lookup_options_updated_at on public.lookup_options;
--   drop function if exists public.lookup_options_bump_updated_at();
--   drop table    if exists public.lookup_options;
-- =============================================================================

create table if not exists public.lookup_options (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,

  domain       text not null,
  code         text not null,
  label        text not null,
  description  text,
  sort_order   smallint not null default 100,
  is_active    boolean  not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.employees(id) on delete set null,
  updated_by   uuid references public.employees(id) on delete set null,

  constraint lookup_options_domain_check check (
    domain in ('unit_pengaju', 'transport_need', 'area', 'rab_category')
  ),
  constraint lookup_options_code_not_blank  check (length(trim(code))  > 0),
  constraint lookup_options_label_not_blank check (length(trim(label)) > 0)
);

comment on table public.lookup_options is
  'Generic per-tenant reference-data table. One row per (tenant, domain, code). '
  'Rename-safe: downstream tables store the label as text snapshot at write time.';

-- Only one ACTIVE row per (tenant, domain, code); deactivated rows are
-- kept for audit and do not block re-adding the same code later.
create unique index if not exists lookup_options_active_uidx
  on public.lookup_options (tenant_id, domain, code)
  where is_active;

-- Query pattern: "give me all active options for tenant X in domain Y,
-- ordered by sort_order/label" — served by this composite index.
create index if not exists lookup_options_tenant_domain_idx
  on public.lookup_options (tenant_id, domain, is_active, sort_order, label);

-- Bump updated_at automatically.
create or replace function public.lookup_options_bump_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lookup_options_updated_at on public.lookup_options;
create trigger lookup_options_updated_at
  before update on public.lookup_options
  for each row execute function public.lookup_options_bump_updated_at();

-- ---------------------------------------------------------------------------
-- RLS.
-- ---------------------------------------------------------------------------

alter table public.lookup_options enable row level security;

drop policy if exists lookup_options_tenant_read on public.lookup_options;
create policy lookup_options_tenant_read
  on public.lookup_options
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- Admin-only writes. `current_employee_role()` already folds legacy + canonical
-- roles; TENANT_ADMIN + GENERAL_MANAGER are the only roles allowed to curate.
drop policy if exists lookup_options_admin_insert on public.lookup_options;
create policy lookup_options_admin_insert
  on public.lookup_options
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in ('TENANT_ADMIN', 'GENERAL_MANAGER')
  );

drop policy if exists lookup_options_admin_update on public.lookup_options;
create policy lookup_options_admin_update
  on public.lookup_options
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in ('TENANT_ADMIN', 'GENERAL_MANAGER')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in ('TENANT_ADMIN', 'GENERAL_MANAGER')
  );

drop policy if exists lookup_options_admin_delete on public.lookup_options;
create policy lookup_options_admin_delete
  on public.lookup_options
  for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in ('TENANT_ADMIN', 'GENERAL_MANAGER')
  );

grant select, insert, update, delete
  on public.lookup_options
  to authenticated;

-- =============================================================================
-- End of migration 0049.
-- =============================================================================
