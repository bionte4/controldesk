-- ControlDesk — seed.sql
-- Demo tenant + representative employees per role, wired via reports_to.
--
-- All demo users share the password `ControlDesk#2026` and are already
-- email-confirmed so you can sign in immediately via `demo.localhost:3000`.
-- Passwords are hashed with pgcrypto's `crypt(..., gen_salt('bf'))`.
--
-- Reporting chain (per rules §4):
--   EMPLOYEE  → SUPERVISOR → PROJECT_MANAGER → OPERATIONS_MANAGER
--             → HEAD_MANAGER → GENERAL_MANAGER → TENANT_ADMIN
--   LEAD_FINANCE, HR_ADMIN, PETTY_CASH_CUSTODIAN report to TENANT_ADMIN.

-- ---------------------------------------------------------------------------
-- 0. Idempotency: wipe demo tenant + its users first so seeding is re-runnable.
-- ---------------------------------------------------------------------------
do $$
declare
  demo_tenant_id uuid;
begin
  select id into demo_tenant_id from public.tenants where slug = 'demo';
  if demo_tenant_id is not null then
    delete from auth.users
      where id in (select user_id from public.employees where tenant_id = demo_tenant_id);
    delete from public.tenants where id = demo_tenant_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Demo tenant.
-- ---------------------------------------------------------------------------
insert into public.tenants (id, slug, name)
values ('11111111-1111-1111-1111-111111111111', 'demo', 'ControlDesk Demo BPO');

-- ---------------------------------------------------------------------------
-- 2. Helper: create a confirmed auth user + return its id.
-- ---------------------------------------------------------------------------
create or replace function public._seed_user(p_email text, p_password text, p_name text)
returns uuid
language plpgsql
as $$
declare
  new_user_id uuid := gen_random_uuid();
begin
  -- GoTrue's Go driver scans several *_token columns as `string` (not
  -- `sql.NullString`), so a NULL default here breaks login with
  -- `converting NULL to string is unsupported`. Force empty strings on
  -- every token/challenge column we don't set explicitly.
  insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    is_super_admin,
    is_anonymous,
    confirmation_token,
    email_change_token_new,
    email_change_token_current,
    email_change,
    recovery_token,
    phone_change_token,
    phone_change,
    reauthentication_token
  ) values (
    new_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    p_email,
    crypt(p_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_name),
    now(),
    now(),
    false,
    false,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    ''
  );

  insert into auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) values (
    gen_random_uuid(),
    new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', p_email),
    'email',
    p_email,
    now(),
    now(),
    now()
  );

  return new_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Seed users + employees.
-- ---------------------------------------------------------------------------
do $$
declare
  tenant_id constant uuid := '11111111-1111-1111-1111-111111111111';
  pw        constant text := 'ControlDesk#2026';

  admin_uid uuid;  admin_eid uuid := gen_random_uuid();
  gm_uid uuid;     gm_eid uuid := gen_random_uuid();
  hm_uid uuid;     hm_eid uuid := gen_random_uuid();
  om_uid uuid;     om_eid uuid := gen_random_uuid();
  pm_uid uuid;     pm_eid uuid := gen_random_uuid();
  pm2_uid uuid;    pm2_eid uuid := gen_random_uuid();
  sup_uid uuid;    sup_eid uuid := gen_random_uuid();
  emp_uid uuid;    emp_eid uuid := gen_random_uuid();
  fin_uid uuid;    fin_eid uuid := gen_random_uuid();
  hr_uid uuid;     hr_eid uuid := gen_random_uuid();
  pcc_uid uuid;    pcc_eid uuid := gen_random_uuid();
begin
  admin_uid := public._seed_user('admin@demo.controldesk.app',    pw, 'Ayu Admin');
  gm_uid    := public._seed_user('gm@demo.controldesk.app',       pw, 'Gita General');
  hm_uid    := public._seed_user('hm@demo.controldesk.app',       pw, 'Hendra Head');
  om_uid    := public._seed_user('om@demo.controldesk.app',       pw, 'Omar Operations');
  pm_uid    := public._seed_user('pm@demo.controldesk.app',       pw, 'Putri PM');
  pm2_uid   := public._seed_user('pm2@demo.controldesk.app',      pw, 'Prima PM2');
  sup_uid   := public._seed_user('supervisor@demo.controldesk.app', pw, 'Sinta Supervisor');
  emp_uid   := public._seed_user('employee@demo.controldesk.app', pw, 'Eko Employee');
  fin_uid   := public._seed_user('finance@demo.controldesk.app',  pw, 'Fajar Finance');
  hr_uid    := public._seed_user('hr@demo.controldesk.app',       pw, 'Hana HR');
  pcc_uid   := public._seed_user('pettycash@demo.controldesk.app',pw, 'Pandu Petty');

  -- top of chain
  insert into public.employees (id, tenant_id, user_id, role, reports_to_employee_id, full_name, email)
    values (admin_eid, tenant_id, admin_uid, 'TENANT_ADMIN',       null,       'Ayu Admin',        'admin@demo.controldesk.app');

  insert into public.employees (id, tenant_id, user_id, role, reports_to_employee_id, full_name, email)
    values (gm_eid,    tenant_id, gm_uid,    'GENERAL_MANAGER',    admin_eid,  'Gita General',     'gm@demo.controldesk.app');

  insert into public.employees (id, tenant_id, user_id, role, reports_to_employee_id, full_name, email)
    values (hm_eid,    tenant_id, hm_uid,    'HEAD_MANAGER',       gm_eid,     'Hendra Head',      'hm@demo.controldesk.app');

  insert into public.employees (id, tenant_id, user_id, role, reports_to_employee_id, full_name, email)
    values (om_eid,    tenant_id, om_uid,    'OPERATIONS_MANAGER', hm_eid,     'Omar Operations',  'om@demo.controldesk.app');

  insert into public.employees (id, tenant_id, user_id, role, reports_to_employee_id, full_name, email)
    values (pm_eid,    tenant_id, pm_uid,    'PROJECT_MANAGER',    om_eid,     'Putri PM',         'pm@demo.controldesk.app');

  insert into public.employees (id, tenant_id, user_id, role, reports_to_employee_id, full_name, email)
    values (pm2_eid,   tenant_id, pm2_uid,   'PROJECT_MANAGER',    om_eid,     'Prima PM2',        'pm2@demo.controldesk.app');

  insert into public.employees (id, tenant_id, user_id, role, reports_to_employee_id, full_name, email)
    values (sup_eid,   tenant_id, sup_uid,   'SUPERVISOR',         pm_eid,     'Sinta Supervisor', 'supervisor@demo.controldesk.app');

  insert into public.employees (id, tenant_id, user_id, role, reports_to_employee_id, full_name, email)
    values (emp_eid,   tenant_id, emp_uid,   'EMPLOYEE',           sup_eid,    'Eko Employee',     'employee@demo.controldesk.app');

  -- staff functions all report to the TENANT_ADMIN
  insert into public.employees (id, tenant_id, user_id, role, reports_to_employee_id, full_name, email)
    values (fin_eid,   tenant_id, fin_uid,   'LEAD_FINANCE',           admin_eid, 'Fajar Finance',   'finance@demo.controldesk.app');

  insert into public.employees (id, tenant_id, user_id, role, reports_to_employee_id, full_name, email)
    values (hr_eid,    tenant_id, hr_uid,    'HR_ADMIN',               admin_eid, 'Hana HR',         'hr@demo.controldesk.app');

  insert into public.employees (id, tenant_id, user_id, role, reports_to_employee_id, full_name, email)
    values (pcc_eid,   tenant_id, pcc_uid,   'PETTY_CASH_CUSTODIAN',   admin_eid, 'Pandu Petty',     'pettycash@demo.controldesk.app');
end $$;

-- ---------------------------------------------------------------------------
-- 4. Demo clients, contracts, projects, assignments, and budgets.
-- ---------------------------------------------------------------------------
do $$
#variable_conflict use_variable
declare
  tenant_id constant uuid := '11111111-1111-1111-1111-111111111111';

  -- Client ids
  client_nusa_id     constant uuid := '22222222-1111-4111-8111-111111111111';
  client_indo_id     constant uuid := '22222222-1111-4111-8111-222222222222';
  client_kirana_id   constant uuid := '22222222-1111-4111-8111-333333333333';

  -- Project ids
  proj_nusa_cs_id    constant uuid := '33333333-1111-4111-8111-111111111111';
  proj_nusa_bo_id    constant uuid := '33333333-1111-4111-8111-222222222222';
  proj_indo_helpdesk_id constant uuid := '33333333-1111-4111-8111-333333333333';
  proj_kirana_data_id   constant uuid := '33333333-1111-4111-8111-444444444444';

  pm_eid uuid;
  om_eid uuid;
  sup_eid uuid;
  emp_eid uuid;
  fin_eid uuid;
begin
  -- Look up seeded employees by role (each role has exactly one demo user).
  -- The `#variable_conflict use_variable` directive above makes bare `tenant_id`
  -- resolve to the PL/pgSQL variable, so we qualify the column with e.tenant_id.
  select id into pm_eid  from public.employees e where e.tenant_id = tenant_id and e.role = 'PROJECT_MANAGER'    limit 1;
  select id into om_eid  from public.employees e where e.tenant_id = tenant_id and e.role = 'OPERATIONS_MANAGER' limit 1;
  select id into sup_eid from public.employees e where e.tenant_id = tenant_id and e.role = 'SUPERVISOR'         limit 1;
  select id into emp_eid from public.employees e where e.tenant_id = tenant_id and e.role = 'EMPLOYEE'           limit 1;
  select id into fin_eid from public.employees e where e.tenant_id = tenant_id and e.role = 'LEAD_FINANCE'       limit 1;

  -- Clients (rules §6).
  insert into public.clients (id, tenant_id, name, industry, contact_name, contact_email, contact_phone, status, notes, onboarded_at)
  values
    (client_nusa_id,   tenant_id, 'PT Nusa Digital', 'Perbankan', 'Rina Wibowo', 'rina@nusadigital.co.id', '+62 811 234 5001', 'ACTIVE',
     'Klien anchor – multi-tahun. Fokus ke customer service outsourcing.', now() - interval '400 days'),
    (client_indo_id,   tenant_id, 'PT Indo Retail Ceria', 'Retail', 'Sandi Pratama', 'sandi@indoretail.co.id', '+62 812 345 5002', 'ACTIVE',
     'Kontrak call-center L1 + L2, jam kerja 24/7.', now() - interval '210 days'),
    (client_kirana_id, tenant_id, 'PT Kirana Fintech', 'Fintech', 'Larasati N.', 'ops@kirana.id', '+62 813 456 5003', 'PROSPECT',
     'Dalam tahap negosiasi kontrak data-annotation.', now() - interval '30 days');

  -- BPO contracts (rules §5).
  insert into public.bpo_contracts (tenant_id, client_id, contract_number, mrr_amount, currency, start_date, end_date, status, notes)
  values
    (tenant_id, client_nusa_id, 'NUSA-2025-001', 185000000, 'IDR', current_date - interval '400 days', current_date + interval '190 days',
     'ACTIVE', '30 seat CS + supervisor + team lead.'),
    (tenant_id, client_nusa_id, 'NUSA-2025-002', 92000000,  'IDR', current_date - interval '90 days',  current_date + interval '275 days',
     'ACTIVE', '15 seat back-office (data verification).'),
    (tenant_id, client_indo_id, 'INDO-2025-004', 128000000, 'IDR', current_date - interval '210 days', current_date + interval '155 days',
     'ACTIVE', '24/7 helpdesk – 3 shift.'),
    (tenant_id, client_kirana_id, 'KIRA-2026-DRAFT', 40000000, 'IDR', current_date + interval '15 days', null,
     'DRAFT', 'Pending sign-off.');

  -- Projects (rules §7) — with GAS-aligned project_type + project_number.
  -- NUSA-CS and INDO-HELP are RETAINER (monthly MRR); NUSA-BO is TIME_MATERIAL
  -- (billed on timesheet hours); KIRA-DA is FIXED_PRICE pilot with milestones.
  insert into public.projects (id, tenant_id, client_id, code, name, description, status, project_type, project_number, start_date, end_date)
  values
    (proj_nusa_cs_id,       tenant_id, client_nusa_id,   'NUSA-CS',   'Nusa Customer Service Ops',       '30 seat customer service, SLA 90% AHT < 6 menit.',              'ACTIVE',   'RETAINER',      'PRJ-2025-0001', current_date - interval '400 days', current_date + interval '190 days'),
    (proj_nusa_bo_id,       tenant_id, client_nusa_id,   'NUSA-BO',   'Nusa Back-Office Verification',   '15 seat back-office, SLA 4-jam turnaround.',                    'ACTIVE',   'TIME_MATERIAL', 'PRJ-2026-0002', current_date - interval '90 days',  current_date + interval '275 days'),
    (proj_indo_helpdesk_id, tenant_id, client_indo_id,   'INDO-HELP', 'Indo Retail 24/7 Helpdesk',       'Call center L1/L2 24/7 dengan on-call escalation ke L3.',       'ACTIVE',   'RETAINER',      'PRJ-2025-0003', current_date - interval '210 days', current_date + interval '155 days'),
    (proj_kirana_data_id,   tenant_id, client_kirana_id, 'KIRA-DA',   'Kirana Data Annotation Pilot',    'Pilot 3 bulan data annotation untuk model risk-scoring.',       'PLANNING', 'FIXED_PRICE',   'PRJ-2026-0004', current_date + interval '20 days',  current_date + interval '110 days');

  -- Milestones for the FIXED_PRICE pilot — weight_bps must sum to 10000 (100%).
  -- Discovery is DONE, Design IN_PROGRESS, Delivery + UAT still PLANNED.
  -- The `refresh_project_progress` trigger will fold this into projects.progress.
  insert into public.project_milestones
    (tenant_id, project_id, seq, name, description, weight_bps, planned_start_date, planned_end_date, actual_start_date, actual_end_date, status, owner_employee_id, created_by)
  values
    (tenant_id, proj_kirana_data_id, 1, 'Discovery & SOW sign-off',
     'Finalize scope, dataset access, SLA. Deliverable: signed SOW + kickoff deck.',
     1500, current_date + interval '20 days', current_date + interval '30 days',
     current_date - interval '5 days', current_date + interval '2 days',
     'DONE', pm_eid, pm_eid),
    (tenant_id, proj_kirana_data_id, 2, 'Labelling schema + pilot batch',
     'Define annotation guideline + 500-row pilot batch reviewed by QA.',
     2500, current_date + interval '30 days', current_date + interval '55 days',
     current_date + interval '3 days', null,
     'IN_PROGRESS', pm_eid, pm_eid),
    (tenant_id, proj_kirana_data_id, 3, 'Full production run',
     '10k rows annotated with double-review + IAA (inter-annotator agreement) ≥ 0.85.',
     4000, current_date + interval '55 days', current_date + interval '95 days',
     null, null,
     'PLANNED', pm_eid, pm_eid),
    (tenant_id, proj_kirana_data_id, 4, 'UAT + handover',
     'Client UAT on 500 sample rows + technical handover session.',
     2000, current_date + interval '95 days', current_date + interval '110 days',
     null, null,
     'PLANNED', pm_eid, pm_eid);

  -- NUSA-CS also gets a small milestone plan so the executive dashboard has
  -- non-zero progress on a live RETAINER project.
  insert into public.project_milestones
    (tenant_id, project_id, seq, name, description, weight_bps, planned_start_date, planned_end_date, actual_start_date, actual_end_date, status, owner_employee_id, created_by)
  values
    (tenant_id, proj_nusa_cs_id, 1, 'Q1 Quarterly Business Review',
     'Quarterly business review with client. Deliverable: signed QBR report covering uptime, response time & CSAT metrics.',
     2500, current_date - interval '400 days', current_date - interval '310 days',
     current_date - interval '400 days', current_date - interval '312 days',
     'DONE', pm_eid, pm_eid),
    (tenant_id, proj_nusa_cs_id, 2, 'Q2 Quarterly Business Review',
     'Quarterly business review with client. Deliverable: signed QBR report covering uptime, response time & CSAT metrics.',
     2500, current_date - interval '310 days', current_date - interval '220 days',
     current_date - interval '310 days', current_date - interval '218 days',
     'DONE', pm_eid, pm_eid),
    (tenant_id, proj_nusa_cs_id, 3, 'Q3 Quarterly Business Review',
     'Quarterly business review with client. Deliverable: signed QBR report covering uptime, response time & CSAT metrics.',
     2500, current_date - interval '220 days', current_date - interval '130 days',
     current_date - interval '220 days', current_date - interval '128 days',
     'DONE', pm_eid, pm_eid),
    (tenant_id, proj_nusa_cs_id, 4, 'Q4 Quarterly Business Review',
     'Quarterly business review with client. Deliverable: signed QBR report covering uptime, response time & CSAT metrics.',
     2500, current_date - interval '130 days', current_date - interval '40 days',
     null, null,
     'AT_RISK', pm_eid, pm_eid);

  -- Project budgets (rules §7/§9).
  insert into public.project_budgets (tenant_id, project_id, budget_amount, spent_amount, currency)
  values
    (tenant_id, proj_nusa_cs_id,   1200000000, 875000000, 'IDR'),
    (tenant_id, proj_nusa_bo_id,   540000000,  145000000, 'IDR'),
    (tenant_id, proj_indo_helpdesk_id, 950000000, 612000000, 'IDR'),
    (tenant_id, proj_kirana_data_id,   180000000, 0, 'IDR');

  -- PM assignments (rules §5). Single PRIMARY_PM per project (uniqueness enforced).
  if pm_eid is not null then
    insert into public.project_pm_assignments (tenant_id, project_id, pm_employee_id, assignment_role, status, created_by)
    values
      (tenant_id, proj_nusa_cs_id,       pm_eid, 'PRIMARY_PM', 'ACTIVE', om_eid),
      (tenant_id, proj_nusa_bo_id,       pm_eid, 'PRIMARY_PM', 'ACTIVE', om_eid),
      (tenant_id, proj_indo_helpdesk_id, pm_eid, 'PRIMARY_PM', 'ACTIVE', om_eid),
      (tenant_id, proj_kirana_data_id,   pm_eid, 'PRIMARY_PM', 'ACTIVE', om_eid);
  end if;

  -- Employee assignments (rules §7). Total ≤100% enforced by trigger.
  --
  -- Assignment roles carry semantic meaning:
  --   - SITE_SUPERVISOR on Sinta   → she is the L2 approver for Field-Ops
  --     cash advances on her assigned projects (migration 0048's
  --     resolve_field_ops_l2_approver preference order).
  --   - FIELD_TECHNICIAN on Eko    → he unlocks the "Pengajuan Operasional"
  --     button (has_active_field_tech_assignment returns TRUE).
  if sup_eid is not null and emp_eid is not null then
    insert into public.project_employee_assignments (tenant_id, project_id, employee_id, role, allocation_percentage, status, created_by)
    values
      -- Supervisor: 60% Nusa CS + 40% Indo Helpdesk = 100%
      (tenant_id, proj_nusa_cs_id,       sup_eid, 'SITE_SUPERVISOR',  60, 'ACTIVE', pm_eid),
      (tenant_id, proj_indo_helpdesk_id, sup_eid, 'SITE_SUPERVISOR',  40, 'ACTIVE', pm_eid),
      -- Employee: 80% Nusa CS + 20% Nusa BO = 100%
      (tenant_id, proj_nusa_cs_id, emp_eid, 'FIELD_TECHNICIAN', 80, 'ACTIVE', pm_eid),
      (tenant_id, proj_nusa_bo_id, emp_eid, 'FIELD_TECHNICIAN', 20, 'ACTIVE', pm_eid);
  end if;

  -- Sample expenses to demonstrate the state machine + approval inbox.
  if emp_eid is not null and sup_eid is not null and pm_eid is not null then
    -- 1. A brand-new pending expense sitting at L1 (visible in Supervisor inbox).
    insert into public.project_expenses (id, tenant_id, project_id, submitter_employee_id, amount, category, description, incurred_on, status)
    values
      ('44444444-1111-4111-8111-111111111111', tenant_id, proj_nusa_cs_id, emp_eid, 1250000,  'ONSITE_MEAL', 'Konsumsi tim overnight cutover Sabtu', current_date - interval '2 days', 'PENDING_L1_SUPERVISOR');

    insert into public.expense_approval_logs (tenant_id, expense_id, actor_employee_id, actor_role, action, from_status, to_status)
    values
      (tenant_id, '44444444-1111-4111-8111-111111111111', emp_eid, 'EMPLOYEE', 'SUBMIT', 'DRAFT', 'PENDING_L1_SUPERVISOR');

    -- 2. An expense at L2.5 (finance gate) — visible in Lead Finance inbox.
    insert into public.project_expenses (id, tenant_id, project_id, submitter_employee_id, amount, category, description, incurred_on, status)
    values
      ('44444444-1111-4111-8111-222222222222', tenant_id, proj_indo_helpdesk_id, emp_eid, 3400000, 'IT_SUPPLIES', 'Headset gaming 20 unit untuk agen shift malam', current_date - interval '6 days', 'PENDING_L2_5_FINANCE');

    insert into public.expense_approval_logs (tenant_id, expense_id, actor_employee_id, actor_role, action, from_status, to_status, comment) values
      (tenant_id, '44444444-1111-4111-8111-222222222222', emp_eid, 'EMPLOYEE',        'SUBMIT',  'DRAFT',                     'PENDING_L1_SUPERVISOR', null),
      (tenant_id, '44444444-1111-4111-8111-222222222222', sup_eid, 'SUPERVISOR',      'APPROVE', 'PENDING_L1_SUPERVISOR',    'PENDING_L2_PROJECT_MANAGER', 'Sesuai kebutuhan lapangan.'),
      (tenant_id, '44444444-1111-4111-8111-222222222222', pm_eid,  'PROJECT_MANAGER', 'APPROVE', 'PENDING_L2_PROJECT_MANAGER','PENDING_L2_5_FINANCE',       'Sudah cek scope proyek.');

    -- 3. An already-approved expense (finalized).
    insert into public.project_expenses (id, tenant_id, project_id, submitter_employee_id, amount, category, description, incurred_on, status, finance_approved_at, finance_approver_id, final_approved_at, final_approver_id)
    values
      ('44444444-1111-4111-8111-333333333333', tenant_id, proj_nusa_cs_id, emp_eid, 890000, 'TRAVEL', 'Grab meeting onsite kantor klien', current_date - interval '18 days', 'APPROVED', now() - interval '10 days', fin_eid, now() - interval '10 days', fin_eid);

    insert into public.expense_approval_logs (tenant_id, expense_id, actor_employee_id, actor_role, action, from_status, to_status) values
      (tenant_id, '44444444-1111-4111-8111-333333333333', emp_eid, 'EMPLOYEE',        'SUBMIT',           'DRAFT',                        'PENDING_L1_SUPERVISOR'),
      (tenant_id, '44444444-1111-4111-8111-333333333333', sup_eid, 'SUPERVISOR',      'APPROVE',          'PENDING_L1_SUPERVISOR',       'PENDING_L2_PROJECT_MANAGER'),
      (tenant_id, '44444444-1111-4111-8111-333333333333', pm_eid,  'PROJECT_MANAGER', 'APPROVE',          'PENDING_L2_PROJECT_MANAGER',  'PENDING_L2_5_FINANCE'),
      (tenant_id, '44444444-1111-4111-8111-333333333333', fin_eid, 'LEAD_FINANCE',    'FINANCE_APPROVE',  'PENDING_L2_5_FINANCE',        'APPROVED');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Demo HRIS requests (rules §12).
-- ---------------------------------------------------------------------------
do $$
#variable_conflict use_variable
declare
  tenant_id constant uuid := '11111111-1111-1111-1111-111111111111';
  proj_nusa_cs_id constant uuid := '33333333-1111-4111-8111-111111111111';
  emp_eid uuid;
  sup_eid uuid;
  pm_eid uuid;
  hr_eid uuid;
begin
  select id into emp_eid from public.employees e where e.tenant_id = tenant_id and e.role = 'EMPLOYEE'    limit 1;
  select id into sup_eid from public.employees e where e.tenant_id = tenant_id and e.role = 'SUPERVISOR'  limit 1;
  select id into pm_eid  from public.employees e where e.tenant_id = tenant_id and e.role = 'PROJECT_MANAGER' limit 1;
  select id into hr_eid  from public.employees e where e.tenant_id = tenant_id and e.role = 'HR_ADMIN'    limit 1;

  if emp_eid is null or sup_eid is null then return; end if;

  -- HR-1: LEAVE at Supervisor gate (pending L1)
  insert into public.hr_requests (id, tenant_id, requester_employee_id, kind, project_id, leave_type, start_at, end_at, reason, status)
  values ('55555555-1111-4111-8111-111111111111', tenant_id, emp_eid, 'LEAVE', proj_nusa_cs_id, 'ANNUAL',
          (now() + interval '10 days')::timestamptz, (now() + interval '12 days')::timestamptz,
          'Cuti tahunan – acara keluarga di Bandung.', 'PENDING_L1_SUPERVISOR');
  insert into public.hr_approval_logs (tenant_id, request_id, actor_employee_id, actor_role, action, from_status, to_status)
  values (tenant_id, '55555555-1111-4111-8111-111111111111', emp_eid, 'EMPLOYEE', 'SUBMIT', 'DRAFT', 'PENDING_L1_SUPERVISOR');

  -- HR-2: OVERTIME at PM gate (already approved by supervisor)
  insert into public.hr_requests (id, tenant_id, requester_employee_id, kind, project_id, hours_estimate, start_at, end_at, reason, status)
  values ('55555555-1111-4111-8111-222222222222', tenant_id, emp_eid, 'OVERTIME', proj_nusa_cs_id, 4,
          (now() - interval '1 day')::timestamptz, (now() - interval '20 hours')::timestamptz,
          'Support cutover incident klien Nusa.', 'PENDING_L2_PROJECT_MANAGER');
  insert into public.hr_approval_logs (tenant_id, request_id, actor_employee_id, actor_role, action, from_status, to_status, comment) values
    (tenant_id, '55555555-1111-4111-8111-222222222222', emp_eid, 'EMPLOYEE',    'SUBMIT',  'DRAFT',                   'PENDING_L1_SUPERVISOR', null),
    (tenant_id, '55555555-1111-4111-8111-222222222222', sup_eid, 'SUPERVISOR',  'APPROVE', 'PENDING_L1_SUPERVISOR',   'PENDING_L2_PROJECT_MANAGER', 'Konfirmasi lembur.');

  -- HR-3: SICK at HR gate (already through supervisor)
  insert into public.hr_requests (id, tenant_id, requester_employee_id, kind, project_id, start_at, end_at, reason, attachment_url, status)
  values ('55555555-1111-4111-8111-333333333333', tenant_id, emp_eid, 'SICK', proj_nusa_cs_id,
          (now() - interval '2 days')::timestamptz, (now() - interval '1 day')::timestamptz,
          'Demam & flu, sesuai surat dokter.', 'https://example.com/surat-dokter.pdf', 'PENDING_HR_ADMIN');
  insert into public.hr_approval_logs (tenant_id, request_id, actor_employee_id, actor_role, action, from_status, to_status, comment) values
    (tenant_id, '55555555-1111-4111-8111-333333333333', emp_eid, 'EMPLOYEE',   'SUBMIT',  'DRAFT',                    'PENDING_L1_SUPERVISOR', null),
    (tenant_id, '55555555-1111-4111-8111-333333333333', sup_eid, 'SUPERVISOR', 'APPROVE', 'PENDING_L1_SUPERVISOR',    'PENDING_HR_ADMIN', 'Surat dokter valid.');
end $$;

-- ---------------------------------------------------------------------------
-- 6. Demo Cash Advances (rules §11).
-- ---------------------------------------------------------------------------
do $$
#variable_conflict use_variable
declare
  tenant_id constant uuid := '11111111-1111-1111-1111-111111111111';
  proj_nusa_cs_id constant uuid := '33333333-1111-4111-8111-111111111111';
  proj_indo_helpdesk_id constant uuid := '33333333-1111-4111-8111-333333333333';
  emp_eid uuid;
  sup_eid uuid;
  pm_eid uuid;
  fin_eid uuid;
begin
  select id into emp_eid from public.employees e where e.tenant_id = tenant_id and e.role = 'EMPLOYEE'         limit 1;
  select id into sup_eid from public.employees e where e.tenant_id = tenant_id and e.role = 'SUPERVISOR'       limit 1;
  select id into pm_eid  from public.employees e where e.tenant_id = tenant_id and e.role = 'PROJECT_MANAGER'  limit 1;
  select id into fin_eid from public.employees e where e.tenant_id = tenant_id and e.role = 'LEAD_FINANCE'     limit 1;

  if emp_eid is null then return; end if;

  -- CA-1: PENDING at L1 Supervisor (small amount).
  insert into public.cash_advances (id, tenant_id, project_id, requester_employee_id, amount, purpose, needed_by, status)
  values ('66666666-1111-4111-8111-111111111111', tenant_id, proj_nusa_cs_id, emp_eid, 1500000,
          'Uang muka onsite visit klien Nusa selama 3 hari.', current_date + interval '4 days', 'PENDING_L1_SUPERVISOR');
  insert into public.cash_advance_approval_logs (tenant_id, cash_advance_id, actor_employee_id, actor_role, action, from_status, to_status)
  values (tenant_id, '66666666-1111-4111-8111-111111111111', emp_eid, 'EMPLOYEE', 'SUBMIT', 'DRAFT', 'PENDING_L1_SUPERVISOR');

  -- CA-2: DISBURSED (waiting settlement).
  insert into public.cash_advances (id, tenant_id, project_id, requester_employee_id, amount, purpose, needed_by, status, finance_approved_at, finance_approver_id, final_approved_at, final_approver_id, disbursed_at, disbursed_by, disbursement_ref)
  values ('66666666-1111-4111-8111-222222222222', tenant_id, proj_indo_helpdesk_id, emp_eid, 4200000,
          'Uang muka pembelian headset & perlengkapan shift malam.',
          current_date - interval '2 days', 'DISBURSED',
          now() - interval '4 days', fin_eid, now() - interval '4 days', fin_eid,
          now() - interval '3 days', fin_eid, 'BCA-TRX-20260801-001');
  insert into public.cash_advance_approval_logs (tenant_id, cash_advance_id, actor_employee_id, actor_role, action, from_status, to_status, comment) values
    (tenant_id, '66666666-1111-4111-8111-222222222222', emp_eid, 'EMPLOYEE',        'SUBMIT',          'DRAFT',                        'PENDING_L1_SUPERVISOR', null),
    (tenant_id, '66666666-1111-4111-8111-222222222222', sup_eid, 'SUPERVISOR',      'APPROVE',         'PENDING_L1_SUPERVISOR',        'PENDING_L2_PROJECT_MANAGER', null),
    (tenant_id, '66666666-1111-4111-8111-222222222222', pm_eid,  'PROJECT_MANAGER', 'APPROVE',         'PENDING_L2_PROJECT_MANAGER',   'PENDING_L2_5_FINANCE', null),
    (tenant_id, '66666666-1111-4111-8111-222222222222', fin_eid, 'LEAD_FINANCE',    'FINANCE_APPROVE', 'PENDING_L2_5_FINANCE',         'APPROVED', 'OK cashflow.'),
    -- Disbursement is logged via APPROVE + to_status DISBURSED — the app's
    -- disburseCashAdvanceAction emits this exact shape; the DISBURSE verb
    -- itself lives on security_audit_logs.action_type, not approval_action.
    (tenant_id, '66666666-1111-4111-8111-222222222222', fin_eid, 'LEAD_FINANCE',    'APPROVE',         'APPROVED',                     'DISBURSED', 'Disbursed · ref BCA-TRX-20260801-001.');
end $$;

-- ---------------------------------------------------------------------------
-- 7. Demo Petty Cash (rules §10).
-- ---------------------------------------------------------------------------
do $$
#variable_conflict use_variable
declare
  tenant_id constant uuid := '11111111-1111-1111-1111-111111111111';
  fund_id  constant uuid := '77777777-1111-4111-8111-111111111111';
  pcc_eid uuid;
  emp_eid uuid;
begin
  select id into pcc_eid from public.employees e where e.tenant_id = tenant_id and e.role = 'PETTY_CASH_CUSTODIAN' limit 1;
  select id into emp_eid from public.employees e where e.tenant_id = tenant_id and e.role = 'EMPLOYEE'             limit 1;

  if pcc_eid is null then return; end if;

  -- Balance starts at the imprest ceiling; the pcv_apply_balance trigger
  -- will debit each voucher below.
  insert into public.petty_cash_funds (id, tenant_id, location_name, custodian_employee_id, imprest_amount, balance, min_balance, is_active)
  values (fund_id, tenant_id, 'Jakarta HQ – Lantai 8', pcc_eid, 5000000, 5000000, 1000000, true);

  insert into public.petty_cash_vouchers (tenant_id, fund_id, created_by, amount, category, description, incurred_on, status)
  values
    (tenant_id, fund_id, pcc_eid, 275000, 'REFRESHMENT', 'Konsumsi meeting klien Nusa', current_date - interval '3 days', 'RECORDED'),
    (tenant_id, fund_id, pcc_eid, 450000, 'TRANSPORT',   'Grab office → kantor klien Indo', current_date - interval '2 days', 'RECORDED'),
    (tenant_id, fund_id, pcc_eid, 150000, 'PARKING',     'Parkir mingguan tim ops', current_date - interval '1 day', 'RECORDED'),
    (tenant_id, fund_id, pcc_eid, 900000, 'SUPPLIES',    'ATK tim CS batch Juli', current_date - interval '5 days', 'RECORDED');

  -- suppress unused variable warning for emp_eid
  perform emp_eid;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Demo PM Handover (rules §13).
-- ---------------------------------------------------------------------------
do $$
#variable_conflict use_variable
declare
  tenant_id constant uuid := '11111111-1111-1111-1111-111111111111';
  proj_kirana_data_id constant uuid := '33333333-1111-4111-8111-444444444444';
  handover_id constant uuid := '88888888-1111-4111-8111-111111111111';
  om_eid uuid;
  pm_eid uuid;
  pm2_eid uuid;
begin
  select id into om_eid  from public.employees e
    where e.tenant_id = tenant_id and e.role = 'OPERATIONS_MANAGER' limit 1;
  select id into pm_eid  from public.employees e
    where e.tenant_id = tenant_id and e.email = 'pm@demo.controldesk.app'  limit 1;
  select id into pm2_eid from public.employees e
    where e.tenant_id = tenant_id and e.email = 'pm2@demo.controldesk.app' limit 1;

  if om_eid is null or pm_eid is null or pm2_eid is null then return; end if;

  -- One pending PM handover (PENDING_OM) on the Kirana pilot project,
  -- initiated by OM, awaiting his own approval.
  insert into public.pm_handovers
    (id, tenant_id, project_id, from_pm_employee_id, to_pm_employee_id,
     effective_at, reason, handover_notes, initiated_by, status)
  values
    (handover_id, tenant_id, proj_kirana_data_id, pm_eid, pm2_eid,
     now() + interval '3 days',
     'Rotasi PM triwulan — Putri diarahkan ke ekspansi klien baru.',
     'Kirana pilot masih fase planning. Open items: (1) sign-off SOW, (2) shortlist 6 annotator.',
     om_eid, 'PENDING_OM');

  insert into public.pm_handover_audit_logs
    (tenant_id, handover_id, actor_employee_id, actor_role,
     action, from_status, to_status, comment)
  values
    (tenant_id, handover_id, om_eid, 'OPERATIONS_MANAGER',
     'SUBMIT', 'DRAFT', 'PENDING_OM',
     'Handover diajukan untuk rotasi PM triwulan.');
end $$;

-- ---------------------------------------------------------------------------
-- 9. Demo shifts + rosters + timesheets (rules §12/§14).
-- ---------------------------------------------------------------------------
do $$
#variable_conflict use_variable
declare
  tenant_id constant uuid := '11111111-1111-1111-1111-111111111111';
  proj_nusa_cs_id constant uuid := '33333333-1111-4111-8111-111111111111';
  proj_indo_helpdesk_id constant uuid := '33333333-1111-4111-8111-333333333333';

  shift_day_id uuid := gen_random_uuid();
  shift_evening_id uuid := gen_random_uuid();
  shift_night_id uuid := gen_random_uuid();

  emp_eid uuid;
  sup_eid uuid;
  pm_eid  uuid;

  today date := current_date;
begin
  select id into emp_eid from public.employees e where e.tenant_id = tenant_id and e.role = 'EMPLOYEE' limit 1;
  select id into sup_eid from public.employees e where e.tenant_id = tenant_id and e.role = 'SUPERVISOR' limit 1;
  select id into pm_eid  from public.employees e where e.tenant_id = tenant_id and e.role = 'PROJECT_MANAGER' limit 1;

  -- Compensation for demo users so payroll produces non-zero numbers.
  update public.employees
    set monthly_salary = 12000000, hourly_rate = 75000
    where id = emp_eid;
  update public.employees
    set monthly_salary = 18000000, hourly_rate = 110000
    where id = sup_eid;
  update public.employees
    set monthly_salary = 32000000, hourly_rate = 200000
    where id = pm_eid;

  -- Standard shifts.
  insert into public.work_shifts (id, tenant_id, code, name, start_time, end_time, duration, shift_allowance, is_night)
  values
    (shift_day_id,     tenant_id, 'DAY',     'Day shift 08–17',    '08:00', '17:00', interval '8 hours', 25000,  false),
    (shift_evening_id, tenant_id, 'EVE',     'Evening shift 15–23','15:00', '23:00', interval '8 hours', 75000,  false),
    (shift_night_id,   tenant_id, 'NIGHT',   'Night shift 23–07',  '23:00', '07:00', interval '8 hours', 150000, true);

  -- Roster: 5 planned days back + today + 2 ahead per employee.
  if emp_eid is not null then
    insert into public.employee_rosters (tenant_id, employee_id, shift_id, project_id, work_date, status, created_by)
    select tenant_id, emp_eid, shift_day_id, proj_nusa_cs_id, today - offs, 'PLANNED', pm_eid
    from generate_series(0, 5) offs
    on conflict do nothing;
  end if;

  if sup_eid is not null then
    insert into public.employee_rosters (tenant_id, employee_id, shift_id, project_id, work_date, status, created_by)
    select tenant_id, sup_eid, shift_evening_id, proj_indo_helpdesk_id, today - offs, 'PLANNED', pm_eid
    from generate_series(0, 5) offs
    on conflict do nothing;
  end if;

  -- Timesheets: APPROVED for past 5 days so payroll aggregates something.
  if emp_eid is not null then
    insert into public.timesheets
      (tenant_id, employee_id, project_id, work_date, hours_worked, hours_overtime, status, submitted_at, approved_at, approved_by, created_by)
    select tenant_id, emp_eid, proj_nusa_cs_id, today - offs, 8, case when offs = 1 then 2 else 0 end,
           'APPROVED', (today - offs)::timestamptz + time '17:30', (today - offs)::timestamptz + time '18:00', sup_eid, emp_eid
    from generate_series(1, 5) offs
    on conflict do nothing;

    -- One pending timesheet in supervisor inbox.
    insert into public.timesheets
      (tenant_id, employee_id, project_id, work_date, hours_worked, hours_overtime, status, submitted_at, created_by)
    values
      (tenant_id, emp_eid, proj_nusa_cs_id, today, 8, 1, 'SUBMITTED', now(), emp_eid)
    on conflict do nothing;
  end if;

  if sup_eid is not null then
    insert into public.timesheets
      (tenant_id, employee_id, project_id, work_date, hours_worked, hours_overtime, status, submitted_at, approved_at, approved_by, created_by)
    select tenant_id, sup_eid, proj_indo_helpdesk_id, today - offs, 8, 0,
           'APPROVED', (today - offs)::timestamptz + time '23:30', (today - offs)::timestamptz + time '23:45', pm_eid, sup_eid
    from generate_series(1, 5) offs
    on conflict do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Demo AI insights (rules §15). Deterministic mock output so /insights
-- has something to render on first load.
-- ---------------------------------------------------------------------------
do $$
#variable_conflict use_variable
declare
  tenant_id constant uuid := '11111111-1111-1111-1111-111111111111';
  admin_eid uuid;
begin
  select id into admin_eid from public.employees e
    where e.tenant_id = tenant_id and e.role = 'TENANT_ADMIN' limit 1;

  insert into public.ai_insights
    (tenant_id, kind, severity, headline, summary, payload,
     prompt_version, model_id, tokens_input, tokens_output, latency_ms, requested_by)
  values
    (tenant_id, 'PREDICT_EXPENSE_IMPACT', 'WARNING',
     'Nusa CS: gross margin trending down',
     'Pending expenses will pull NUSA-CS gross margin from 28% to 21% in the next 14 days.',
     jsonb_build_object(
       'headline','Nusa CS: gross margin trending down',
       'summary','Pending expenses will pull NUSA-CS gross margin from 28% to 21% in the next 14 days.',
       'severity','WARNING','confidence',0.72,
       'project_impacts', jsonb_build_array(
         jsonb_build_object('project_code','NUSA-CS','current_margin_pct',28,'projected_margin_pct',21,
           'top_drivers', jsonb_build_array('Overtime spike','Direct labour cost')),
         jsonb_build_object('project_code','INDO-HELP','current_margin_pct',31,'projected_margin_pct',27,
           'top_drivers', jsonb_build_array('Weekend surge coverage'))
       ),
       'recommended_actions', jsonb_build_array(
         'Escalate NUSA-CS pending expenses > Rp 25 juta to OM.',
         'Reforecast direct labour hours for the next 2 sprints.',
         'Explore billing review with client Nusa.'
       )
     ),
     'v1', 'mock', 0, 0, 0, admin_eid),

    (tenant_id, 'ANALYZE_RESOURCE_UTILIZATION', 'INFO',
     'Utilisation snapshot balanced',
     'Two employees near ceiling. Consider bench cross-training for underutilised staff.',
     jsonb_build_object(
       'headline','Utilisation snapshot balanced',
       'summary','Two employees near ceiling. Consider bench cross-training for underutilised staff.',
       'severity','INFO','confidence',0.65,
       'overallocated', jsonb_build_array(
         jsonb_build_object('employee_ref','aa11bb22','role','SUPERVISOR','total_allocation_pct',100)
       ),
       'underutilized', jsonb_build_array(),
       'pm_load', jsonb_build_array(
         jsonb_build_object('pm_ref','cc33dd44','primary_projects',4,'co_projects',0)
       ),
       'recommended_actions', jsonb_build_array(
         'Rotate one project to PM2 to smooth PM load.',
         'Encourage cross-training for bench employees.'
       )
     ),
     'v1', 'mock', 0, 0, 0, admin_eid),

    (tenant_id, 'ANALYZE_CLIENT_HEALTH', 'INFO',
     'Client health mostly GREEN',
     'PT Nusa Digital + PT Indo Retail scored GREEN. PT Kirana Fintech remains PROSPECT — schedule QBR.',
     jsonb_build_object(
       'headline','Client health mostly GREEN',
       'summary','PT Nusa Digital + PT Indo Retail scored GREEN. PT Kirana Fintech remains PROSPECT — schedule QBR.',
       'severity','INFO','confidence',0.6,
       'clients', jsonb_build_array(
         jsonb_build_object('client_name','PT Nusa Digital','health_score',85,'status','GREEN',
           'signals', jsonb_build_array('2 active projects','MRR bucket >50jt','Contracts ACTIVE')),
         jsonb_build_object('client_name','PT Indo Retail Ceria','health_score',78,'status','GREEN',
           'signals', jsonb_build_array('1 active project','MRR bucket >50jt')),
         jsonb_build_object('client_name','PT Kirana Fintech','health_score',55,'status','AMBER',
           'signals', jsonb_build_array('Prospect stage','Contract DRAFT'))
       ),
       'at_risk_revenue_bucket','50-250jt',
       'recommended_actions', jsonb_build_array(
         'Schedule QBR with PT Kirana Fintech in 2 weeks.',
         'Send NPS pulse to GREEN accounts.',
         'Explore expansion opportunity with Nusa Digital.'
       )
     ),
     'v1', 'mock', 0, 0, 0, admin_eid),

    (tenant_id, 'ANALYZE_SLA_BREACH', 'CRITICAL',
     'SLA breach risk on INDO-HELP within 24h',
     'Weekend coverage gap + backlog growth put INDO-HELP at 65% breach probability.',
     jsonb_build_object(
       'headline','SLA breach risk on INDO-HELP within 24h',
       'summary','Weekend coverage gap + backlog growth put INDO-HELP at 65% breach probability.',
       'severity','CRITICAL','confidence',0.82,
       'breach_forecasts', jsonb_build_array(
         jsonb_build_object('project_code','INDO-HELP','breach_within_hours',18,'breach_probability',0.65,
           'contributing_factors', jsonb_build_array('Weekend coverage gap','Backlog growth','Ticket AHT rising')),
         jsonb_build_object('project_code','NUSA-CS','breach_within_hours',36,'breach_probability',0.35,
           'contributing_factors', jsonb_build_array('Sick leave spike'))
       ),
       'penalty_exposure_bucket','200jt-1M',
       'recommended_actions', jsonb_build_array(
         'Trigger surge coverage tonight for INDO-HELP.',
         'Escalate to Head Manager within 2 hours.',
         'Draft client-facing SLA recovery note.'
       )
     ),
     'v1', 'mock', 0, 0, 0, admin_eid);
end $$;

-- ---------------------------------------------------------------------------
-- 10b. GAS-aligned budget + line items for the FIXED_PRICE pilot (rules §9.2,
-- Fase 0 slice 5). Demonstrates the `budgets` header + `budget_details`
-- rollup — total_planned_amount is refreshed by trigger to sum of planned.
-- ---------------------------------------------------------------------------
do $$
#variable_conflict use_variable
declare
  tenant_id constant uuid := '11111111-1111-1111-1111-111111111111';
  proj_kirana_data_id constant uuid := '33333333-1111-4111-8111-444444444444';
  budget_id constant uuid := '99999999-1111-4111-8111-111111111111';
  pm_eid uuid;
  fin_eid uuid;
  -- Chart-of-Accounts (migration 0055) resolved by code, so budget line
  -- items are demoable with real MA codes instead of dashes. Codes must
  -- match the seeded hierarchy exactly.
  coa_5101 uuid; -- Beban Gaji Direct
  coa_5201 uuid; -- Beban Cloud & Hosting
  coa_5202 uuid; -- Beban Software & Lisensi (fallback: 5201 if absent)
  coa_5900 uuid; -- Beban Operasional Lain
begin
  select id into pm_eid  from public.employees e
    where e.tenant_id = tenant_id and e.role = 'PROJECT_MANAGER' limit 1;
  select id into fin_eid from public.employees e
    where e.tenant_id = tenant_id and e.role = 'LEAD_FINANCE' limit 1;

  if pm_eid is null then return; end if;

  select id into coa_5101 from public.chart_of_accounts
    where tenant_id = tenant_id and code = '5101' limit 1;
  select id into coa_5201 from public.chart_of_accounts
    where tenant_id = tenant_id and code = '5201' limit 1;
  select id into coa_5202 from public.chart_of_accounts
    where tenant_id = tenant_id and code = '5202' limit 1;
  select id into coa_5900 from public.chart_of_accounts
    where tenant_id = tenant_id and code = '5900' limit 1;

  insert into public.budgets
    (id, tenant_id, project_id, fiscal_year, title, currency, status,
     notes, created_by, updated_by)
  values
    (budget_id, tenant_id, proj_kirana_data_id, 2026,
     'FY2026 — Kirana Data Annotation Pilot',
     'IDR', 'PENDING_FINANCE',
     'Anggaran pilot 3 bulan; siap review Finance.',
     pm_eid, pm_eid);

  insert into public.budget_details
    (tenant_id, budget_id, seq, category, coa_id, description,
     planned_amount, realized_amount, outstanding_amount, created_by, updated_by)
  values
    (tenant_id, budget_id, 1, 'DIRECT_LABOUR', coa_5101,
     'Annotator + QA hourly wages (10 orang × 3 bulan).',
     120000000, 15000000, 4000000, pm_eid, pm_eid),
    (tenant_id, budget_id, 2, 'INFRASTRUCTURE', coa_5201,
     'Cloud GPU + data lake storage.',
     25000000, 3500000, 0, pm_eid, pm_eid),
    (tenant_id, budget_id, 3, 'TOOLING', coalesce(coa_5202, coa_5201),
     'Annotation platform license + QA suite.',
     18000000, 0, 6000000, pm_eid, pm_eid),
    (tenant_id, budget_id, 4, 'CONTINGENCY', coa_5900,
     '10% buffer atas total direct cost.',
     17000000, 0, 0, pm_eid, pm_eid);

  -- Silence unused-variable warning if we ever want the Finance role in-scope.
  perform fin_eid;
end $$;

-- ---------------------------------------------------------------------------
-- 10c. GAS-aligned project_assignments — showcase the 11-role enum (Fase 0
-- slice 5). Legacy project_pm_assignments + project_employee_assignments
-- remain untouched; this table is what Fase 1+ modules will read.
-- ---------------------------------------------------------------------------
do $$
#variable_conflict use_variable
declare
  tenant_id constant uuid := '11111111-1111-1111-1111-111111111111';
  proj_kirana_data_id constant uuid := '33333333-1111-4111-8111-444444444444';
  proj_indo_helpdesk_id constant uuid := '33333333-1111-4111-8111-333333333333';
  pm_eid  uuid;
  om_eid  uuid;
  sup_eid uuid;
  emp_eid uuid;
begin
  select id into pm_eid  from public.employees e where e.tenant_id = tenant_id and e.role = 'PROJECT_MANAGER'    limit 1;
  select id into om_eid  from public.employees e where e.tenant_id = tenant_id and e.role = 'OPERATIONS_MANAGER' limit 1;
  select id into sup_eid from public.employees e where e.tenant_id = tenant_id and e.role = 'SUPERVISOR'         limit 1;
  select id into emp_eid from public.employees e where e.tenant_id = tenant_id and e.role = 'EMPLOYEE'           limit 1;

  if pm_eid is null or om_eid is null or emp_eid is null then return; end if;

  -- Kirana pilot: PM (Putri) 100%, OM oversight 10%, SITE_SUPERVISOR (Sinta)
  -- 30%, plus one Developer (Eko) at 30%.
  insert into public.project_assignments
    (tenant_id, project_id, employee_id, role, allocation_percentage,
     is_primary, notes, created_by)
  values
    (tenant_id, proj_kirana_data_id, pm_eid,  'PM',              70, true,
     'Primary PM Kirana pilot.', pm_eid),
    (tenant_id, proj_kirana_data_id, om_eid,  'OM',              10, true,
     'Program oversight.', om_eid),
    (tenant_id, proj_kirana_data_id, sup_eid, 'SITE_SUPERVISOR', 30, false,
     'Field ops di lokasi klien.', pm_eid),
    (tenant_id, proj_kirana_data_id, emp_eid, 'DEVELOPER',       20, false,
     'Backend pipeline annotator.', pm_eid);

  -- Indo Helpdesk: PM (Putri) 30%, SUPPORT (Eko) partial. We keep totals
  -- below 100 because legacy project_employee_assignments already booked
  -- 80% of Eko and 60% of Sinta earlier in this seed run.
  insert into public.project_assignments
    (tenant_id, project_id, employee_id, role, allocation_percentage,
     is_primary, notes, created_by)
  values
    (tenant_id, proj_indo_helpdesk_id, pm_eid, 'PM', 30, true,
     'Secondary PM allocation.', pm_eid);
end $$;

-- ---------------------------------------------------------------------------
-- 11. Approval threshold overrides (Fase 0 slice 2 · rules §9).
--
-- Demonstrates per-tenant tuning of the GAS-aligned 3-tier matrix. The demo
-- tenant tightens the Expense PM threshold (Rp 5jt → Rp 3jt) so a supervisor
-- expense of Rp 3.4jt now routes through PM in addition to Finance. Field-ops
-- CA settlement SLA is also tightened (10 → 7 days). Any `kind` without a row
-- here falls back to `APPROVAL_CONFIG` in `src/lib/rbac/roles.ts`.
-- ---------------------------------------------------------------------------
do $$
#variable_conflict use_variable
declare
  tenant_id constant uuid := '11111111-1111-1111-1111-111111111111';
  admin_eid uuid;
begin
  select id into admin_eid from public.employees e
    where e.tenant_id = tenant_id and e.role = 'TENANT_ADMIN' limit 1;

  insert into public.approval_thresholds
    (tenant_id, kind, pm_threshold, director_threshold, notes, created_by, updated_by)
  values
    (tenant_id, 'EXPENSE', 3000000, 50000000,
     'Demo tenant: PM threshold tightened Rp 5jt → Rp 3jt. Director default.',
     admin_eid, admin_eid);

  insert into public.approval_thresholds
    (tenant_id, kind, pm_threshold, om_threshold, director_threshold, settlement_sla_days, notes, created_by, updated_by)
  values
    (tenant_id, 'CASH_ADVANCE_FIELD_OPS', 5000000, 20000000, 50000000, 7,
     'Demo tenant: Field-ops CA settlement SLA tightened 10 → 7 days.',
     admin_eid, admin_eid);
end $$;

-- ---------------------------------------------------------------------------
-- 12. Canonical-role parallel employees (Fase 0 slice 2 · rules §6).
--
-- Two extra demo users using the NEW canonical enum values (`PM`, `DIRECTOR`,
-- `FINANCE`) alongside the legacy Ayu/Putri/Fajar. RLS policies still key off
-- the legacy codes so these canonical users have limited reach — the goal is
-- to prove the enum expansion + `employees_canonical` view + JWT round-trip
-- work end-to-end while the codebase migrates (Slice 4+).
-- ---------------------------------------------------------------------------
do $$
#variable_conflict use_variable
declare
  tenant_id constant uuid := '11111111-1111-1111-1111-111111111111';
  pw        constant text := 'ControlDesk#2026';

  admin_eid uuid;
  canon_pm_uid uuid;       canon_pm_eid uuid := gen_random_uuid();
  canon_dir_uid uuid;      canon_dir_eid uuid := gen_random_uuid();
  canon_fin_uid uuid;      canon_fin_eid uuid := gen_random_uuid();
begin
  select id into admin_eid from public.employees e
    where e.tenant_id = tenant_id and e.role = 'TENANT_ADMIN' limit 1;

  canon_pm_uid  := public._seed_user('pm.canonical@demo.controldesk.app',       pw, 'Prasetya Canonical-PM');
  canon_dir_uid := public._seed_user('director.canonical@demo.controldesk.app', pw, 'Damar Canonical-Director');
  canon_fin_uid := public._seed_user('finance.canonical@demo.controldesk.app', pw, 'Fatia Canonical-Finance');

  insert into public.employees (id, tenant_id, user_id, role, reports_to_employee_id, full_name, email)
    values (canon_dir_eid, tenant_id, canon_dir_uid, 'DIRECTOR', admin_eid,
            'Damar Canonical-Director', 'director.canonical@demo.controldesk.app');

  insert into public.employees (id, tenant_id, user_id, role, reports_to_employee_id, full_name, email)
    values (canon_pm_eid,  tenant_id, canon_pm_uid,  'PM',       canon_dir_eid,
            'Prasetya Canonical-PM',   'pm.canonical@demo.controldesk.app');

  insert into public.employees (id, tenant_id, user_id, role, reports_to_employee_id, full_name, email)
    values (canon_fin_eid, tenant_id, canon_fin_uid, 'FINANCE',  admin_eid,
            'Fatia Canonical-Finance', 'finance.canonical@demo.controldesk.app');
end $$;

-- ---------------------------------------------------------------------------
-- Project Issues (Fase 2, rules §26). One breached CRITICAL, one at-risk
-- HIGH, one healthy MEDIUM per representative project so the dashboard KPI
-- + project-detail Issues card have realistic data on `pnpm db:seed`.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tenant_id uuid;
  v_pm_eid    uuid;
  v_sup_eid   uuid;
  v_emp_eid   uuid;
  v_proj_nusa_cs       uuid;
  v_proj_nusa_bo       uuid;
  v_proj_indo_helpdesk uuid;
begin
  select id into v_tenant_id from public.tenants where slug = 'demo';
  if v_tenant_id is null then
    raise notice 'Skipping project_issues seed — demo tenant missing.';
    return;
  end if;

  select id into v_pm_eid  from public.employees
    where tenant_id = v_tenant_id and role = 'PROJECT_MANAGER'  limit 1;
  select id into v_sup_eid from public.employees
    where tenant_id = v_tenant_id and role = 'SUPERVISOR'       limit 1;
  select id into v_emp_eid from public.employees
    where tenant_id = v_tenant_id and role = 'EMPLOYEE'         limit 1;

  select id into v_proj_nusa_cs       from public.projects
    where tenant_id = v_tenant_id and code = 'NUSA-CS'          limit 1;
  select id into v_proj_nusa_bo       from public.projects
    where tenant_id = v_tenant_id and code = 'NUSA-BO'          limit 1;
  select id into v_proj_indo_helpdesk from public.projects
    where tenant_id = v_tenant_id and code = 'INDO-HELP'        limit 1;

  if v_pm_eid is null or v_sup_eid is null or v_emp_eid is null then
    raise notice 'Skipping project_issues seed — roles missing.';
    return;
  end if;

  -- 1. BREACHED CRITICAL (Nusa CS — dashboard-alerting).
  insert into public.project_issues
    (tenant_id, project_id, reporter_employee_id, assignee_employee_id,
     title, description, severity, status, sla_due_at, created_at, updated_at)
  values
    (v_tenant_id, v_proj_nusa_cs, v_emp_eid, v_sup_eid,
     'Agent dashboard timing out at peak load',
     'From 09:15 WIB the agent dashboard is unresponsive under peak concurrent load. Client already flagged twice.',
     'CRITICAL', 'IN_PROGRESS',
     now() - interval '2 hours',
     now() - interval '4 hours',
     now() - interval '1 hour')
  on conflict do nothing;

  -- 2. AT-RISK HIGH (Indo Helpdesk — countdown < 1h business).
  insert into public.project_issues
    (tenant_id, project_id, reporter_employee_id, assignee_employee_id,
     title, description, severity, status, sla_due_at, created_at, updated_at)
  values
    (v_tenant_id, v_proj_indo_helpdesk, v_sup_eid, v_pm_eid,
     'Ticket routing rule dropped urgent tag',
     'Since deploy last night, tickets tagged URGENT are routed to Level-1 instead of Level-2.',
     'HIGH', 'OPEN',
     now() + interval '30 minutes',
     now() - interval '3 hours',
     now() - interval '2 hours')
  on conflict do nothing;

  -- 3. HEALTHY MEDIUM (Nusa BO — plenty of runway).
  insert into public.project_issues
    (tenant_id, project_id, reporter_employee_id, assignee_employee_id,
     title, description, severity, status, sla_due_at, created_at, updated_at)
  values
    (v_tenant_id, v_proj_nusa_bo, v_emp_eid, null,
     'Weekly report footer shows wrong locale',
     'Auto-generated report footer uses en-US instead of id-ID for the timestamp.',
     'MEDIUM', 'OPEN',
     now() + interval '6 hours',
     now() - interval '1 hour',
     now() - interval '1 hour')
  on conflict do nothing;

  -- Timeline seed (CREATED event) so the audit trail is non-empty.
  insert into public.project_issue_events
    (tenant_id, issue_id, actor_employee_id, kind, to_status, metadata)
  select pi.tenant_id, pi.id, pi.reporter_employee_id, 'CREATED', 'OPEN'::public.project_issue_status,
         jsonb_build_object('severity', pi.severity, 'seed', true)
  from public.project_issues pi
  where pi.tenant_id = v_tenant_id
    and pi.project_id in (v_proj_nusa_cs, v_proj_indo_helpdesk, v_proj_nusa_bo)
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- 20. Budget Requests seed (Fase 2, §29). We first materialise an APPROVED
--     budget for Nusa CS (so requests have a valid target), then insert one
--     sample of each kind so the UI + inbox + dashboard KPI have live data.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tenant_id       uuid;
  v_pm_eid          uuid;
  v_fin_eid         uuid;
  v_dir_eid         uuid;
  v_proj_nusa_cs    uuid;
  v_budget_id       uuid := '55555555-1111-4111-8111-000000000001';
  v_line_labor_id   uuid := '55555555-2222-4111-8111-000000000001';
  v_line_infra_id   uuid := '55555555-2222-4111-8111-000000000002';
  v_line_tools_id   uuid := '55555555-2222-4111-8111-000000000003';
  v_line_conting_id uuid := '55555555-2222-4111-8111-000000000004';
  -- CoA lookups (rules §16 — reference master). Resolved by code so the
  -- demo shows real MA badges instead of dashes.
  v_coa_5101        uuid;
  v_coa_5201        uuid;
  v_coa_5202        uuid;
  v_coa_5900        uuid;
begin
  select id into v_tenant_id from public.tenants where slug = 'demo';
  if v_tenant_id is null then
    raise notice 'Skipping budget_requests seed — demo tenant missing.';
    return;
  end if;

  select id into v_pm_eid  from public.employees
    where tenant_id = v_tenant_id and role = 'PROJECT_MANAGER'    limit 1;
  select id into v_fin_eid from public.employees
    where tenant_id = v_tenant_id and role = 'LEAD_FINANCE'       limit 1;
  select id into v_dir_eid from public.employees
    where tenant_id = v_tenant_id and role = 'GENERAL_MANAGER'    limit 1;
  select id into v_proj_nusa_cs from public.projects
    where tenant_id = v_tenant_id and code = 'NUSA-CS'            limit 1;

  if v_pm_eid is null or v_fin_eid is null or v_proj_nusa_cs is null then
    raise notice 'Skipping budget_requests seed — pre-reqs missing.';
    return;
  end if;

  select id into v_coa_5101 from public.chart_of_accounts
    where tenant_id = v_tenant_id and code = '5101' limit 1;
  select id into v_coa_5201 from public.chart_of_accounts
    where tenant_id = v_tenant_id and code = '5201' limit 1;
  select id into v_coa_5202 from public.chart_of_accounts
    where tenant_id = v_tenant_id and code = '5202' limit 1;
  select id into v_coa_5900 from public.chart_of_accounts
    where tenant_id = v_tenant_id and code = '5900' limit 1;

  -- 20a. Seed an APPROVED FY2026 budget for NUSA-CS if none exists yet.
  insert into public.budgets
    (id, tenant_id, project_id, fiscal_year, title, currency, status,
     total_planned_amount, approved_at, approved_by, created_by, updated_by)
  values
    (v_budget_id, v_tenant_id, v_proj_nusa_cs, 2026,
     'FY2026 — Nusa CS Ops',
     'IDR', 'APPROVED',
     140000000,
     now() - interval '10 days',
     coalesce(v_dir_eid, v_fin_eid),
     v_pm_eid, v_pm_eid)
  on conflict (id) do nothing;

  insert into public.budget_details
    (id, tenant_id, budget_id, seq, category, coa_id, description,
     planned_amount, realized_amount, outstanding_amount,
     created_by, updated_by)
  values
    (v_line_labor_id, v_tenant_id, v_budget_id, 1, 'DIRECT_LABOUR', v_coa_5101,
     'CS agents hourly.',
     80000000, 12000000, 3000000, v_pm_eid, v_pm_eid),
    (v_line_infra_id, v_tenant_id, v_budget_id, 2, 'INFRASTRUCTURE', v_coa_5201,
     'Softphone + CRM seats.',
     35000000, 5000000, 0, v_pm_eid, v_pm_eid),
    (v_line_tools_id, v_tenant_id, v_budget_id, 3, 'TOOLING',
     coalesce(v_coa_5202, v_coa_5201),
     'QA scripting + observability.',
     15000000, 0, 0, v_pm_eid, v_pm_eid),
    (v_line_conting_id, v_tenant_id, v_budget_id, 4, 'CONTINGENCY', v_coa_5900,
     '10% buffer.',
     10000000, 0, 0, v_pm_eid, v_pm_eid)
  on conflict (id) do nothing;

  -- 20b. INCREASE (small, Finance-only chain).
  insert into public.budget_requests
    (tenant_id, budget_id, requester_employee_id, kind, amount,
     justification, status, pm_approved_at, pm_approver_id)
  values
    (v_tenant_id, v_budget_id, v_pm_eid, 'INCREASE', 2000000,
     'Butuh headphone tambahan untuk 2 orang backup agent onboarding minggu depan.',
     'PENDING_FINANCE', now() - interval '4 hours', v_pm_eid)
  on conflict do nothing;

  insert into public.budget_request_lines
    (tenant_id, budget_request_id, budget_detail_id, direction, delta_amount)
  select v_tenant_id, br.id, v_line_infra_id, 'TO', 2000000
  from public.budget_requests br
  where br.budget_id = v_budget_id and br.kind = 'INCREASE'
  on conflict do nothing;

  -- 20c. TRANSFER between two lines (Director threshold not tripped;
  --      chain = PM → FINANCE).
  insert into public.budget_requests
    (tenant_id, budget_id, requester_employee_id, kind, amount,
     justification, status)
  values
    (v_tenant_id, v_budget_id, v_pm_eid, 'TRANSFER', 5000000,
     'Realokasi dari contingency ke tooling untuk observability upgrade.',
     'PENDING_PM')
  on conflict do nothing;

  insert into public.budget_request_lines
    (tenant_id, budget_request_id, budget_detail_id, direction, delta_amount)
  select v_tenant_id, br.id, v_line_conting_id, 'FROM', 5000000
  from public.budget_requests br
  where br.budget_id = v_budget_id and br.kind = 'TRANSFER'
  on conflict do nothing;

  insert into public.budget_request_lines
    (tenant_id, budget_request_id, budget_detail_id, direction, delta_amount)
  select v_tenant_id, br.id, v_line_tools_id, 'TO', 5000000
  from public.budget_requests br
  where br.budget_id = v_budget_id and br.kind = 'TRANSFER'
  on conflict do nothing;

  -- 20d. DECREASE — release small unused contingency (Finance-only chain).
  insert into public.budget_requests
    (tenant_id, budget_id, requester_employee_id, kind, amount,
     justification, status, pm_approved_at, pm_approver_id,
     finance_approved_at, finance_approver_id, approved_at)
  values
    (v_tenant_id, v_budget_id, v_pm_eid, 'DECREASE', 1000000,
     'Release sisa contingency yang tidak akan dipakai (dept re-planning).',
     'APPROVED',
     now() - interval '2 days', v_pm_eid,
     now() - interval '1 day', v_fin_eid,
     now() - interval '1 day')
  on conflict do nothing;

  insert into public.budget_request_lines
    (tenant_id, budget_request_id, budget_detail_id, direction, delta_amount)
  select v_tenant_id, br.id, v_line_conting_id, 'FROM', 1000000
  from public.budget_requests br
  where br.budget_id = v_budget_id and br.kind = 'DECREASE'
  on conflict do nothing;

  -- Approval log skeleton for the completed leg of the APPROVED DECREASE.
  insert into public.budget_request_approval_logs
    (tenant_id, budget_request_id, actor_employee_id, actor_role,
     action, from_status, to_status)
  select v_tenant_id, br.id, v_pm_eid, 'PROJECT_MANAGER'::public.employee_role,
         'SUBMIT', 'DRAFT', 'PENDING_PM'
  from public.budget_requests br
  where br.budget_id = v_budget_id and br.kind = 'DECREASE'
  on conflict do nothing;

  insert into public.budget_request_approval_logs
    (tenant_id, budget_request_id, actor_employee_id, actor_role,
     action, from_status, to_status)
  select v_tenant_id, br.id, v_pm_eid, 'PROJECT_MANAGER'::public.employee_role,
         'APPROVE', 'PENDING_PM', 'PENDING_FINANCE'
  from public.budget_requests br
  where br.budget_id = v_budget_id and br.kind = 'DECREASE'
  on conflict do nothing;

  insert into public.budget_request_approval_logs
    (tenant_id, budget_request_id, actor_employee_id, actor_role,
     action, from_status, to_status)
  select v_tenant_id, br.id, v_fin_eid, 'LEAD_FINANCE'::public.employee_role,
         'FINANCE_APPROVE', 'PENDING_FINANCE', 'APPROVED'
  from public.budget_requests br
  where br.budget_id = v_budget_id and br.kind = 'DECREASE'
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- 20e. Demo budgets for the other two active retainer projects so the
--      Expenses "MA (budget line)" dropdown has options no matter which
--      project the submitter picks. Idempotent via stable UUIDs +
--      `on conflict do nothing`.
-- ---------------------------------------------------------------------------
do $$
#variable_conflict use_variable
declare
  v_tenant_id      constant uuid := '11111111-1111-1111-1111-111111111111';
  v_proj_nusa_bo   constant uuid := '33333333-1111-4111-8111-222222222222';
  v_proj_indo_help constant uuid := '33333333-1111-4111-8111-333333333333';
  v_budget_bo_id   constant uuid := '99999999-1111-4111-8111-222222222222';
  v_budget_help_id constant uuid := '99999999-1111-4111-8111-333333333333';
  v_pm_eid  uuid;
  v_fin_eid uuid;
  v_dir_eid uuid;
  -- CoA lookups (rules §16) — resolved so demo budgets carry real MA
  -- codes instead of dashes in the UI.
  v_coa_5101 uuid;
  v_coa_5201 uuid;
  v_coa_5202 uuid;
  v_coa_5900 uuid;
begin
  select id into v_pm_eid  from public.employees
    where tenant_id = v_tenant_id and role = 'PROJECT_MANAGER'    limit 1;
  select id into v_fin_eid from public.employees
    where tenant_id = v_tenant_id and role = 'LEAD_FINANCE'       limit 1;
  select id into v_dir_eid from public.employees
    where tenant_id = v_tenant_id and role = 'GENERAL_MANAGER'    limit 1;

  if v_pm_eid is null then return; end if;

  select id into v_coa_5101 from public.chart_of_accounts
    where tenant_id = v_tenant_id and code = '5101' limit 1;
  select id into v_coa_5201 from public.chart_of_accounts
    where tenant_id = v_tenant_id and code = '5201' limit 1;
  select id into v_coa_5202 from public.chart_of_accounts
    where tenant_id = v_tenant_id and code = '5202' limit 1;
  select id into v_coa_5900 from public.chart_of_accounts
    where tenant_id = v_tenant_id and code = '5900' limit 1;

  -- NUSA-BO — APPROVED FY2026 budget.
  insert into public.budgets
    (id, tenant_id, project_id, fiscal_year, title, currency, status,
     total_planned_amount, approved_at, approved_by, created_by, updated_by)
  values
    (v_budget_bo_id, v_tenant_id, v_proj_nusa_bo, 2026,
     'FY2026 — Nusa Back-Office',
     'IDR', 'APPROVED',
     95000000,
     now() - interval '20 days',
     coalesce(v_dir_eid, v_fin_eid),
     v_pm_eid, v_pm_eid)
  on conflict (id) do nothing;

  insert into public.budget_details
    (tenant_id, budget_id, seq, category, coa_id, description,
     planned_amount, realized_amount, outstanding_amount, created_by, updated_by)
  values
    (v_tenant_id, v_budget_bo_id, 1, 'DIRECT_LABOUR', v_coa_5101,
     'Back-office verifier hourly wages.',
     60000000, 8000000, 1500000, v_pm_eid, v_pm_eid),
    (v_tenant_id, v_budget_bo_id, 2, 'INFRASTRUCTURE', v_coa_5201,
     'Document scanner + workflow tool seats.',
     18000000, 2500000, 0, v_pm_eid, v_pm_eid),
    (v_tenant_id, v_budget_bo_id, 3, 'TOOLING',
     coalesce(v_coa_5202, v_coa_5201),
     'OCR license + QA sampling suite.',
     10000000, 0, 0, v_pm_eid, v_pm_eid),
    (v_tenant_id, v_budget_bo_id, 4, 'CONTINGENCY', v_coa_5900,
     '~7% buffer for volume spikes.',
     7000000, 0, 0, v_pm_eid, v_pm_eid)
  on conflict do nothing;

  -- INDO-HELP — APPROVED FY2026 budget.
  insert into public.budgets
    (id, tenant_id, project_id, fiscal_year, title, currency, status,
     total_planned_amount, approved_at, approved_by, created_by, updated_by)
  values
    (v_budget_help_id, v_tenant_id, v_proj_indo_help, 2026,
     'FY2026 — Indo Helpdesk 24/7',
     'IDR', 'APPROVED',
     210000000,
     now() - interval '15 days',
     coalesce(v_dir_eid, v_fin_eid),
     v_pm_eid, v_pm_eid)
  on conflict (id) do nothing;

  insert into public.budget_details
    (tenant_id, budget_id, seq, category, coa_id, description,
     planned_amount, realized_amount, outstanding_amount, created_by, updated_by)
  values
    (v_tenant_id, v_budget_help_id, 1, 'DIRECT_LABOUR', v_coa_5101,
     'L1/L2 agents 24/7 shift + on-call escalation.',
     140000000, 22000000, 6000000, v_pm_eid, v_pm_eid),
    (v_tenant_id, v_budget_help_id, 2, 'INFRASTRUCTURE', v_coa_5201,
     'PBX + softphone + CRM concurrent seats.',
     40000000, 6500000, 0, v_pm_eid, v_pm_eid),
    (v_tenant_id, v_budget_help_id, 3, 'TOOLING',
     coalesce(v_coa_5202, v_coa_5201),
     'Ticketing + observability + shift scheduler.',
     20000000, 0, 0, v_pm_eid, v_pm_eid),
    (v_tenant_id, v_budget_help_id, 4, 'CONTINGENCY', v_coa_5900,
     '~5% buffer for spike volume.',
     10000000, 0, 0, v_pm_eid, v_pm_eid)
  on conflict do nothing;

  perform v_fin_eid;
end $$;

-- ---------------------------------------------------------------------------
-- 21. Weekly Timesheet seed (Fase 2, GAS §27). Materialises two weekly
--     packets for the demo employee — one SUBMITTED (awaiting PM approval)
--     and one APPROVED — so the /hr/timesheets/weekly UI + approvals inbox
--     have live data on first boot.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tenant_id      uuid;
  v_emp_eid        uuid;
  v_pm_eid         uuid;
  v_proj_nusa      uuid;
  -- ISO Monday of the current week (based on Postgres server clock).
  v_this_monday    date := (date_trunc('week', current_date))::date;
  v_last_monday    date := v_this_monday - interval '7 days';
  v_submitted_id   uuid := 'ffffffff-1111-4111-8111-000000000001';
  v_approved_id    uuid := 'ffffffff-1111-4111-8111-000000000002';
begin
  select id into v_tenant_id from public.tenants where slug = 'demo';
  select id into v_emp_eid   from public.employees where tenant_id = v_tenant_id and role = 'EMPLOYEE' order by created_at limit 1;
  select id into v_pm_eid    from public.employees where tenant_id = v_tenant_id and role = 'PROJECT_MANAGER' order by created_at limit 1;
  select id into v_proj_nusa from public.projects where tenant_id = v_tenant_id and code = 'NUSA-CS' limit 1;

  if v_tenant_id is null or v_emp_eid is null or v_pm_eid is null then
    return;
  end if;

  -- ------------------------------------------------------------------
  -- 21a. SUBMITTED packet — current week awaiting PM approval.
  -- ------------------------------------------------------------------
  insert into public.timesheet_weeks
    (id, tenant_id, employee_id, week_start_date, status,
     total_hours, total_overtime, submitted_at, created_by, notes)
  values
    (v_submitted_id, v_tenant_id, v_emp_eid, v_this_monday,
     'SUBMITTED', 40, 2, now(), v_emp_eid,
     'Weekly packet submitted for approval (seed).')
  on conflict (id) do nothing;

  -- 7 daily rows tied to the packet. If prior seed inserted daily rows
  -- for these dates, we upsert them onto the packet instead of duplicating.
  insert into public.timesheets
    (tenant_id, employee_id, project_id, week_id, work_date,
     hours_worked, hours_overtime, status, submitted_at, created_by)
  select v_tenant_id, v_emp_eid, v_proj_nusa, v_submitted_id,
         v_this_monday + offs, 8,
         case when offs = 2 then 2 else 0 end,
         'SUBMITTED', now(), v_emp_eid
  from generate_series(0, 6) offs
  on conflict (tenant_id, employee_id, work_date)
  do update set
    week_id = v_submitted_id,
    project_id = excluded.project_id,
    hours_worked = excluded.hours_worked,
    hours_overtime = excluded.hours_overtime,
    status = 'SUBMITTED',
    submitted_at = now();

  insert into public.timesheet_week_approval_logs
    (tenant_id, week_id, actor_employee_id, actor_role,
     action, from_status, to_status, comment)
  values
    (v_tenant_id, v_submitted_id, v_emp_eid, 'EMPLOYEE'::public.employee_role,
     'SUBMIT', 'DRAFT', 'SUBMITTED', 'Weekly submit (seed)')
  on conflict do nothing;

  -- ------------------------------------------------------------------
  -- 21b. APPROVED packet — last week already signed off by PM.
  -- ------------------------------------------------------------------
  insert into public.timesheet_weeks
    (id, tenant_id, employee_id, week_start_date, status,
     total_hours, total_overtime, submitted_at, approved_at, approved_by,
     created_by)
  values
    (v_approved_id, v_tenant_id, v_emp_eid, v_last_monday,
     'APPROVED', 40, 0,
     (v_last_monday + interval '5 days')::timestamptz + time '17:00',
     (v_last_monday + interval '5 days')::timestamptz + time '18:00',
     v_pm_eid, v_emp_eid)
  on conflict (id) do nothing;

  insert into public.timesheets
    (tenant_id, employee_id, project_id, week_id, work_date,
     hours_worked, hours_overtime, status, submitted_at, approved_at,
     approved_by, created_by)
  select v_tenant_id, v_emp_eid, v_proj_nusa, v_approved_id,
         v_last_monday + offs, 8, 0, 'APPROVED',
         (v_last_monday + offs)::timestamptz + time '17:00',
         (v_last_monday + offs)::timestamptz + time '18:00',
         v_pm_eid, v_emp_eid
  from generate_series(0, 6) offs
  on conflict (tenant_id, employee_id, work_date)
  do update set
    week_id = v_approved_id,
    project_id = excluded.project_id,
    hours_worked = excluded.hours_worked,
    hours_overtime = excluded.hours_overtime,
    status = 'APPROVED',
    submitted_at = excluded.submitted_at,
    approved_at = excluded.approved_at,
    approved_by = excluded.approved_by;

  insert into public.timesheet_week_approval_logs
    (tenant_id, week_id, actor_employee_id, actor_role,
     action, from_status, to_status)
  values
    (v_tenant_id, v_approved_id, v_emp_eid, 'EMPLOYEE'::public.employee_role,
     'SUBMIT', 'DRAFT', 'SUBMITTED')
  on conflict do nothing;

  insert into public.timesheet_week_approval_logs
    (tenant_id, week_id, actor_employee_id, actor_role,
     action, from_status, to_status, comment)
  values
    (v_tenant_id, v_approved_id, v_pm_eid, 'PROJECT_MANAGER'::public.employee_role,
     'APPROVE', 'SUBMITTED', 'APPROVED', 'Looks good.')
  on conflict do nothing;
end $$;

-- =============================================================================
-- 22. Client Portal (GAS §28, rules §28) — demo portal user for PT Nusa Digital.
--
-- Password: `ControlDesk#2026` (same as employees, precomputed with scrypt
-- N=16384, r=8, p=1 via `src/lib/portal/crypto.ts`). Keep this hash in sync if
-- the demo password ever changes. E2E and manual smoke tests rely on it.
-- =============================================================================
do $$
declare
  v_tenant_id             uuid;
  v_client_nusa_id        constant uuid := '22222222-1111-4111-8111-111111111111';
  v_client_indo_id        constant uuid := '22222222-1111-4111-8111-222222222222';
  v_portal_user_nusa_id   constant uuid := '99999999-1111-4111-8111-111111111111';
  v_portal_user_indo_id   constant uuid := '99999999-1111-4111-8111-222222222222';
  v_portal_user_new_id    constant uuid := '99999999-1111-4111-8111-333333333333';
  v_password_hash         constant text :=
    'scrypt$N=16384,r=8,p=1$2HiQR3AjUXjH2Xk5S1Lctg$81JNvQzKPch1v2DjGtZbv2_2b2z9WD4shElk3S7_6yEmohnRVSTkbIjeMY2ukBtLFUwKrywPtI-uMwHmd8TyOA';
begin
  select id into v_tenant_id from public.tenants where slug = 'demo' limit 1;
  if v_tenant_id is null then
    return;
  end if;

  -- Primary demo portal user — anchor client (PT Nusa Digital).
  insert into public.client_users (
    id, tenant_id, client_id, email, password_hash, full_name, status
  ) values (
    v_portal_user_nusa_id,
    v_tenant_id,
    v_client_nusa_id,
    'client@demo.controldesk.app',
    v_password_hash,
    'Rina Wibowo (Client)',
    'ACTIVE'
  )
  on conflict (id) do update set
    email = excluded.email,
    password_hash = excluded.password_hash,
    full_name = excluded.full_name,
    status = excluded.status,
    failed_login_count = 0,
    locked_until = null;

  -- Second demo portal user — different client (PT Indo Retail Ceria).
  -- Used by cross-client isolation E2E: this user MUST NOT see PT Nusa's
  -- projects when logged in, and vice-versa.
  insert into public.client_users (
    id, tenant_id, client_id, email, password_hash, full_name, status
  ) values (
    v_portal_user_indo_id,
    v_tenant_id,
    v_client_indo_id,
    'client-indo@demo.controldesk.app',
    v_password_hash,
    'Sandi Pratama (Client)',
    'ACTIVE'
  )
  on conflict (id) do update set
    email = excluded.email,
    password_hash = excluded.password_hash,
    full_name = excluded.full_name,
    status = excluded.status,
    failed_login_count = 0,
    locked_until = null;

  -- Third demo portal user — freshly-invited (PENDING_ACTIVATION). Used by
  -- the change-password E2E: on first sign-in the user MUST be redirected
  -- to `/portal/change-password` before any other portal page is reachable.
  insert into public.client_users (
    id, tenant_id, client_id, email, password_hash, full_name, status
  ) values (
    v_portal_user_new_id,
    v_tenant_id,
    v_client_nusa_id,
    'client-new@demo.controldesk.app',
    v_password_hash,
    'Bimo Newbie (Client)',
    'PENDING_ACTIVATION'
  )
  on conflict (id) do update set
    email = excluded.email,
    password_hash = excluded.password_hash,
    full_name = excluded.full_name,
    status = excluded.status,
    failed_login_count = 0,
    locked_until = null;
end $$;

-- =============================================================================
-- 23. Portal notifications (rules §28 B.4) — seed a couple demo items so the
--     bell/feed renders content on first login. Idempotent: wiped and
--     re-inserted each seed run.
-- =============================================================================
do $$
declare
  v_tenant_id            uuid;
  v_client_nusa_id       constant uuid := '22222222-1111-4111-8111-111111111111';
  v_client_indo_id       constant uuid := '22222222-1111-4111-8111-222222222222';
  v_portal_user_nusa_id  constant uuid := '99999999-1111-4111-8111-111111111111';
  v_portal_user_indo_id  constant uuid := '99999999-1111-4111-8111-222222222222';
  v_proj_nusa_cs_id      constant uuid := '33333333-1111-4111-8111-111111111111';
  v_proj_indo_helpdesk_id constant uuid := '33333333-1111-4111-8111-333333333333';
begin
  select id into v_tenant_id from public.tenants where slug = 'demo' limit 1;
  if v_tenant_id is null then
    return;
  end if;

  -- Fresh slate — remove any prior demo notifications for these portal users
  -- so the seed is idempotent and produces a stable UI state on reset.
  delete from public.portal_notifications
   where tenant_id = v_tenant_id
     and client_user_id in (v_portal_user_nusa_id, v_portal_user_indo_id);

  -- PT Nusa · Rina: 1 unread milestone-update + 1 unread announcement + 1 read project-update.
  insert into public.portal_notifications
    (tenant_id, client_id, client_user_id, kind, title, body, action_url, created_at, read_at)
  values
    (v_tenant_id, v_client_nusa_id, v_portal_user_nusa_id,
     'MILESTONE_UPDATE',
     'Milestone completed: Discovery & SOW sign-off',
     'Project NUSA-CS — Nusa Customer Service Ops',
     '/portal/projects/' || v_proj_nusa_cs_id::text,
     now() - interval '3 hours',
     null),
    (v_tenant_id, v_client_nusa_id, v_portal_user_nusa_id,
     'ANNOUNCEMENT',
     'Monthly steering committee — Aug 10, 10:00 WIB',
     'Meeting link and agenda will be shared 24 hours before.',
     null,
     now() - interval '1 day',
     null),
    (v_tenant_id, v_client_nusa_id, v_portal_user_nusa_id,
     'PROJECT_UPDATE',
     'Progress bump: 62% → 68%',
     'NUSA-CS operational KPIs hit target for the third consecutive week.',
     '/portal/projects/' || v_proj_nusa_cs_id::text,
     now() - interval '5 days',
     now() - interval '4 days');

  -- PT Indo · Sandi: 1 unread milestone-update tied to the helpdesk project.
  insert into public.portal_notifications
    (tenant_id, client_id, client_user_id, kind, title, body, action_url, created_at, read_at)
  values
    (v_tenant_id, v_client_indo_id, v_portal_user_indo_id,
     'MILESTONE_UPDATE',
     'Milestone at risk: Q3 Quarterly Business Review',
     'Project INDO-HELP — Indo Retail 24/7 Helpdesk',
     '/portal/projects/' || v_proj_indo_helpdesk_id::text,
     now() - interval '2 hours',
     null);
end $$;

-- ---------------------------------------------------------------------------
-- Lookup options — admin-managed reference data (migration 0049).
-- Populated per demo tenant so the Field-Ops CA form and any other
-- combobox surfaces have sensible Day-1 choices.
-- ---------------------------------------------------------------------------
do $$
#variable_conflict use_variable
declare
  v_tenant_id constant uuid := '11111111-1111-1111-1111-111111111111';
  v_admin_eid uuid;
begin
  select id into v_admin_eid
    from public.employees
   where tenant_id = v_tenant_id
     and role = 'TENANT_ADMIN'
   limit 1;

  insert into public.lookup_options
    (tenant_id, domain, code, label, description, sort_order, created_by, updated_by)
  values
    -- unit_pengaju --------------------------------------------------------
    (v_tenant_id, 'unit_pengaju', 'NOC-JKT',      'NOC Jakarta',       'Network Operations Center — Jakarta HQ.',            10, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'unit_pengaju', 'OPS-NUSA',     'Ops Nusa',          'Operations team — Nusa contract.',                   20, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'unit_pengaju', 'FIELD-JKT',    'Field Team JKT',    'On-site technicians — Greater Jakarta.',             30, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'unit_pengaju', 'FIELD-BDG',    'Field Team BDG',    'On-site technicians — Bandung region.',              40, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'unit_pengaju', 'PROJECT-OPS',  'Project Operations','Cross-project delivery & PMO.',                      50, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'unit_pengaju', 'SALES-JKT',    'Sales Jakarta',     'Pre-sales & account team — Jakarta.',                60, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'unit_pengaju', 'HRD',          'HRD',               'Human Resources Development.',                       70, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'unit_pengaju', 'IT-SUPPORT',   'IT Support',        'Internal IT / helpdesk.',                            80, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'unit_pengaju', 'MANAGEMENT',   'Management',        'Executive / management operational.',                90, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'unit_pengaju', 'OTHER',        'Lain-lain',         'Jelaskan detail di kolom Justifikasi.',              999, v_admin_eid, v_admin_eid),

    -- transport_need ------------------------------------------------------
    (v_tenant_id, 'transport_need', 'MOTOR-PRIBADI', 'Motor Pribadi',   'Reimburse BBM sesuai jarak PP.',                    10, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'transport_need', 'MOBIL-PRIBADI', 'Mobil Pribadi',   'Reimburse BBM + toll sesuai jarak PP.',             20, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'transport_need', 'RENTAL-MOTOR',  'Rental Motor',    null,                                                30, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'transport_need', 'RENTAL-MOBIL',  'Rental Mobil',    null,                                                40, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'transport_need', 'CARTER',        'Carter Kendaraan','Charter kendaraan + driver.',                       50, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'transport_need', 'TAKSI-GRAB',    'Taksi / Grab',    'Ride-hailing atau taksi meteran.',                  60, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'transport_need', 'PESAWAT',       'Pesawat',         'Tiket pesawat untuk trip antar-pulau.',             70, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'transport_need', 'KERETA',        'Kereta',          'Tiket KAI antar-kota.',                             80, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'transport_need', 'KAPAL',         'Kapal / Ferry',   'Penyeberangan antar-pulau.',                        90, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'transport_need', 'OTHER',         'Lain-lain',       'Jelaskan detail di kolom Justifikasi.',             999, v_admin_eid, v_admin_eid),

    -- area ----------------------------------------------------------------
    (v_tenant_id, 'area', 'JABODETABEK',  'Jabodetabek',            'Jakarta, Bogor, Depok, Tangerang, Bekasi.',            10, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'area', 'JABAR',        'Jawa Barat',             null,                                                   20, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'area', 'JATENG-DIY',   'Jawa Tengah & DIY',      null,                                                   30, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'area', 'JATIM',        'Jawa Timur',             null,                                                   40, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'area', 'SUMATERA',     'Sumatera',               null,                                                   50, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'area', 'KALIMANTAN',   'Kalimantan',             null,                                                   60, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'area', 'SULAWESI',     'Sulawesi',               null,                                                   70, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'area', 'BALI-NTB',     'Bali & NTB',             null,                                                   80, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'area', 'MALUKU',       'Maluku',                 'Maluku & Maluku Utara.',                               90, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'area', 'PAPUA',        'Papua',                  'Papua & Papua Barat.',                                 100, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'area', 'OTHER',        'Lain-lain',              'Jelaskan detail di kolom Tujuan / Justifikasi.',       999, v_admin_eid, v_admin_eid),

    -- rab_category --------------------------------------------------------
    (v_tenant_id, 'rab_category', 'TRANSPORTASI',  'Transportasi',      'BBM, tiket, ride-hailing.',                        10, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'rab_category', 'KONSUMSI',      'Konsumsi',          'Makan / snack tim di lapangan.',                   20, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'rab_category', 'AKOMODASI',     'Akomodasi',         'Hotel / menginap.',                                30, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'rab_category', 'TOLL-PARKIR',   'Toll & Parkir',     null,                                               40, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'rab_category', 'TIKET-PESAWAT', 'Tiket Pesawat',     'Termasuk PP + bagasi.',                            45, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'rab_category', 'SEWA-ALAT',     'Sewa Alat',         'Sewa alat lapangan / genset.',                     50, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'rab_category', 'MATERIAL',      'Material / Sparepart','Kabel, konektor, komponen jaringan.',            55, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'rab_category', 'KOMUNIKASI',    'Komunikasi',        'Pulsa / paket data on-site.',                      60, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'rab_category', 'DOKUMEN-LEGAL', 'Dokumen & Legal',   'Perizinan, ijin masuk site, stempel notaris.',     65, v_admin_eid, v_admin_eid),
    (v_tenant_id, 'rab_category', 'LAIN-LAIN',     'Lain-lain',         'Tambah detail di kolom Detail.',                   999, v_admin_eid, v_admin_eid)
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- 22. Default evaluation template — "Contract Renewal Review"
-- ---------------------------------------------------------------------
-- Idempotent: skipped when either the tenant is missing or a template
-- with the same name already exists. Total item weights sum to 100%.
do $$
declare
  v_tenant_id     uuid;
  v_admin_eid     uuid;
  v_template_id   uuid := 'aaaaaaaa-1111-4111-8111-000000000001';
begin
  select id into v_tenant_id from public.tenants where slug = 'demo';
  if v_tenant_id is null then
    raise notice 'Skipping evaluation template seed — demo tenant missing.';
    return;
  end if;

  if exists (
    select 1 from public.evaluation_templates
    where tenant_id = v_tenant_id and name = 'Contract Renewal Review'
  ) then
    raise notice 'Skipping evaluation template seed — template already exists.';
    return;
  end if;

  select id into v_admin_eid from public.employees
    where tenant_id = v_tenant_id and role = 'TENANT_ADMIN' limit 1;

  insert into public.evaluation_templates
    (id, tenant_id, name, description, is_active, created_by)
  values
    (
      v_template_id,
      v_tenant_id,
      'Contract Renewal Review',
      'Default contract-renewal evaluation form. Adjust weights as needed for your team.',
      true,
      v_admin_eid
    );

  insert into public.evaluation_template_items
    (tenant_id, template_id, seq, name, description, weight_pct, question_type, is_required)
  values
    (v_tenant_id, v_template_id, 1, 'Quality of work',
      'How consistently does the employee meet the quality bar for deliverables?',
      25, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 2, 'Productivity & throughput',
      'Volume of tickets / milestones delivered vs. expectations.',
      20, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 3, 'Reliability & discipline',
      'Attendance, timesheet compliance, adherence to SLA.',
      15, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 4, 'Teamwork & communication',
      'How well the employee collaborates and communicates with peers / client.',
      15, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 5, 'Initiative & ownership',
      'Ability to take ownership, propose improvements, and unblock others.',
      15, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 6, 'Growth vs. previous cycle',
      'Improvement compared to the previous evaluation cycle.',
      10, 'SCORE_1_5', false),
    (v_tenant_id, v_template_id, 7, 'Areas for coaching',
      'Free-form notes: gaps to close, coaching plan, follow-ups.',
      0, 'TEXT', false);
end $$;

-- ---------------------------------------------------------------------
-- 23. Default PKWT evaluation template — 10 aspek "Manajemen Pekerjaan"
-- ---------------------------------------------------------------------
-- Idempotent: skipped when tenant is missing or template already exists.
-- Mirrors the in-country PKWT quarterly evaluation form (skor 1-5 +
-- komentar wajib per aspek).
do $$
declare
  v_tenant_id   uuid;
  v_admin_eid   uuid;
  v_template_id uuid := 'aaaaaaaa-1111-4111-8111-000000000002';
begin
  select id into v_tenant_id from public.tenants where slug = 'demo';
  if v_tenant_id is null then
    raise notice 'Skipping PKWT template seed — demo tenant missing.';
    return;
  end if;

  if exists (
    select 1 from public.evaluation_templates
    where tenant_id = v_tenant_id and name = 'Evaluasi Triwulanan PKWT'
  ) then
    raise notice 'Skipping PKWT template seed — already exists.';
    return;
  end if;

  select id into v_admin_eid from public.employees
    where tenant_id = v_tenant_id and role = 'TENANT_ADMIN' limit 1;

  insert into public.evaluation_templates
    (id, tenant_id, name, description, is_active, created_by)
  values
    (
      v_template_id,
      v_tenant_id,
      'Evaluasi Triwulanan PKWT',
      'Formulir baku evaluasi triwulanan untuk karyawan PKWT. Skala 1-5, komentar wajib per aspek.',
      true,
      v_admin_eid
    );

  insert into public.evaluation_template_items
    (tenant_id, template_id, seq, name, description, weight_pct, question_type, is_required)
  values
    (v_tenant_id, v_template_id, 1, 'Ketepatan hasil kerja dengan target dan batas waktu',
      'Sejauh mana karyawan dapat menyelesaikan pekerjaan sesuai target dan batas waktu yang telah ditetapkan.',
      10, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 2, 'Kualitas pekerjaan',
      'Sejauh mana pekerjaan karyawan terselesaikan dengan baik, efektif, dan akurat.',
      10, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 3, 'Pemahaman mengenai pekerjaan',
      'Sejauh mana karyawan memahami dan mengaplikasikan bagaimana dan mengapa perlu mengerjakan hal-hal yang menjadi tugasnya, sesuai peran saat ini.',
      10, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 4, 'Hubungan kerja dengan atasan langsung',
      'Sejauh mana karyawan menunjukkan sikap responsif terhadap arahan atasan, serta seberapa proaktif mencari bimbingan untuk pengembangan diri.',
      10, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 5, 'Kerjasama dengan karyawan lain',
      'Sejauh mana karyawan dapat menjalin hubungan baik dengan sesama karyawan.',
      10, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 6, 'Kehadiran dan kedisiplinan',
      'Sejauh mana karyawan dapat hadir tepat waktu dan menunjukkan kedisiplinan konsisten.',
      10, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 7, 'Inisiatif dan kreativitas',
      'Sejauh mana karyawan mampu mengelola pengerjaan tugasnya secara mandiri dan menerapkan metode kreatif.',
      10, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 8, 'Keterbukaan untuk belajar dan berkembang',
      'Sejauh mana karyawan menunjukkan kemampuan dan kesiapan menerima tugas / tanggung jawab baru yang lebih kompleks.',
      10, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 9, 'Kemampuan berkomunikasi',
      'Sejauh mana karyawan dapat menyampaikan ide / pendapat secara efektif (lisan, tertulis, verbal, non-verbal).',
      10, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 10, 'Kemampuan mengambil keputusan dan menyelesaikan masalah',
      'Sejauh mana karyawan dapat mengelola prioritas pekerjaan secara efektif, mempertimbangkan resiko sebelum bertindak.',
      10, 'SCORE_1_5', true);
end $$;

-- Cleanup: drop the seed helper so it doesn't linger in the migrated schema.
drop function public._seed_user(text, text, text);
