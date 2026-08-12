-- =============================================================================
-- 0083 — Extend seed_default_master_data() with universal
--        transport_need + rab_category defaults.
--
-- Background:
--   Migration 0049 introduced `lookup_options` with 4 domains
--   (unit_pengaju, transport_need, area, rab_category) but seeded rows
--   ONLY into supabase/seed.sql for the demo tenant. Migration 0054
--   added `seed_default_master_data()` covering department / position /
--   budget_category — and 0082 wired that helper into
--   `provision_tenant()` — but the 4 legacy domains stayed demo-only.
--
--   Two of those four domains are actually universal categorical
--   vocabulary that every tenant needs immediately when opening the
--   Field-Ops Cash Advance form:
--
--     • transport_need — mode of transport ("Motor Pribadi", "Rental
--                        Mobil", "Pesawat", etc.). Codes are generic
--                        transport types, not tenant-specific.
--     • rab_category   — expense category on RAB line items
--                        ("Transportasi", "Konsumsi", "Akomodasi",
--                        etc.). Purely categorical.
--
--   The other two domains (`unit_pengaju`, `area`) stay
--   demo-only — those values (branch names, city clusters) genuinely
--   are tenant-specific and belong in `/settings/lookups` for the
--   admin to curate.
--
-- Behaviour:
--   1. Rewrites `seed_default_master_data()` to also seed
--      transport_need (10 rows) and rab_category (10 rows) — payload
--      is a verbatim copy of the demo seed to preserve stable codes
--      that already appear in existing Field-Ops CA records.
--   2. `on conflict do nothing` keeps the helper idempotent, so
--      backfilling demo (which already has those rows) is a no-op.
--   3. Backfill loop reseeds every existing tenant, so `test-acme`
--      (provisioned before this migration) picks up the 20 new
--      universal rows without needing manual admin curation.
--
-- Rollback:
--   Restore the body of `seed_default_master_data()` from migration
--   0054 (drop the two new `insert into ... transport_need` and
--   `... rab_category` blocks). Data cleanup (only needed if you
--   want a hard rollback):
--
--     delete from public.lookup_options
--     where domain in ('transport_need', 'rab_category')
--       and tenant_id in (
--         select id from public.tenants where slug <> 'demo'
--       );
-- =============================================================================

create or replace function public.seed_default_master_data(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Departments (mirrors DEFAULT_DEPARTMENTS).
  insert into public.lookup_options (tenant_id, domain, code, label, sort_order)
  values
    (p_tenant, 'department', 'OPERATIONS',      'Operations',           10),
    (p_tenant, 'department', 'PROJECT_DELIVERY','Project Delivery',     20),
    (p_tenant, 'department', 'FINANCE',         'Finance',              30),
    (p_tenant, 'department', 'HR',              'Human Resources',      40),
    (p_tenant, 'department', 'IT_INFRA',        'IT & Infrastructure',  50),
    (p_tenant, 'department', 'SALES_MARKETING', 'Sales & Marketing',    60),
    (p_tenant, 'department', 'CLIENT_SUCCESS',  'Client Success',       70)
  on conflict do nothing;

  -- Positions (mirrors DEFAULT_POSITIONS).
  insert into public.lookup_options (tenant_id, domain, code, label, sort_order)
  values
    (p_tenant, 'position', 'AGENT',              'Agent',              10),
    (p_tenant, 'position', 'TEAM_LEAD',          'Team Lead',          20),
    (p_tenant, 'position', 'SUPERVISOR',         'Supervisor',         30),
    (p_tenant, 'position', 'ANALYST',            'Analyst',            40),
    (p_tenant, 'position', 'SENIOR_ANALYST',     'Senior Analyst',     50),
    (p_tenant, 'position', 'MANAGER',            'Manager',            60),
    (p_tenant, 'position', 'HEAD_OF_DEPARTMENT', 'Head of Department', 70),
    (p_tenant, 'position', 'DIRECTOR',           'Director',           80),
    (p_tenant, 'position', 'SPECIALIST',         'Specialist',         90)
  on conflict do nothing;

  -- Budget categories (mirrors BUDGET_CATEGORIES; codes match the
  -- Zod enum in src/lib/validation/budget.ts).
  insert into public.lookup_options (tenant_id, domain, code, label, description, sort_order)
  values
    (p_tenant, 'budget_category', 'DIRECT_LABOUR',   'Direct Labour',   'Salary / labour cost billable to project.',                   10),
    (p_tenant, 'budget_category', 'SUBCONTRACTOR',   'Subcontractor',   'External vendor services (dev studio, agency, etc.).',        20),
    (p_tenant, 'budget_category', 'INFRASTRUCTURE',  'Infrastructure',  'Servers, cloud, network, hardware for the project.',          30),
    (p_tenant, 'budget_category', 'TOOLING',         'Tooling',         'Software licences / SaaS charged to project.',                40),
    (p_tenant, 'budget_category', 'TRAVEL',          'Travel',          'Airfare, lodging, ground transport tied to project sites.',   50),
    (p_tenant, 'budget_category', 'TRAINING',        'Training',        'Team upskilling directly tied to the engagement.',            60),
    (p_tenant, 'budget_category', 'MARKETING',       'Marketing',       'Client-side marketing / event / launch costs.',               70),
    (p_tenant, 'budget_category', 'OPERATIONS',      'Operations',      'Recurring project operations expense.',                       80),
    (p_tenant, 'budget_category', 'CONTINGENCY',     'Contingency',     'Reserve pool for unplanned scope adjustments.',               90),
    (p_tenant, 'budget_category', 'OTHER',           'Other',           'Uncategorised — please add a description on the line item.', 100)
  on conflict do nothing;

  -- Transport modes for Field-Ops CA (universal categorical
  -- vocabulary — every tenant needs these immediately).
  -- Codes copied verbatim from supabase/seed.sql to keep existing
  -- Field-Ops CA records referencing them valid.
  insert into public.lookup_options (tenant_id, domain, code, label, description, sort_order)
  values
    (p_tenant, 'transport_need', 'MOTOR-PRIBADI', 'Motor Pribadi',    'Reimburse BBM sesuai jarak PP.',            10),
    (p_tenant, 'transport_need', 'MOBIL-PRIBADI', 'Mobil Pribadi',    'Reimburse BBM + toll sesuai jarak PP.',     20),
    (p_tenant, 'transport_need', 'RENTAL-MOTOR',  'Rental Motor',     null,                                        30),
    (p_tenant, 'transport_need', 'RENTAL-MOBIL',  'Rental Mobil',     null,                                        40),
    (p_tenant, 'transport_need', 'CARTER',        'Carter Kendaraan', 'Charter kendaraan + driver.',               50),
    (p_tenant, 'transport_need', 'TAKSI-GRAB',    'Taksi / Grab',     'Ride-hailing atau taksi meteran.',          60),
    (p_tenant, 'transport_need', 'PESAWAT',       'Pesawat',          'Tiket pesawat untuk trip antar-pulau.',     70),
    (p_tenant, 'transport_need', 'KERETA',        'Kereta',           'Tiket KAI antar-kota.',                     80),
    (p_tenant, 'transport_need', 'KAPAL',         'Kapal / Ferry',    'Penyeberangan antar-pulau.',                90),
    (p_tenant, 'transport_need', 'OTHER',         'Lain-lain',        'Jelaskan detail di kolom Justifikasi.',    999)
  on conflict do nothing;

  -- RAB expense categories for Field-Ops CA line items (universal
  -- vocabulary).
  insert into public.lookup_options (tenant_id, domain, code, label, description, sort_order)
  values
    (p_tenant, 'rab_category', 'TRANSPORTASI',  'Transportasi',          'BBM, tiket, ride-hailing.',                     10),
    (p_tenant, 'rab_category', 'KONSUMSI',      'Konsumsi',              'Makan / snack tim di lapangan.',                20),
    (p_tenant, 'rab_category', 'AKOMODASI',     'Akomodasi',             'Hotel / menginap.',                             30),
    (p_tenant, 'rab_category', 'TOLL-PARKIR',   'Toll & Parkir',         null,                                            40),
    (p_tenant, 'rab_category', 'TIKET-PESAWAT', 'Tiket Pesawat',         'Termasuk PP + bagasi.',                         45),
    (p_tenant, 'rab_category', 'SEWA-ALAT',     'Sewa Alat',             'Sewa alat lapangan / genset.',                  50),
    (p_tenant, 'rab_category', 'MATERIAL',      'Material / Sparepart',  'Kabel, konektor, komponen jaringan.',           55),
    (p_tenant, 'rab_category', 'KOMUNIKASI',    'Komunikasi',            'Pulsa / paket data on-site.',                   60),
    (p_tenant, 'rab_category', 'DOKUMEN-LEGAL', 'Dokumen & Legal',       'Perizinan, ijin masuk site, stempel notaris.',  65),
    (p_tenant, 'rab_category', 'LAIN-LAIN',     'Lain-lain',             'Tambah detail di kolom Detail.',               999)
  on conflict do nothing;
end;
$$;

comment on function public.seed_default_master_data(uuid) is
  'Idempotent seed of universal lookup defaults (department, position, '
  'budget_category, transport_need, rab_category) for a tenant. Called '
  'by provision_tenant() and safe to re-run. unit_pengaju and area '
  'domains stay demo-only because those values are tenant-specific '
  '(branch names / city clusters) and belong in /settings/lookups.';

revoke all on function public.seed_default_master_data(uuid) from public;
grant execute on function public.seed_default_master_data(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Backfill every existing tenant with the two new domains. Idempotent
-- via `on conflict do nothing` inside the helper.
-- ---------------------------------------------------------------------------
do $$
declare
  t_id uuid;
begin
  for t_id in select id from public.tenants loop
    perform public.seed_default_master_data(t_id);
  end loop;
end $$;
