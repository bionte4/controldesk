-- scripts/seed-itps-project-allowed-units.sql
--
-- Seed sample `project_allowed_units` rows for the `itps` tenant so
-- the Field-Ops Cash Advance dropdown demonstrates the filter
-- behaviour introduced by migration 0086.
--
-- Policy encoded here (adjust with the ITPS finance team as needed):
--
--   Project ITPS-ERP-2026 (Prima Elektronika ERP Rollout)
--     → allowed units: ITPS-Project Admin, IT Support, Management
--       (an ERP rollout is an internal delivery project — costs
--       land on delivery admin, IT support hours, or management
--       oversight)
--
--   Project ITPS-WEB-2026 (Sinar Digital Website Redesign)
--     → allowed units: ITPS-Project Admin, Sales Jakarta
--       (web-redesign work is delivery admin + pre-sales support)
--
--   Project PRJ-2026-0003 (BI-TKO)
--     → NO whitelist row → falls back to entire tenant lookup
--       (so we can prove the fallback path still works)
--
-- Idempotent: uses `ON CONFLICT DO NOTHING` against the natural key
-- (tenant_id, project_id, unit_label). Safe to re-run.

do $$
declare
  v_tenant  uuid;
  v_erp     uuid;
  v_web     uuid;
begin
  select id into v_tenant from public.tenants where slug = 'itps';
  if v_tenant is null then
    raise notice 'Tenant itps not found — nothing to seed.';
    return;
  end if;

  select id into v_erp
  from public.projects
  where tenant_id = v_tenant and code = 'ITPS-ERP-2026';

  select id into v_web
  from public.projects
  where tenant_id = v_tenant and code = 'ITPS-WEB-2026';

  if v_erp is not null then
    insert into public.project_allowed_units
      (tenant_id, project_id, unit_label)
    values
      (v_tenant, v_erp, 'ITPS-Project Admin'),
      (v_tenant, v_erp, 'IT Support'),
      (v_tenant, v_erp, 'Management')
    on conflict (tenant_id, project_id, unit_label) do nothing;
  end if;

  if v_web is not null then
    insert into public.project_allowed_units
      (tenant_id, project_id, unit_label)
    values
      (v_tenant, v_web, 'ITPS-Project Admin'),
      (v_tenant, v_web, 'Sales Jakarta')
    on conflict (tenant_id, project_id, unit_label) do nothing;
  end if;
end
$$;

-- Verify:
select p.code, pau.unit_label
from public.project_allowed_units pau
join public.projects p on p.id = pau.project_id
join public.tenants t on t.id = pau.tenant_id
where t.slug = 'itps'
order by p.code, pau.unit_label;
