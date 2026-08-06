-- =============================================================================
-- ControlDesk — seed_dummy.sql (top-up / append-only)
--
-- Menambah dummy data volume di atas seed inti supaya halaman-halaman list
-- (Pengajuan Biaya, Kas Bon, Kas Kecil, Cuti & Lembur, Notifikasi, Approval)
-- terasa "berisi" saat diakses. Idempotent — semua row diberi UUID
-- deterministik + `ON CONFLICT DO NOTHING`.
--
-- Apply:
--   docker exec -i supabase_db_controldesk psql -U postgres -d postgres \
--     < supabase/seed_dummy.sql
-- =============================================================================

DO $$
DECLARE
  -- Tenant
  v_tenant_id uuid := (SELECT id FROM public.tenants WHERE slug = 'demo');

  -- Employees (from public.employees, demo tenant)
  v_employee   uuid := 'df43a350-1944-4b87-b254-87dcd9765b8b';
  v_supervisor uuid := '4ccabc4d-94a7-4afc-a454-5c45e1fa3797';
  v_pm         uuid := 'fd8987cd-16f9-434f-911e-c26bf3a410f4';
  v_pm2        uuid := '76479aa0-4318-4eb4-936d-ca3353fdedc9';
  v_om         uuid := '52cad416-4375-4b75-9d85-cc16ccd36ebf';
  v_hm         uuid := '3915f982-efbb-4cf6-a1d7-1019cd770206';
  v_gm         uuid := 'fde85271-e1a5-4bc2-b082-8198c15cfd20';
  v_pettycash  uuid := '777cc1a2-5c4b-4df0-ab1d-8380a50acff1';
  v_finance    uuid := '4292cb65-5145-4112-9354-9ac5cebbdbd2';
  v_hr         uuid := 'dceab960-d423-41e8-829a-ef5de6b13557';
  v_admin      uuid := 'b8808630-62ae-4db4-a4da-46c14050ed6e';

  -- User IDs (auth.users) untuk notifications
  u_pm         uuid := '6d21c36d-9868-4ced-a000-a7239f8be6b8';
  u_finance    uuid := '1a84b530-f490-4093-9176-1dc875e7070a';
  u_supervisor uuid := 'a9587af1-4f95-4760-a80c-2cea2059871e';
  u_om         uuid := 'f5ec7478-1ccc-4d1d-94c5-7949bdc328ea';
  u_employee   uuid := 'c49c4e8b-8548-41e6-af4a-dbe964e5a43e';
  u_admin      uuid := '8ff6ecfd-053b-42cf-9123-266e07ad271a';
  u_hr         uuid := 'd652b76a-c34d-4e1b-9b18-f8f3d0d5140b';

  -- Projects
  p_nusa_cs    uuid := '33333333-1111-4111-8111-111111111111';
  p_nusa_bo    uuid := '33333333-1111-4111-8111-222222222222';
  p_indo_help  uuid := '33333333-1111-4111-8111-333333333333';
  p_kira_da    uuid := '33333333-1111-4111-8111-444444444444';

  -- Petty cash fund
  pcf_jkt      uuid := '77777777-1111-4111-8111-111111111111';
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Demo tenant tidak ditemukan. Jalankan seed.sql dulu.';
  END IF;

  -- ===========================================================================
  -- 1. Project Expenses — 15 baris berbagai status + kategori + nominal
  --    IDs: aaaaaaaa-1111-4111-8111-XXX (X = serial hex)
  -- ===========================================================================

  INSERT INTO public.project_expenses
    (id, tenant_id, project_id, submitter_employee_id, amount, category,
     description, incurred_on, status, created_at,
     finance_approved_at, finance_approver_id,
     final_approved_at, final_approver_id,
     rejected_at, rejected_by, rejection_reason)
  VALUES
    ('aaaaaaaa-1111-4111-8111-000000000001', v_tenant_id, p_nusa_cs,   v_employee,    450000,   'Transport',      'Taksi survey klien Nusa (Jakarta - Bekasi PP)',                        CURRENT_DATE - 1,  'PENDING_L1_SUPERVISOR',        NOW() - INTERVAL '1 day',  NULL, NULL, NULL, NULL, NULL, NULL, NULL),
    ('aaaaaaaa-1111-4111-8111-000000000002', v_tenant_id, p_nusa_cs,   v_employee,    280000,   'Meals',          'Meeting lunch tim onboarding CS batch 4',                              CURRENT_DATE - 2,  'PENDING_L1_SUPERVISOR',        NOW() - INTERVAL '2 days', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
    ('aaaaaaaa-1111-4111-8111-000000000003', v_tenant_id, p_nusa_bo,   v_supervisor,  850000,   'Communication',  'Pulsa & data internet tim BO Feb 2026',                                CURRENT_DATE - 3,  'PENDING_L2_PROJECT_MANAGER',   NOW() - INTERVAL '3 days', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
    ('aaaaaaaa-1111-4111-8111-000000000004', v_tenant_id, p_indo_help, v_supervisor,  1250000,  'Training',       'Sertifikasi teknis CX Foundation batch 3',                             CURRENT_DATE - 5,  'PENDING_L2_PROJECT_MANAGER',   NOW() - INTERVAL '5 days', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
    ('aaaaaaaa-1111-4111-8111-000000000005', v_tenant_id, p_nusa_cs,   v_pm,          3800000,  'Materials',      'Headset noise-cancelling tim CS (10 unit)',                            CURRENT_DATE - 7,  'PENDING_L2_5_FINANCE',         NOW() - INTERVAL '7 days', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
    ('aaaaaaaa-1111-4111-8111-000000000006', v_tenant_id, p_kira_da,   v_pm2,         2100000,  'Accommodation',  'Hotel training vendor annotation Bali (2 malam)',                      CURRENT_DATE - 8,  'PENDING_L2_5_FINANCE',         NOW() - INTERVAL '8 days', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
    ('aaaaaaaa-1111-4111-8111-000000000007', v_tenant_id, p_indo_help, v_pm,          7500000,  'Materials',      'Emergency spare workstation + license SW',                             CURRENT_DATE - 10, 'PENDING_L3_OPERATIONS_MANAGER',NOW() - INTERVAL '10 days',NOW() - INTERVAL '2 days', v_finance, NULL, NULL, NULL, NULL, NULL),
    ('aaaaaaaa-1111-4111-8111-000000000008', v_tenant_id, p_nusa_cs,   v_pm,          15000000, 'Materials',      'Renovasi workstation area CS (30 seat)',                               CURRENT_DATE - 12, 'PENDING_L4_HEAD_MANAGER',      NOW() - INTERVAL '12 days',NOW() - INTERVAL '3 days', v_finance, NULL, NULL, NULL, NULL, NULL),
    ('aaaaaaaa-1111-4111-8111-000000000009', v_tenant_id, p_nusa_cs,   v_employee,    350000,   'Transport',      'Grab site visit vendor VoIP',                                          CURRENT_DATE - 14, 'APPROVED',                     NOW() - INTERVAL '14 days',NOW() - INTERVAL '10 days', v_finance, NOW() - INTERVAL '10 days', v_supervisor, NULL, NULL, NULL),
    ('aaaaaaaa-1111-4111-8111-00000000000a', v_tenant_id, p_nusa_bo,   v_supervisor,  520000,   'Meals',          'Snack briefing shift malam (batch Jan)',                               CURRENT_DATE - 20, 'APPROVED',                     NOW() - INTERVAL '20 days',NOW() - INTERVAL '15 days', v_finance, NOW() - INTERVAL '15 days', v_supervisor, NULL, NULL, NULL),
    ('aaaaaaaa-1111-4111-8111-00000000000b', v_tenant_id, p_indo_help, v_employee,    1150000,  'Communication',  'Voucher data agent field 25 unit',                                     CURRENT_DATE - 22, 'APPROVED',                     NOW() - INTERVAL '22 days',NOW() - INTERVAL '17 days', v_finance, NOW() - INTERVAL '17 days', v_supervisor, NULL, NULL, NULL),
    ('aaaaaaaa-1111-4111-8111-00000000000c', v_tenant_id, p_kira_da,   v_pm2,         4500000,  'Training',       'Workshop tools annotation vendor eksternal',                           CURRENT_DATE - 25, 'APPROVED',                     NOW() - INTERVAL '25 days',NOW() - INTERVAL '20 days', v_finance, NOW() - INTERVAL '20 days', v_pm2,        NULL, NULL, NULL),
    ('aaaaaaaa-1111-4111-8111-00000000000d', v_tenant_id, p_nusa_cs,   v_employee,    800000,   'Meals',          'Team dinner post go-live (rejected: bukan project scope)',             CURRENT_DATE - 6,  'REJECTED',                     NOW() - INTERVAL '6 days', NULL, NULL, NULL, NULL, NOW() - INTERVAL '4 days', v_supervisor, 'Bukan aktivitas billable — pisahkan ke budget engagement internal.'),
    ('aaaaaaaa-1111-4111-8111-00000000000e', v_tenant_id, p_nusa_bo,   v_supervisor,  1800000,  'Materials',      'Backup UPS ruang server (rejected: sudah ada di CAPEX Q4)',            CURRENT_DATE - 9,  'REJECTED',                     NOW() - INTERVAL '9 days', NULL, NULL, NULL, NULL, NOW() - INTERVAL '5 days', v_pm,         'Sudah tercover di pengajuan CAPEX Q4 2025.'),
    ('aaaaaaaa-1111-4111-8111-00000000000f', v_tenant_id, p_nusa_cs,   v_employee,    125000,   'Transport',      'Draft: parkir workshop klien (belum submit)',                          CURRENT_DATE - 0,  'DRAFT',                        NOW() - INTERVAL '2 hours',NULL, NULL, NULL, NULL, NULL, NULL, NULL)
  ON CONFLICT (id) DO NOTHING;

  -- ===========================================================================
  -- 2. Cash Advances — 5 baris mixed status
  -- ===========================================================================

  INSERT INTO public.cash_advances
    (id, tenant_id, project_id, requester_employee_id, amount, purpose, needed_by,
     status, ca_type, created_at,
     supervisor_approved_at, supervisor_approver_id,
     pm_approved_at, pm_approver_id,
     finance_approved_at, finance_approver_id,
     disbursed_at, disbursed_by, disbursement_ref)
  VALUES
    ('bbbbbbbb-1111-4111-8111-000000000001', v_tenant_id, p_nusa_cs,   v_employee,    2500000,  'Uang muka pelatihan agent shift baru (3 hari)',   CURRENT_DATE + 3, 'PENDING_L1_SUPERVISOR',      'GENERAL',   NOW() - INTERVAL '6 hours',  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
    ('bbbbbbbb-1111-4111-8111-000000000002', v_tenant_id, p_indo_help, v_supervisor,  6800000,  'Kas kunjungan lapangan Sumatera (5 hari, 2 org)', CURRENT_DATE + 5, 'PENDING_L2_PROJECT_MANAGER', 'FIELD_OPS', NOW() - INTERVAL '2 days',   NOW() - INTERVAL '1 day', v_supervisor, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
    ('bbbbbbbb-1111-4111-8111-000000000003', v_tenant_id, p_nusa_bo,   v_pm,          12000000, 'Site setup verification lab Q1',                  CURRENT_DATE + 7, 'PENDING_L2_5_FINANCE',       'GENERAL',   NOW() - INTERVAL '4 days',   NOW() - INTERVAL '3 days', v_supervisor, NOW() - INTERVAL '2 days', v_pm, NULL, NULL, NULL, NULL, NULL),
    ('bbbbbbbb-1111-4111-8111-000000000004', v_tenant_id, p_nusa_cs,   v_pm2,         3500000,  'Vendor visit + demo tools Jakarta',               CURRENT_DATE + 10,'APPROVED',                    'GENERAL',   NOW() - INTERVAL '7 days',   NOW() - INTERVAL '6 days', v_supervisor, NOW() - INTERVAL '5 days', v_pm, NOW() - INTERVAL '3 days', v_finance, NULL, NULL, NULL),
    ('bbbbbbbb-1111-4111-8111-000000000005', v_tenant_id, p_kira_da,   v_pm,          8500000,  'Bootcamp annotator batch #2 (5 hari)',            CURRENT_DATE - 5, 'DISBURSED',                   'GENERAL',   NOW() - INTERVAL '15 days',  NOW() - INTERVAL '14 days', v_supervisor, NOW() - INTERVAL '13 days', v_pm, NOW() - INTERVAL '12 days', v_finance, NOW() - INTERVAL '10 days', v_finance, 'TRX-CA-2026-0135')
  ON CONFLICT (id) DO NOTHING;

  -- ===========================================================================
  -- 3. Petty Cash Vouchers — 10 baris berbagai kategori (semua RECORDED)
  -- ===========================================================================

  INSERT INTO public.petty_cash_vouchers
    (id, tenant_id, fund_id, created_by, amount, category, description, incurred_on, status, created_at)
  VALUES
    ('cccccccc-1111-4111-8111-000000000001', v_tenant_id, pcf_jkt, v_pettycash, 85000,  'Konsumsi',       'Snack briefing pagi shift (24 org)',              CURRENT_DATE - 1,  'RECORDED', NOW() - INTERVAL '1 day'),
    ('cccccccc-1111-4111-8111-000000000002', v_tenant_id, pcf_jkt, v_pettycash, 145000, 'Transport',      'Ojol antar-jemput dokumen kontrak klien',         CURRENT_DATE - 2,  'RECORDED', NOW() - INTERVAL '2 days'),
    ('cccccccc-1111-4111-8111-000000000003', v_tenant_id, pcf_jkt, v_pettycash, 220000, 'Alat Tulis',     'Kertas A4, tinta printer, map arsip HR',          CURRENT_DATE - 3,  'RECORDED', NOW() - INTERVAL '3 days'),
    ('cccccccc-1111-4111-8111-000000000004', v_tenant_id, pcf_jkt, v_pettycash, 380000, 'Materials',      'Kabel & konektor darurat (VGA + HDMI + LAN)',      CURRENT_DATE - 5,  'RECORDED', NOW() - INTERVAL '5 days'),
    ('cccccccc-1111-4111-8111-000000000005', v_tenant_id, pcf_jkt, v_pettycash, 65000,  'Konsumsi',       'Kopi & teh rapat exec Q1 review',                 CURRENT_DATE - 6,  'RECORDED', NOW() - INTERVAL '6 days'),
    ('cccccccc-1111-4111-8111-000000000006', v_tenant_id, pcf_jkt, v_pettycash, 190000, 'Maintenance',    'Servis AC ruang server (freon top-up)',           CURRENT_DATE - 8,  'RECORDED', NOW() - INTERVAL '8 days'),
    ('cccccccc-1111-4111-8111-000000000007', v_tenant_id, pcf_jkt, v_pettycash, 55000,  'Transport',      'Parkir kunjungan vendor Jakarta Pusat',           CURRENT_DATE - 10, 'RECORDED', NOW() - INTERVAL '10 days'),
    ('cccccccc-1111-4111-8111-000000000008', v_tenant_id, pcf_jkt, v_pettycash, 425000, 'Kesehatan',      'Kotak P3K refill (obat, plester, betadine)',      CURRENT_DATE - 12, 'RECORDED', NOW() - INTERVAL '12 days'),
    ('cccccccc-1111-4111-8111-000000000009', v_tenant_id, pcf_jkt, v_pettycash, 320000, 'Alat Tulis',     'Whiteboard marker + eraser + name tag batch',     CURRENT_DATE - 15, 'RECORDED', NOW() - INTERVAL '15 days'),
    ('cccccccc-1111-4111-8111-00000000000a', v_tenant_id, pcf_jkt, v_pettycash, 275000, 'Konsumsi',       'Nasi kotak lembur weekend (12 org)',              CURRENT_DATE - 18, 'RECORDED', NOW() - INTERVAL '18 days')
  ON CONFLICT (id) DO NOTHING;

  -- ===========================================================================
  -- 4. HR Requests — 5 baris (Overtime + Leave + Sick, mixed status)
  -- ===========================================================================

  INSERT INTO public.hr_requests
    (id, tenant_id, requester_employee_id, kind, project_id, leave_type,
     start_at, end_at, hours_estimate, reason, attachment_url, status, created_at)
  VALUES
    -- OVERTIME (Sabtu) — pending L1 supervisor
    ('dddddddd-1111-4111-8111-000000000001', v_tenant_id, v_employee, 'OVERTIME', p_nusa_cs, NULL,
     (CURRENT_DATE + 2 || ' 18:00:00+07')::timestamptz,
     (CURRENT_DATE + 2 || ' 22:00:00+07')::timestamptz,
     4, 'Lembur go-live migrasi WhatsApp Business API klien Nusa',
     NULL, 'PENDING_L1_SUPERVISOR', NOW() - INTERVAL '3 hours'),

    -- LEAVE ANNUAL — pending L2 PM
    ('dddddddd-1111-4111-8111-000000000002', v_tenant_id, v_supervisor, 'LEAVE', p_indo_help, 'ANNUAL',
     (CURRENT_DATE + 7 || ' 00:00:00+07')::timestamptz,
     (CURRENT_DATE + 10 || ' 23:59:59+07')::timestamptz,
     NULL, 'Cuti tahunan — mudik lebaran keluarga besar (4 hari)',
     NULL, 'PENDING_L2_PROJECT_MANAGER', NOW() - INTERVAL '2 days'),

    -- SICK (butuh attachment) — approved terminal
    ('dddddddd-1111-4111-8111-000000000003', v_tenant_id, v_employee, 'SICK', NULL, NULL,
     (CURRENT_DATE - 8 || ' 00:00:00+07')::timestamptz,
     (CURRENT_DATE - 6 || ' 23:59:59+07')::timestamptz,
     NULL, 'Sakit demam berdarah — istirahat total 3 hari (surat dokter terlampir)',
     'https://storage.controldesk.app/tenant-attachments/demo/hr/dddddddd-1111-4111-8111-000000000003/surat-dokter.pdf',
     'APPROVED', NOW() - INTERVAL '9 days'),

    -- OVERTIME weekday — pending L3 OM (nominal escalate ke atas)
    ('dddddddd-1111-4111-8111-000000000004', v_tenant_id, v_supervisor, 'OVERTIME', p_indo_help, NULL,
     (CURRENT_DATE - 1 || ' 20:00:00+07')::timestamptz,
     (CURRENT_DATE - 1 || ' 23:30:00+07')::timestamptz,
     3.5, 'Handle spike ticket Sabtu subuh 2AM incident klien retail',
     NULL, 'PENDING_L3_OPERATIONS_MANAGER', NOW() - INTERVAL '18 hours'),

    -- LEAVE UNPAID — draft (belum submit)
    ('dddddddd-1111-4111-8111-000000000005', v_tenant_id, v_employee, 'LEAVE', p_nusa_cs, 'UNPAID',
     (CURRENT_DATE + 20 || ' 00:00:00+07')::timestamptz,
     (CURRENT_DATE + 25 || ' 23:59:59+07')::timestamptz,
     NULL, 'Menemani orangtua rawat inap (kuota cuti tahunan habis)',
     NULL, 'DRAFT', NOW() - INTERVAL '1 hour')
  ON CONFLICT (id) DO NOTHING;

  -- ===========================================================================
  -- 5. Notifications — 20 baris untuk berbagai user (unread + read)
  --    Fokus di user PM, Finance, OM, Supervisor, Employee.
  -- ===========================================================================

  INSERT INTO public.notifications
    (id, tenant_id, user_id, employee_id, kind, title, body, action_url, payload, read_at, created_at)
  VALUES
    -- Unread notifications untuk PM
    ('eeeeeeee-1111-4111-8111-000000000001', v_tenant_id, u_pm, v_pm, 'APPROVAL_REQUESTED',
     'Pengajuan biaya menunggu review L2', 'Rp 850.000 · Nusa Back-Office · Pulsa & data internet',
     '/finance/expenses/aaaaaaaa-1111-4111-8111-000000000003', NULL, NULL, NOW() - INTERVAL '3 days'),
    ('eeeeeeee-1111-4111-8111-000000000002', v_tenant_id, u_pm, v_pm, 'APPROVAL_REQUESTED',
     'Cash Advance perlu approval PM', 'Rp 6.800.000 · Indo Helpdesk · Kas kunjungan lapangan Sumatera',
     '/finance/cash-advances/bbbbbbbb-1111-4111-8111-000000000002', NULL, NULL, NOW() - INTERVAL '1 day'),
    ('eeeeeeee-1111-4111-8111-000000000003', v_tenant_id, u_pm, v_pm, 'APPROVAL_REQUESTED',
     'Pengajuan biaya training menunggu review L2', 'Rp 1.250.000 · Indo Helpdesk · Sertifikasi CX Foundation',
     '/finance/expenses/aaaaaaaa-1111-4111-8111-000000000004', NULL, NULL, NOW() - INTERVAL '5 days'),
    ('eeeeeeee-1111-4111-8111-000000000004', v_tenant_id, u_pm, v_pm, 'SLA_BREACH_WARNING',
     'Peringatan SLA — issue kritikal Nusa CS', 'Ticket #INC-1042 berpotensi melewati SLA response dalam 45 menit',
     '/projects/33333333-1111-4111-8111-111111111111', NULL, NULL, NOW() - INTERVAL '2 hours'),

    -- Unread notifications untuk Finance
    ('eeeeeeee-1111-4111-8111-000000000005', v_tenant_id, u_finance, v_finance, 'APPROVAL_REQUESTED',
     'Pengajuan biaya perlu Finance gate', 'Rp 3.800.000 · Nusa CS · Headset noise-cancelling (10 unit)',
     '/finance/expenses/aaaaaaaa-1111-4111-8111-000000000005', NULL, NULL, NOW() - INTERVAL '7 days'),
    ('eeeeeeee-1111-4111-8111-000000000006', v_tenant_id, u_finance, v_finance, 'APPROVAL_REQUESTED',
     'Cash Advance perlu Finance gate', 'Rp 12.000.000 · Nusa BO · Site setup verification lab',
     '/finance/cash-advances/bbbbbbbb-1111-4111-8111-000000000003', NULL, NULL, NOW() - INTERVAL '2 days'),
    ('eeeeeeee-1111-4111-8111-000000000007', v_tenant_id, u_finance, v_finance, 'APPROVAL_REQUESTED',
     'Akomodasi menunggu Finance review', 'Rp 2.100.000 · Kirana DA · Hotel training vendor Bali',
     '/finance/expenses/aaaaaaaa-1111-4111-8111-000000000006', NULL, NULL, NOW() - INTERVAL '8 days'),
    ('eeeeeeee-1111-4111-8111-000000000008', v_tenant_id, u_finance, v_finance, 'PETTY_CASH_LOW_BALANCE',
     'Saldo kas kecil mendekati minimum', 'Jakarta HQ — sisa Rp 3.225.000 dari plafon Rp 5.000.000',
     '/finance/petty-cash', NULL, NULL, NOW() - INTERVAL '4 hours'),

    -- Unread notifications untuk OM
    ('eeeeeeee-1111-4111-8111-000000000009', v_tenant_id, u_om, v_om, 'APPROVAL_REQUESTED',
     'Pengajuan biaya L3 menunggu review OM', 'Rp 7.500.000 · Indo Helpdesk · Emergency spare workstation',
     '/finance/expenses/aaaaaaaa-1111-4111-8111-000000000007', NULL, NULL, NOW() - INTERVAL '2 days'),
    ('eeeeeeee-1111-4111-8111-00000000000a', v_tenant_id, u_om, v_om, 'APPROVAL_REQUESTED',
     'Lembur weekend perlu review L3', '3.5 jam · Indo Helpdesk · Handle spike ticket 2AM incident',
     '/hr/requests/dddddddd-1111-4111-8111-000000000004', NULL, NULL, NOW() - INTERVAL '18 hours'),

    -- Unread notifications untuk Supervisor
    ('eeeeeeee-1111-4111-8111-00000000000b', v_tenant_id, u_supervisor, v_supervisor, 'APPROVAL_REQUESTED',
     'Pengajuan biaya menunggu review L1', 'Rp 450.000 · Nusa CS · Taksi survey klien',
     '/finance/expenses/aaaaaaaa-1111-4111-8111-000000000001', NULL, NULL, NOW() - INTERVAL '1 day'),
    ('eeeeeeee-1111-4111-8111-00000000000c', v_tenant_id, u_supervisor, v_supervisor, 'APPROVAL_REQUESTED',
     'Pengajuan biaya makan menunggu review L1', 'Rp 280.000 · Nusa CS · Meeting lunch onboarding',
     '/finance/expenses/aaaaaaaa-1111-4111-8111-000000000002', NULL, NULL, NOW() - INTERVAL '2 days'),
    ('eeeeeeee-1111-4111-8111-00000000000d', v_tenant_id, u_supervisor, v_supervisor, 'APPROVAL_REQUESTED',
     'Cash Advance perlu review L1', 'Rp 2.500.000 · Nusa CS · Uang muka pelatihan agent shift',
     '/finance/cash-advances/bbbbbbbb-1111-4111-8111-000000000001', NULL, NULL, NOW() - INTERVAL '6 hours'),
    ('eeeeeeee-1111-4111-8111-00000000000e', v_tenant_id, u_supervisor, v_supervisor, 'APPROVAL_REQUESTED',
     'Lembur weekend menunggu review L1', '4 jam · Nusa CS · Lembur go-live migrasi WhatsApp',
     '/hr/requests/dddddddd-1111-4111-8111-000000000001', NULL, NULL, NOW() - INTERVAL '3 hours'),

    -- Read notifications (untuk history) — Employee
    ('eeeeeeee-1111-4111-8111-00000000000f', v_tenant_id, u_employee, v_employee, 'APPROVAL_APPROVED',
     'Pengajuan biaya Anda disetujui', 'Rp 350.000 · Nusa CS · Grab site visit vendor VoIP',
     '/finance/expenses/aaaaaaaa-1111-4111-8111-000000000009', NULL, NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days'),
    ('eeeeeeee-1111-4111-8111-000000000010', v_tenant_id, u_employee, v_employee, 'APPROVAL_APPROVED',
     'Pengajuan biaya makan disetujui', 'Rp 520.000 · Nusa BO · Snack briefing shift malam',
     '/finance/expenses/aaaaaaaa-1111-4111-8111-00000000000a', NULL, NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days'),
    ('eeeeeeee-1111-4111-8111-000000000011', v_tenant_id, u_employee, v_employee, 'APPROVAL_REJECTED',
     'Pengajuan biaya ditolak', 'Rp 800.000 · Nusa CS · Team dinner post go-live. Alasan: bukan aktivitas billable',
     '/finance/expenses/aaaaaaaa-1111-4111-8111-00000000000d', NULL, NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days'),
    ('eeeeeeee-1111-4111-8111-000000000012', v_tenant_id, u_employee, v_employee, 'HR_REQUEST_UPDATE',
     'Cuti sakit disetujui', '3 hari · SICK · Demam berdarah — surat dokter diterima',
     '/hr/requests/dddddddd-1111-4111-8111-000000000003', NULL, NOW() - INTERVAL '6 days', NOW() - INTERVAL '7 days'),

    -- Unread notifications untuk Admin (audit lens)
    ('eeeeeeee-1111-4111-8111-000000000013', v_tenant_id, u_admin, v_admin, 'SYSTEM',
     'Retensi arsip: batch bulanan sukses', '`security_audit_logs` Juli 2026 diarsipkan (checksum verified)',
     '/settings/archives', NULL, NULL, NOW() - INTERVAL '2 days'),
    ('eeeeeeee-1111-4111-8111-000000000014', v_tenant_id, u_admin, v_admin, 'SYSTEM',
     'Rotasi secret due dalam 14 hari', '`APP_ENCRYPTION_KEY` last rotated 76 hari lalu — quota rotate < 90 hari',
     '/settings/secrets', NULL, NULL, NOW() - INTERVAL '1 day'),

    -- Unread untuk HR
    ('eeeeeeee-1111-4111-8111-000000000015', v_tenant_id, u_hr, v_hr, 'APPROVAL_REQUESTED',
     'HR Request final approval', 'LEAVE ANNUAL 4 hari · Nusa Supervisor · Mudik lebaran',
     '/hr/requests/dddddddd-1111-4111-8111-000000000002', NULL, NULL, NOW() - INTERVAL '2 days')
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Dummy data top-up applied. Rows: expenses +15, cash_advances +5, petty_cash +10, hr_requests +5, notifications +21';
END $$;

-- Verifikasi count
SELECT 'clients'             AS tbl, COUNT(*) FROM public.clients
UNION ALL SELECT 'projects',            COUNT(*) FROM public.projects
UNION ALL SELECT 'employees',           COUNT(*) FROM public.employees
UNION ALL SELECT 'expenses',            COUNT(*) FROM public.project_expenses
UNION ALL SELECT 'cash_advances',       COUNT(*) FROM public.cash_advances
UNION ALL SELECT 'petty_cash_vouchers', COUNT(*) FROM public.petty_cash_vouchers
UNION ALL SELECT 'budgets',             COUNT(*) FROM public.project_budgets
UNION ALL SELECT 'hr_requests',         COUNT(*) FROM public.hr_requests
UNION ALL SELECT 'timesheets',          COUNT(*) FROM public.timesheets
UNION ALL SELECT 'notifications',       COUNT(*) FROM public.notifications
UNION ALL SELECT 'ai_insights',         COUNT(*) FROM public.ai_insights
ORDER BY tbl;
