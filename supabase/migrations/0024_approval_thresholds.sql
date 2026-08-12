-- ControlDesk — 0024_approval_thresholds.sql
-- Fase 0 slice 2 — per-tenant approval threshold configuration table.
--
-- The GAS ERP hard-codes the 3-tier thresholds (PM 5M / Director 50M) in
-- `Config.gs`. ControlDesk supports multi-tenancy, so different tenants may
-- want different caps (e.g. a services boutique with a Rp 1M PM ceiling vs a
-- factory with Rp 20M). This table stores the per-tenant tuning without
-- requiring a redeploy.
--
-- App-layer contract (`src/lib/rbac/thresholds.ts` — Fase 1):
--   1. On read, look up `(tenant_id, kind)`. If row exists, use those values.
--   2. Otherwise fall back to the `APPROVAL_CONFIG` constants in
--      `src/lib/rbac/roles.ts`.
--
-- Rollback:
--   drop table if exists public.approval_thresholds;
--   drop type if exists public.approval_kind;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'approval_kind') then
    create type public.approval_kind as enum (
      'EXPENSE',
      'BUDGET',
      'CASH_ADVANCE_GENERAL',
      'CASH_ADVANCE_FIELD_OPS',
      'PETTY_CASH',
      'BUDGET_REQUEST'
    );
  end if;
end $$;

create table if not exists public.approval_thresholds (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  kind                    public.approval_kind not null,
  -- Money thresholds in IDR — nullable so a tenant can override only the
  -- slots that apply to that `kind`. E.g. BUDGET only uses DIRECTOR_THRESHOLD.
  supervisor_threshold    numeric(18, 2) check (supervisor_threshold is null or supervisor_threshold >= 0),
  pm_threshold            numeric(18, 2) check (pm_threshold is null or pm_threshold >= 0),
  om_threshold            numeric(18, 2) check (om_threshold is null or om_threshold >= 0),
  director_threshold      numeric(18, 2) check (director_threshold is null or director_threshold >= 0),
  -- Petty-cash-specific tuning (values are in IDR unless noted).
  petty_auto_approve_below   numeric(18, 2) check (petty_auto_approve_below is null or petty_auto_approve_below >= 0),
  petty_receipt_required_above numeric(18, 2) check (petty_receipt_required_above is null or petty_receipt_required_above >= 0),
  petty_hard_ceiling         numeric(18, 2) check (petty_hard_ceiling is null or petty_hard_ceiling >= 0),
  -- Field Ops settlement policy.
  settlement_sla_days        integer check (settlement_sla_days is null or settlement_sla_days between 1 and 365),
  notes                      text,
  created_by                 uuid references public.employees(id) on delete set null,
  updated_by                 uuid references public.employees(id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint approval_thresholds_ordered_ck check (
    (supervisor_threshold is null or pm_threshold is null or supervisor_threshold <= pm_threshold)
    and (pm_threshold is null or om_threshold is null or pm_threshold <= om_threshold)
    and (om_threshold is null or director_threshold is null or om_threshold <= director_threshold)
    and (pm_threshold is null or director_threshold is null or pm_threshold <= director_threshold)
  )
);

comment on table public.approval_thresholds is
  'Per-tenant overrides for the GAS-aligned 3-tier approval matrix (rules §9). App falls back to `APPROVAL_CONFIG` in src/lib/rbac/roles.ts when no row exists for `(tenant_id, kind)`.';

create unique index if not exists approval_thresholds_tenant_kind_uniq
  on public.approval_thresholds (tenant_id, kind);

drop trigger if exists approval_thresholds_set_updated_at on public.approval_thresholds;
create trigger approval_thresholds_set_updated_at
  before update on public.approval_thresholds
  for each row execute function public.set_updated_at();

alter table public.approval_thresholds enable row level security;

-- Read: any authenticated user in the tenant (needed to render chain preview
-- in the request form).
drop policy if exists approval_thresholds_tenant_read on public.approval_thresholds;
create policy approval_thresholds_tenant_read
  on public.approval_thresholds
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- Write: ADMIN or DIRECTOR only (canonical). Legacy TENANT_ADMIN /
-- GENERAL_MANAGER / HEAD_MANAGER map to those via `canonical_employee_role()`.
drop policy if exists approval_thresholds_admin_write on public.approval_thresholds;
create policy approval_thresholds_admin_write
  on public.approval_thresholds
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('ADMIN', 'DIRECTOR')
  );

drop policy if exists approval_thresholds_admin_update on public.approval_thresholds;
create policy approval_thresholds_admin_update
  on public.approval_thresholds
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('ADMIN', 'DIRECTOR')
  )
  with check (tenant_id = public.current_tenant_id());

drop policy if exists approval_thresholds_admin_delete on public.approval_thresholds;
create policy approval_thresholds_admin_delete
  on public.approval_thresholds
  for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('ADMIN')
  );
