-- 0086_project_allowed_units.sql
--
-- Per-project whitelist of `unit_pengaju` labels that may appear on a
-- Field-Ops Cash Advance for that project. Without a mapping row, the
-- Field-Ops form falls back to showing every active tenant lookup
-- (backward-compat for projects created before this migration lands).
--
-- Business context:
--   Field-Ops CA is submitted by engineers/supervisors who travel to a
--   site. The "Unit Pengaju" field designates the organisational unit
--   that BEARS THE COST — often different from the requester's own
--   department. For a given project, only certain units are valid
--   cost-centres (e.g. project ITPS-WEB-2026 charges to
--   "ITPS-Project Admin" or "IT Support" but never to "HRD"). This
--   table encodes that policy so the dropdown filters instead of
--   relying on the user to remember.
--
-- Why a separate table (vs. `projects.allowed_units TEXT[]`)?
--   * Audit trail: each mapping mutation surfaces as its own row in
--     `security_audit_logs`, not a diff inside a projects UPDATE.
--   * Cardinality: a project may have 0..N allowed units; the array
--     form makes bulk toggling awkward.
--   * Rename safety: when an admin renames a `lookup_options.label`,
--     an app-layer trigger can walk this table and rewrite matching
--     rows atomically. Doing the same on an inline array is
--     substantially more painful.
--
-- Note on FK to lookup_options:
--   We deliberately do NOT put a foreign key onto `lookup_options`.
--   Reasons:
--     1. The unique index on lookup_options is partial (WHERE
--        is_active) so a naive FK against (tenant_id, domain, code)
--        can't be created without dropping/rebuilding that index.
--     2. Labels are the display value and can be renamed; a hard FK
--        would refuse the rename. We handle rename cascades in the
--        app layer instead.
--     3. Deactivating a lookup shouldn't nuke historical project
--        mappings — the app-layer resolver treats missing labels as
--        "hidden but preserved" for auditability.
--
-- Rollback:
--   drop policy if exists project_allowed_units_tenant_read
--     on public.project_allowed_units;
--   drop policy if exists project_allowed_units_tenant_write
--     on public.project_allowed_units;
--   drop trigger if exists set_project_allowed_units_updated_at
--     on public.project_allowed_units;
--   drop function if exists public.tg_project_allowed_units_updated_at();
--   drop table if exists public.project_allowed_units;

create table if not exists public.project_allowed_units (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  -- Matches `lookup_options.label` where domain='unit_pengaju' and
  -- tenant_id = this row's tenant_id. Enforced by the app-layer
  -- writer; DB layer only checks non-emptiness + uniqueness.
  unit_label  text not null check (length(trim(unit_label)) > 0),
  created_by  uuid references public.employees(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, project_id, unit_label)
);

create index if not exists project_allowed_units_project_idx
  on public.project_allowed_units (tenant_id, project_id);

alter table public.project_allowed_units enable row level security;

-- SELECT — tenant members read their own tenant's mappings.
create policy project_allowed_units_tenant_read
  on public.project_allowed_units
  for select
  using (tenant_id = public.current_tenant_id());

-- INSERT / UPDATE / DELETE — same tenant scope; PDP at the app layer
-- narrows further to project-admin / TENANT_ADMIN / HR_ADMIN roles.
create policy project_allowed_units_tenant_write
  on public.project_allowed_units
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- Keep updated_at fresh on mutations so admin UIs can sort by
-- "recently changed" without reaching into audit logs.
create or replace function public.tg_project_allowed_units_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_project_allowed_units_updated_at
  before update on public.project_allowed_units
  for each row
  execute function public.tg_project_allowed_units_updated_at();

comment on table public.project_allowed_units is
  'Whitelist of unit_pengaju labels valid for each project on Field-Ops Cash Advance forms. Empty mapping = fall back to all tenant lookups.';
