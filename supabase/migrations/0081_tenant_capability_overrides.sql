-- 0081_tenant_capability_overrides.sql
--
-- Fase 2 admin capability toggle system (rules §3, master §6 roles).
--
-- Prior to this migration, "who can view budgets / payroll / petty
-- cash / …" was hardcoded in `src/lib/rbac/roles.ts` as inline role
-- lists. Multi-tenant deployments cannot survive that: a tenant may
-- legitimately want to grant a Supervisor budget visibility while the
-- next tenant keeps the default lockdown. This table backs a per-
-- tenant, per-role, per-capability override matrix rendered at
-- `/settings/capabilities`.
--
-- Resolution semantics (implemented in
-- `src/lib/rbac/capability-resolver.ts`):
--   default_roles  = CAPABILITY_CATALOG[capability_id].defaultRoles
--   effective_role_set(tenant, capability) =
--     default_roles
--       ∪ { r : overrides row (tenant, capability, r) with granted = true }
--       \ { r : overrides row (tenant, capability, r) with granted = false }
--
-- The `granted` boolean distinguishes an explicit grant (add role to
-- effective set even though default excludes it) from an explicit
-- revoke (remove role even though default includes it). Rows are
-- upserted from the admin UI; deleting a row reverts that (tenant,
-- capability, role) triple to the catalog default.
--
-- Rollback:
--   drop policy if exists tenant_capability_overrides_tenant_read
--     on public.tenant_capability_overrides;
--   drop policy if exists tenant_capability_overrides_admin_write
--     on public.tenant_capability_overrides;
--   drop trigger if exists set_capability_override_updated_at
--     on public.tenant_capability_overrides;
--   drop function if exists public.tg_capability_override_updated_at();
--   drop table if exists public.tenant_capability_overrides;

create table if not exists public.tenant_capability_overrides (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  -- `capability_id` is a stable string from
  -- `src/lib/rbac/capabilities.ts::CapabilityId`. Stored as text (not
  -- an enum) so a code deployment can add a new capability without
  -- also shipping a schema migration. Stale rows for a deleted
  -- capability are inert (resolver ignores unknown ids) — but we
  -- still recommend an explicit cleanup migration when retiring a
  -- capability, see catalog file header.
  capability_id  text not null,
  role           public.employee_role not null,
  granted        boolean not null,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.employees(id),
  constraint tenant_capability_overrides_unique
    unique (tenant_id, capability_id, role)
);

-- Helpful covering index for the "load all overrides for tenant X"
-- read pattern used by `resolveCapabilitiesFor()` on every RSC page
-- render (cached via React.cache for request de-dup).
create index if not exists tenant_capability_overrides_tenant_cap_idx
  on public.tenant_capability_overrides (tenant_id, capability_id);

-- ---------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------
alter table public.tenant_capability_overrides enable row level security;

-- SELECT — any signed-in member of the tenant may read their own
-- tenant's overrides. This is deliberately broad: the resolver
-- consumes these rows on every RSC render for capability decisions,
-- so gating SELECT to admins would break the app for everyone else.
-- The `granted` boolean is not a secret; the tenant admin decides
-- who sees what and that decision is applied via the resolver.
create policy tenant_capability_overrides_tenant_read
  on public.tenant_capability_overrides
  for select
  using (tenant_id = public.current_tenant_id());

-- WRITE — only TENANT_ADMIN or GENERAL_MANAGER in the caller's
-- tenant may upsert/delete overrides. GM is included so a founder
-- who doesn't want to hand out full ADMIN can still tune capability
-- visibility. Anyone else attempting a write is rejected at the
-- policy layer, in addition to the app-layer PDP guard.
create policy tenant_capability_overrides_admin_write
  on public.tenant_capability_overrides
  for all
  using (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1
      from public.employees e
      where e.user_id = auth.uid()
        and e.tenant_id = tenant_id
        and e.role in ('TENANT_ADMIN', 'GENERAL_MANAGER')
    )
  )
  with check (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1
      from public.employees e
      where e.user_id = auth.uid()
        and e.tenant_id = tenant_id
        and e.role in ('TENANT_ADMIN', 'GENERAL_MANAGER')
    )
  );

-- ---------------------------------------------------------------
-- Trigger — keep `updated_at` fresh so the admin matrix UI can
-- show "last changed <relative>" alongside each toggle.
-- ---------------------------------------------------------------
create or replace function public.tg_capability_override_updated_at()
returns trigger
language plpgsql
security definer
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_capability_override_updated_at
  on public.tenant_capability_overrides;

create trigger set_capability_override_updated_at
  before update on public.tenant_capability_overrides
  for each row execute function public.tg_capability_override_updated_at();

comment on table public.tenant_capability_overrides is
  'Per-tenant overrides for the capability catalog defined in src/lib/rbac/capabilities.ts. Resolved by capability-resolver.ts; grant/revoke semantics documented in migration 0081 header.';
