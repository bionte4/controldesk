-- Migration: 0090_seed_default_area_and_unit_pengaju.sql
-- Purpose : Extend `public.seed_default_master_data()` so newly-
--           provisioned tenants automatically receive default
--           `area` + `unit_pengaju` lookup rows — the two domains
--           still missing after 0083 but required by the Field Ops
--           Cash Advance, Budget, CA General, and Petty Cash forms
--           (see rules §27, §29 + migration 0087).
--
-- Backfill : Every existing tenant is re-run through the seeder so
--            historical tenants that missed 0083 (or the two new
--            domains) receive the rows. The seeder uses
--            `on conflict do nothing`, so tenants that already
--            customised the lookup (e.g. ITPS with 32 rows across
--            these two domains) keep their existing entries — the
--            seeder only fills gaps.
--
-- Rollback : No destructive change — the seeder can only INSERT
--            with `on conflict do nothing`. To undo a specific row
--            per tenant, DELETE from `public.lookup_options` with
--            an explicit `code` filter.

create or replace function public.seed_default_master_data(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
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

  -- Geographic areas (regional coverage — universal Indonesia
  -- coverage vocabulary used by projects.area + Field-Ops CA
  -- site_location + KPI heatmaps). Tenants may extend this list
  -- via /settings/lookups; the seed only fills the base rows.
  insert into public.lookup_options (tenant_id, domain, code, label, sort_order)
  values
    (p_tenant, 'area', 'JABODETABEK', 'Jabodetabek',       10),
    (p_tenant, 'area', 'JABAR',       'Jawa Barat',        20),
    (p_tenant, 'area', 'JATENG-DIY',  'Jawa Tengah & DIY', 30),
    (p_tenant, 'area', 'JATIM',       'Jawa Timur',        40),
    (p_tenant, 'area', 'SUMATERA',    'Sumatera',          50),
    (p_tenant, 'area', 'KALIMANTAN',  'Kalimantan',        60),
    (p_tenant, 'area', 'SULAWESI',    'Sulawesi',          70),
    (p_tenant, 'area', 'BALI-NTB',    'Bali & NTB',        80),
    (p_tenant, 'area', 'MALUKU',      'Maluku',            90),
    (p_tenant, 'area', 'PAPUA',       'Papua',            100),
    (p_tenant, 'area', 'OTHER',       'Lain-lain',        999)
  on conflict do nothing;

  -- Requesting units (unit_pengaju). Generic corporate categories
  -- only — tenants add project- or client-specific units through
  -- /settings/lookups or per-project whitelists via
  -- `project_allowed_units` (migration 0086). The universal seed
  -- keeps the dropdown non-empty so a fresh tenant's first
  -- Budget / CA General / Petty Cash form still has choices.
  insert into public.lookup_options (tenant_id, domain, code, label, sort_order)
  values
    (p_tenant, 'unit_pengaju', 'NOC',          'NOC',                10),
    (p_tenant, 'unit_pengaju', 'FIELD-TEAM',   'Field Team',         20),
    (p_tenant, 'unit_pengaju', 'PROJECT-OPS',  'Project Operations', 30),
    (p_tenant, 'unit_pengaju', 'SALES',        'Sales',              40),
    (p_tenant, 'unit_pengaju', 'HRD',          'HRD',                50),
    (p_tenant, 'unit_pengaju', 'IT-SUPPORT',   'IT Support',         60),
    (p_tenant, 'unit_pengaju', 'FINANCE',      'Finance',            70),
    (p_tenant, 'unit_pengaju', 'MANAGEMENT',   'Management',         80),
    (p_tenant, 'unit_pengaju', 'OTHER',        'Lain-lain',         999)
  on conflict do nothing;
end;
$function$;

-- ---------------------------------------------------------------------
-- Backfill — call seed_default_master_data() for every existing
-- tenant so `demo` (missing department/position/budget_category since
-- it was created pre-0083) and `itps` receive the two new lookup
-- domains. `on conflict do nothing` protects tenant-specific
-- customisations already in place.
-- ---------------------------------------------------------------------
do $$
declare
  t_id uuid;
begin
  for t_id in select id from public.tenants loop
    perform public.seed_default_master_data(t_id);
  end loop;
end $$;
