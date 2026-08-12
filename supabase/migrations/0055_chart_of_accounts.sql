-- =============================================================================
-- 0055 — Chart of Accounts (CoA) master table (Fase 1 of the CoA rollout).
--
-- Introduces per-tenant financial accounts used to classify every budget
-- line item — and, in later phases, every expense / CA / petty-cash entry
-- for double-entry journal generation.
--
-- Design principles:
--   • Numeric account code (`code`) is the human-readable identifier used
--     across finance workflows (e.g. `5101` = "Beban Gaji Direct").
--     Uniqueness is enforced per (tenant_id, code).
--   • Hierarchical via `parent_id` — supports arbitrary depth. `is_postable`
--     flags leaf accounts that can receive postings; parent accounts are
--     containers only. Callers depending on journal integrity must pick a
--     postable=true row.
--   • `account_type` in {ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE} drives
--     normal-side inference and downstream P&L / Balance Sheet grouping.
--     `normal_side` is derived from `account_type` via CHECK, so future
--     journal validation can rely on the row alone.
--   • Deactivation is soft (is_active=false) — historical `budget_details`
--     rows referencing an inactive account remain readable, but the
--     dropdown at budget-line creation filters to `is_active=true` only.
--
-- Multi-tenancy: RLS is tenant-scoped. Read = every authenticated employee
-- (dropdowns everywhere), write = TENANT_ADMIN + LEAD_FINANCE only.
--
-- Seed policy: `seed_default_coa(tenant)` loads ~45 standard accounts sized
-- for an Indonesian service / consulting company. The set matches the
-- 4-digit format widely used by Accurate / Zahir defaults, so exports later
-- won't need code remapping.
--
-- Rollback:
--   drop function if exists public.seed_default_coa(uuid);
--   drop table    if exists public.chart_of_accounts;
--   drop type     if exists public.coa_account_type;
--   drop type     if exists public.coa_normal_side;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum types.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'coa_account_type') then
    create type public.coa_account_type as enum (
      'ASSET',
      'LIABILITY',
      'EQUITY',
      'REVENUE',
      'EXPENSE'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'coa_normal_side') then
    create type public.coa_normal_side as enum ('DEBIT', 'CREDIT');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Main table.
-- ---------------------------------------------------------------------------
create table if not exists public.chart_of_accounts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,

  code          text not null,
  name          text not null,
  account_type  public.coa_account_type not null,
  normal_side   public.coa_normal_side  not null,

  parent_id     uuid references public.chart_of_accounts(id) on delete set null,
  is_postable   boolean not null default true,
  is_active     boolean not null default true,
  description   text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.employees(id) on delete set null,
  updated_by    uuid references public.employees(id) on delete set null,

  constraint chart_of_accounts_code_not_blank check (length(trim(code)) > 0),
  constraint chart_of_accounts_name_not_blank check (length(trim(name)) > 0),
  -- Normal-side must match the accounting convention for the type. This
  -- catches misconfiguration at write time so downstream journal engines
  -- don't have to re-verify on every posting.
  constraint chart_of_accounts_normal_side_matches_type check (
    (account_type in ('ASSET', 'EXPENSE') and normal_side = 'DEBIT')
    or (account_type in ('LIABILITY', 'EQUITY', 'REVENUE') and normal_side = 'CREDIT')
  )
);

comment on table public.chart_of_accounts is
  'Per-tenant Chart of Accounts — master reference for classifying every '
  'financial line (budget, expense, CA, petty cash). Hierarchical via '
  'parent_id; is_postable flags leaf accounts that can receive postings.';

-- Per-tenant unique account code, case-insensitive on the trimmed value.
create unique index if not exists chart_of_accounts_tenant_code_uniq
  on public.chart_of_accounts (tenant_id, code);

create index if not exists chart_of_accounts_tenant_parent_idx
  on public.chart_of_accounts (tenant_id, parent_id);

create index if not exists chart_of_accounts_tenant_active_type_idx
  on public.chart_of_accounts (tenant_id, is_active, account_type, code);

-- Bump updated_at automatically. `set_updated_at()` was defined by an
-- earlier migration (see 0001).
drop trigger if exists chart_of_accounts_set_updated_at on public.chart_of_accounts;
create trigger chart_of_accounts_set_updated_at
  before update on public.chart_of_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS policies.
-- ---------------------------------------------------------------------------
alter table public.chart_of_accounts enable row level security;

drop policy if exists chart_of_accounts_tenant_read on public.chart_of_accounts;
create policy chart_of_accounts_tenant_read
  on public.chart_of_accounts
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- Write policy: only TENANT_ADMIN / ADMIN and LEAD_FINANCE / FINANCE may
-- curate the account list. Everyone else reads for dropdowns; the app
-- layer (PDP + server actions) enforces the same rule so the error path
-- is consistent.
drop policy if exists chart_of_accounts_admin_write on public.chart_of_accounts;
create policy chart_of_accounts_admin_write
  on public.chart_of_accounts
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('ADMIN', 'FINANCE')
  );

drop policy if exists chart_of_accounts_admin_update on public.chart_of_accounts;
create policy chart_of_accounts_admin_update
  on public.chart_of_accounts
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('ADMIN', 'FINANCE')
  )
  with check (tenant_id = public.current_tenant_id());

-- No delete policy — accounts are deactivated (`is_active=false`) instead
-- of removed. Preserves historical references from budget_details, etc.

-- ---------------------------------------------------------------------------
-- 4. Seed helper — idempotent per tenant.
--
--    Loads a standard Indonesian service / consulting COA. Codes match the
--    default numbering scheme used by Accurate / Zahir so future exports
--    don't need remapping. Parent-child links are resolved in a second pass
--    (via UPDATE) because inline recursive INSERTs on the same table need
--    the row IDs to exist first.
-- ---------------------------------------------------------------------------
create or replace function public.seed_default_coa(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id_1000 uuid;
  v_id_1100 uuid;
  v_id_1200 uuid;
  v_id_1500 uuid;
  v_id_2000 uuid;
  v_id_2100 uuid;
  v_id_3000 uuid;
  v_id_4000 uuid;
  v_id_5000 uuid;
  v_id_5100 uuid;
  v_id_5200 uuid;
  v_id_5300 uuid;
  v_id_5400 uuid;
  v_id_5500 uuid;
  v_id_5900 uuid;
begin
  -- === ASSET (1xxx) ===============================================
  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable)
  values (p_tenant, '1000', 'Aset', 'ASSET', 'DEBIT', false)
  on conflict (tenant_id, code) do nothing
  returning id into v_id_1000;
  select id into v_id_1000 from public.chart_of_accounts
    where tenant_id = p_tenant and code = '1000';

  -- Aset Lancar
  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id)
  values (p_tenant, '1100', 'Aset Lancar', 'ASSET', 'DEBIT', false, v_id_1000)
  on conflict (tenant_id, code) do nothing
  returning id into v_id_1100;
  select id into v_id_1100 from public.chart_of_accounts
    where tenant_id = p_tenant and code = '1100';

  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id, description)
  values
    (p_tenant, '1101', 'Kas',                 'ASSET', 'DEBIT', true, v_id_1100, 'Uang tunai di brankas / kasir.'),
    (p_tenant, '1102', 'Bank',                'ASSET', 'DEBIT', true, v_id_1100, 'Saldo rekening bank operasional.'),
    (p_tenant, '1103', 'Kas Kecil (Petty)',   'ASSET', 'DEBIT', true, v_id_1100, 'Petty cash fund per lokasi/cabang.'),
    (p_tenant, '1104', 'Piutang Usaha',       'ASSET', 'DEBIT', true, v_id_1100, 'Piutang dari invoice ke klien.'),
    (p_tenant, '1105', 'Uang Muka Kerja',     'ASSET', 'DEBIT', true, v_id_1100, 'Cash Advance yang belum di-settle.'),
    (p_tenant, '1106', 'Biaya Dibayar Dimuka','ASSET', 'DEBIT', true, v_id_1100, 'Sewa / lisensi / asuransi prepaid.')
  on conflict (tenant_id, code) do nothing;

  -- Aset Tetap
  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id)
  values (p_tenant, '1500', 'Aset Tetap', 'ASSET', 'DEBIT', false, v_id_1000)
  on conflict (tenant_id, code) do nothing
  returning id into v_id_1500;
  select id into v_id_1500 from public.chart_of_accounts
    where tenant_id = p_tenant and code = '1500';

  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id, description)
  values
    (p_tenant, '1501', 'Peralatan Kantor',       'ASSET', 'DEBIT', true, v_id_1500, 'Laptop, monitor, perlengkapan kantor.'),
    (p_tenant, '1502', 'Kendaraan',              'ASSET', 'DEBIT', true, v_id_1500, 'Kendaraan operasional.'),
    (p_tenant, '1599', 'Akumulasi Penyusutan',   'ASSET', 'DEBIT', true, v_id_1500, 'Kontra-aset — akumulasi depresiasi.')
  on conflict (tenant_id, code) do nothing;

  -- === LIABILITY (2xxx) ===========================================
  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable)
  values (p_tenant, '2000', 'Kewajiban', 'LIABILITY', 'CREDIT', false)
  on conflict (tenant_id, code) do nothing
  returning id into v_id_2000;
  select id into v_id_2000 from public.chart_of_accounts
    where tenant_id = p_tenant and code = '2000';

  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id)
  values (p_tenant, '2100', 'Kewajiban Lancar', 'LIABILITY', 'CREDIT', false, v_id_2000)
  on conflict (tenant_id, code) do nothing
  returning id into v_id_2100;
  select id into v_id_2100 from public.chart_of_accounts
    where tenant_id = p_tenant and code = '2100';

  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id, description)
  values
    (p_tenant, '2101', 'Hutang Usaha',      'LIABILITY', 'CREDIT', true, v_id_2100, 'Hutang ke vendor / subcontractor.'),
    (p_tenant, '2102', 'Hutang Pajak',      'LIABILITY', 'CREDIT', true, v_id_2100, 'PPh 21 / PPN / PPh 23 belum disetor.'),
    (p_tenant, '2103', 'Hutang Gaji',       'LIABILITY', 'CREDIT', true, v_id_2100, 'Gaji terhutang akhir periode.'),
    (p_tenant, '2104', 'Pendapatan Diterima Dimuka', 'LIABILITY', 'CREDIT', true, v_id_2100, 'Klien bayar dimuka, jasa belum diberikan.')
  on conflict (tenant_id, code) do nothing;

  -- === EQUITY (3xxx) ==============================================
  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable)
  values (p_tenant, '3000', 'Modal', 'EQUITY', 'CREDIT', false)
  on conflict (tenant_id, code) do nothing
  returning id into v_id_3000;
  select id into v_id_3000 from public.chart_of_accounts
    where tenant_id = p_tenant and code = '3000';

  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id, description)
  values
    (p_tenant, '3101', 'Modal Disetor',    'EQUITY', 'CREDIT', true, v_id_3000, 'Modal awal / setoran pemegang saham.'),
    (p_tenant, '3201', 'Laba Ditahan',     'EQUITY', 'CREDIT', true, v_id_3000, 'Akumulasi laba yang belum dibagikan.'),
    (p_tenant, '3301', 'Laba Tahun Berjalan','EQUITY', 'CREDIT', true, v_id_3000, 'Ikhtisar laba/rugi periode berjalan.')
  on conflict (tenant_id, code) do nothing;

  -- === REVENUE (4xxx) =============================================
  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable)
  values (p_tenant, '4000', 'Pendapatan', 'REVENUE', 'CREDIT', false)
  on conflict (tenant_id, code) do nothing
  returning id into v_id_4000;
  select id into v_id_4000 from public.chart_of_accounts
    where tenant_id = p_tenant and code = '4000';

  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id, description)
  values
    (p_tenant, '4101', 'Pendapatan Jasa Konsultansi', 'REVENUE', 'CREDIT', true, v_id_4000, 'Fee proyek konsultan / dev.'),
    (p_tenant, '4102', 'Pendapatan Managed Services', 'REVENUE', 'CREDIT', true, v_id_4000, 'Recurring MRR dari klien.'),
    (p_tenant, '4103', 'Pendapatan Reimbursable',     'REVENUE', 'CREDIT', true, v_id_4000, 'Reimbursement expense yang di-billback.'),
    (p_tenant, '4901', 'Pendapatan Lain-lain',        'REVENUE', 'CREDIT', true, v_id_4000, 'Bunga bank, keuntungan disposal, dst.')
  on conflict (tenant_id, code) do nothing;

  -- === EXPENSE (5xxx) =============================================
  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable)
  values (p_tenant, '5000', 'Beban', 'EXPENSE', 'DEBIT', false)
  on conflict (tenant_id, code) do nothing
  returning id into v_id_5000;
  select id into v_id_5000 from public.chart_of_accounts
    where tenant_id = p_tenant and code = '5000';

  -- 5100 — Beban Personil (matches budget_category DIRECT_LABOUR)
  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id)
  values (p_tenant, '5100', 'Beban Personil', 'EXPENSE', 'DEBIT', false, v_id_5000)
  on conflict (tenant_id, code) do nothing
  returning id into v_id_5100;
  select id into v_id_5100 from public.chart_of_accounts
    where tenant_id = p_tenant and code = '5100';

  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id, description)
  values
    (p_tenant, '5101', 'Beban Gaji Direct',     'EXPENSE', 'DEBIT', true, v_id_5100, 'Gaji karyawan billable ke proyek.'),
    (p_tenant, '5102', 'Beban Gaji Indirect',   'EXPENSE', 'DEBIT', true, v_id_5100, 'Gaji overhead (admin, GA).'),
    (p_tenant, '5103', 'Beban Tunjangan',       'EXPENSE', 'DEBIT', true, v_id_5100, 'THR, bonus, tunjangan makan.'),
    (p_tenant, '5104', 'Beban BPJS/Asuransi',   'EXPENSE', 'DEBIT', true, v_id_5100, 'BPJS Kesehatan + Ketenagakerjaan.'),
    (p_tenant, '5105', 'Beban Subcontractor',   'EXPENSE', 'DEBIT', true, v_id_5100, 'Vendor eksternal / freelancer.')
  on conflict (tenant_id, code) do nothing;

  -- 5200 — Beban Infrastruktur (INFRASTRUCTURE + TOOLING)
  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id)
  values (p_tenant, '5200', 'Beban Infrastruktur & Tools', 'EXPENSE', 'DEBIT', false, v_id_5000)
  on conflict (tenant_id, code) do nothing
  returning id into v_id_5200;
  select id into v_id_5200 from public.chart_of_accounts
    where tenant_id = p_tenant and code = '5200';

  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id, description)
  values
    (p_tenant, '5201', 'Beban Cloud & Hosting',       'EXPENSE', 'DEBIT', true, v_id_5200, 'AWS, GCP, Azure, VPS.'),
    (p_tenant, '5202', 'Beban Lisensi Software',      'EXPENSE', 'DEBIT', true, v_id_5200, 'SaaS subscription, tooling.'),
    (p_tenant, '5203', 'Beban Hardware & Peralatan',  'EXPENSE', 'DEBIT', true, v_id_5200, 'Perangkat proyek non-kapitalisasi.'),
    (p_tenant, '5204', 'Beban Internet & Telekomunikasi','EXPENSE', 'DEBIT', true, v_id_5200, 'Internet kantor, pulsa, sewa jalur.')
  on conflict (tenant_id, code) do nothing;

  -- 5300 — Beban Perjalanan (TRAVEL + FIELD OPS)
  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id)
  values (p_tenant, '5300', 'Beban Perjalanan Dinas', 'EXPENSE', 'DEBIT', false, v_id_5000)
  on conflict (tenant_id, code) do nothing
  returning id into v_id_5300;
  select id into v_id_5300 from public.chart_of_accounts
    where tenant_id = p_tenant and code = '5300';

  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id, description)
  values
    (p_tenant, '5301', 'Beban Transportasi',   'EXPENSE', 'DEBIT', true, v_id_5300, 'Airfare, kereta, ground transport.'),
    (p_tenant, '5302', 'Beban Akomodasi',      'EXPENSE', 'DEBIT', true, v_id_5300, 'Hotel, penginapan lapangan.'),
    (p_tenant, '5303', 'Beban Konsumsi Dinas', 'EXPENSE', 'DEBIT', true, v_id_5300, 'Makan minum saat dinas / rapat klien.'),
    (p_tenant, '5304', 'Beban Bahan Bakar',    'EXPENSE', 'DEBIT', true, v_id_5300, 'BBM kendaraan operasional / rental.')
  on conflict (tenant_id, code) do nothing;

  -- 5400 — Beban Pelatihan & Pengembangan (TRAINING)
  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id)
  values (p_tenant, '5400', 'Beban Pelatihan & Sertifikasi', 'EXPENSE', 'DEBIT', false, v_id_5000)
  on conflict (tenant_id, code) do nothing
  returning id into v_id_5400;
  select id into v_id_5400 from public.chart_of_accounts
    where tenant_id = p_tenant and code = '5400';

  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id, description)
  values
    (p_tenant, '5401', 'Beban Pelatihan Teknis',   'EXPENSE', 'DEBIT', true, v_id_5400, 'Course / workshop / bootcamp.'),
    (p_tenant, '5402', 'Beban Sertifikasi',        'EXPENSE', 'DEBIT', true, v_id_5400, 'Exam fee, certification renewal.')
  on conflict (tenant_id, code) do nothing;

  -- 5500 — Beban Marketing & Sales (MARKETING)
  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id)
  values (p_tenant, '5500', 'Beban Marketing & Sales', 'EXPENSE', 'DEBIT', false, v_id_5000)
  on conflict (tenant_id, code) do nothing
  returning id into v_id_5500;
  select id into v_id_5500 from public.chart_of_accounts
    where tenant_id = p_tenant and code = '5500';

  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id, description)
  values
    (p_tenant, '5501', 'Beban Digital Advertising',  'EXPENSE', 'DEBIT', true, v_id_5500, 'Google/Meta/LinkedIn ads.'),
    (p_tenant, '5502', 'Beban Event & Sponsorship',  'EXPENSE', 'DEBIT', true, v_id_5500, 'Booth, sponsor konferensi.'),
    (p_tenant, '5503', 'Beban Client Entertainment', 'EXPENSE', 'DEBIT', true, v_id_5500, 'Makan bersama klien, hospitality.')
  on conflict (tenant_id, code) do nothing;

  -- 5900 — Beban Operasional Lain (OPERATIONS + CONTINGENCY + OTHER)
  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id)
  values (p_tenant, '5900', 'Beban Operasional Lain', 'EXPENSE', 'DEBIT', false, v_id_5000)
  on conflict (tenant_id, code) do nothing
  returning id into v_id_5900;
  select id into v_id_5900 from public.chart_of_accounts
    where tenant_id = p_tenant and code = '5900';

  insert into public.chart_of_accounts
    (tenant_id, code, name, account_type, normal_side, is_postable, parent_id, description)
  values
    (p_tenant, '5901', 'Beban Sewa & Utilitas',    'EXPENSE', 'DEBIT', true, v_id_5900, 'Sewa kantor, listrik, air.'),
    (p_tenant, '5902', 'Beban ATK & Supplies',     'EXPENSE', 'DEBIT', true, v_id_5900, 'Alat tulis, printing, konsumsi kantor.'),
    (p_tenant, '5903', 'Beban Administrasi Bank',  'EXPENSE', 'DEBIT', true, v_id_5900, 'Biaya admin, transfer, materai.'),
    (p_tenant, '5904', 'Beban Cadangan / Kontinjensi','EXPENSE', 'DEBIT', true, v_id_5900, 'Kontinjensi proyek — reserve.'),
    (p_tenant, '5999', 'Beban Lain-lain',          'EXPENSE', 'DEBIT', true, v_id_5900, 'Miscellaneous — hindari kalau bisa.')
  on conflict (tenant_id, code) do nothing;
end;
$$;

comment on function public.seed_default_coa(uuid) is
  'Idempotent seed of the default Indonesian service/consulting CoA for a '
  'tenant. Safe to call multiple times. ~45 accounts across ASSET / '
  'LIABILITY / EQUITY / REVENUE / EXPENSE. Codes follow 4-digit convention '
  'compatible with Accurate / Zahir defaults.';

revoke all on function public.seed_default_coa(uuid) from public;
grant execute on function public.seed_default_coa(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Backfill every existing tenant.
-- ---------------------------------------------------------------------------
do $$
declare
  t_id uuid;
begin
  for t_id in select id from public.tenants loop
    perform public.seed_default_coa(t_id);
  end loop;
end $$;
