-- =============================================================================
-- Seed the `itps` tenant so it has feature parity with `demo` for
-- day-to-day exploration. Idempotent — safe to run multiple times.
--
-- What this script does (in order):
--   1. Copy the AI config (Ollama / OPENAI_COMPATIBLE) from `demo` → `itps`.
--   2. Backfill lookup domains that `demo` has but `itps` doesn't
--      (`area`, `unit_pengaju`).
--   3. Add 5 sample employees rounding out the hierarchy
--      (SUPERVISOR + LEAD_FINANCE + HR_ADMIN + 2 EMPLOYEE).
--   4. Add 2 sample clients + 2 sample projects (linked to those clients).
--   5. Wire assignments: Budi (PROJECT_MANAGER) → both projects,
--      Ari (SUPERVISOR) → both, two juniors → project 1.
--   6. Add 3 standard work shifts (Pagi / Siang / Malam).
--
-- What this script deliberately does NOT touch:
--   • `approval_thresholds` — itps falls back to the codebase defaults
--     from `APPROVAL_CONFIG` in `src/lib/rbac/roles.ts`, which is the
--     intended shape for a fresh tenant.
--   • `budgets`, `project_expenses`, `cash_advances`, `timesheets` —
--     these belong to per-workflow demos and should be created via the
--     UI once the tenant has been walked through onboarding.
--   • Chart of Accounts (already provisioned via `provision_tenant`).
--   • Universal lookup domains `rab_category` + `transport_need`
--     (already seeded via a recent migration).
--
-- Assumption: `itps` tenant already exists, `itpsadmin` employee already
-- exists (created via /register-org self-signup). All INSERTs are
-- guarded by ON CONFLICT / NOT EXISTS so re-running is a no-op.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  itps_id  UUID;
  demo_id  UUID;
  admin_id UUID;
  pm_id    UUID;
  spv_id   UUID;
  fin_id   UUID;
  hr_id    UUID;
  emp1_id  UUID;
  emp2_id  UUID;
  cli1_id  UUID;
  cli2_id  UUID;
  proj1_id UUID;
  proj2_id UUID;
BEGIN
  SELECT id INTO itps_id FROM public.tenants WHERE slug = 'itps';
  SELECT id INTO demo_id FROM public.tenants WHERE slug = 'demo';
  IF itps_id IS NULL THEN
    RAISE EXCEPTION 'Tenant "itps" not found. Run this after self-signup completes.';
  END IF;

  SELECT id INTO admin_id FROM public.employees WHERE tenant_id = itps_id AND role = 'TENANT_ADMIN' LIMIT 1;
  SELECT id INTO pm_id    FROM public.employees WHERE tenant_id = itps_id AND role = 'PROJECT_MANAGER' LIMIT 1;

  IF admin_id IS NULL THEN
    RAISE EXCEPTION 'itps tenant admin not found — self-signup incomplete?';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 1. AI CONFIG — copy Ollama settings from demo
  -- ---------------------------------------------------------------------------
  IF demo_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tenant_ai_configs WHERE tenant_id = itps_id
  ) THEN
    INSERT INTO public.tenant_ai_configs
      (tenant_id, provider, model_id, encrypted_api_key, base_url,
       daily_token_cap, pii_redaction_enabled, is_active)
    SELECT itps_id, provider, model_id, encrypted_api_key, base_url,
           daily_token_cap, pii_redaction_enabled, is_active
    FROM public.tenant_ai_configs
    WHERE tenant_id = demo_id;
    RAISE NOTICE 'AI config copied from demo → itps';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. LOOKUP OPTIONS — backfill `area` and `unit_pengaju`
  --    Use ON CONFLICT DO NOTHING against the (tenant_id, domain, code)
  --    unique index so re-runs stay quiet.
  -- ---------------------------------------------------------------------------
  -- The unique index on lookup_options is *partial* (`WHERE is_active`),
  -- so ON CONFLICT can't target it without matching that predicate.
  -- Sidestep the whole dance with a NOT EXISTS guard — the row set is
  -- tiny (≤ 25 rows) so the cost is negligible.
  IF demo_id IS NOT NULL THEN
    INSERT INTO public.lookup_options
      (tenant_id, domain, code, label, sort_order, is_active, created_at, updated_at)
    SELECT itps_id, lo.domain, lo.code, lo.label, lo.sort_order,
           lo.is_active, now(), now()
    FROM public.lookup_options lo
    WHERE lo.tenant_id = demo_id
      AND lo.domain IN ('area', 'unit_pengaju')
      AND NOT EXISTS (
        SELECT 1 FROM public.lookup_options existing
         WHERE existing.tenant_id = itps_id
           AND existing.domain = lo.domain
           AND existing.code = lo.code
      );
  END IF;

  -- ---------------------------------------------------------------------------
  -- 3. EMPLOYEES — round out the hierarchy so approval chains are testable
  --    Everyone reports up to admin (TENANT_ADMIN) or Budi (PM) as appropriate.
  --    Emails use the tenant's `@itps.co.id` domain for realism.
  -- ---------------------------------------------------------------------------

  -- Supervisor
  SELECT id INTO spv_id FROM public.employees
   WHERE tenant_id = itps_id AND email = 'ari.nugroho@itps.co.id';
  IF spv_id IS NULL THEN
    INSERT INTO public.employees
      (tenant_id, first_name, last_name, full_name, email, phone,
       department, position_title, role, employment_type, join_date,
       availability, reports_to_employee_id, is_active)
    VALUES
      (itps_id, 'Ari', 'Nugroho', 'Ari Nugroho', 'ari.nugroho@itps.co.id',
       '+62 812 1111 0001', 'Operations', 'Site Supervisor', 'SUPERVISOR',
       'PERMANENT', CURRENT_DATE - INTERVAL '400 days', 'AVAILABLE',
       pm_id, TRUE)
    RETURNING id INTO spv_id;
  END IF;

  -- Lead Finance
  SELECT id INTO fin_id FROM public.employees
   WHERE tenant_id = itps_id AND email = 'dewi.lestari@itps.co.id';
  IF fin_id IS NULL THEN
    INSERT INTO public.employees
      (tenant_id, first_name, last_name, full_name, email, phone,
       department, position_title, role, employment_type, join_date,
       availability, reports_to_employee_id, is_active)
    VALUES
      (itps_id, 'Dewi', 'Lestari', 'Dewi Lestari', 'dewi.lestari@itps.co.id',
       '+62 812 1111 0002', 'Finance', 'Finance Manager', 'LEAD_FINANCE',
       'PERMANENT', CURRENT_DATE - INTERVAL '600 days', 'AVAILABLE',
       admin_id, TRUE)
    RETURNING id INTO fin_id;
  END IF;

  -- HR Admin
  SELECT id INTO hr_id FROM public.employees
   WHERE tenant_id = itps_id AND email = 'rina.wijaya@itps.co.id';
  IF hr_id IS NULL THEN
    INSERT INTO public.employees
      (tenant_id, first_name, last_name, full_name, email, phone,
       department, position_title, role, employment_type, join_date,
       availability, reports_to_employee_id, is_active)
    VALUES
      (itps_id, 'Rina', 'Wijaya', 'Rina Wijaya', 'rina.wijaya@itps.co.id',
       '+62 812 1111 0003', 'HR', 'HR Manager', 'HR_ADMIN',
       'PERMANENT', CURRENT_DATE - INTERVAL '500 days', 'AVAILABLE',
       admin_id, TRUE)
    RETURNING id INTO hr_id;
  END IF;

  -- Junior Employee 1 — CONTRACT type has a NOT NULL check on
  -- contract_end_date via `employees_contract_end_required`, so the
  -- date has to be included in the initial INSERT (a follow-up UPDATE
  -- runs after the check fires, too late).
  SELECT id INTO emp1_id FROM public.employees
   WHERE tenant_id = itps_id AND email = 'andi.prasetyo@itps.co.id';
  IF emp1_id IS NULL THEN
    INSERT INTO public.employees
      (tenant_id, first_name, last_name, full_name, email, phone,
       department, position_title, role, employment_type, join_date,
       contract_end_date, availability, reports_to_employee_id, is_active)
    VALUES
      (itps_id, 'Andi', 'Prasetyo', 'Andi Prasetyo', 'andi.prasetyo@itps.co.id',
       '+62 812 1111 0004', 'Engineering', 'Field Engineer', 'EMPLOYEE',
       'CONTRACT', CURRENT_DATE - INTERVAL '90 days',
       CURRENT_DATE + INTERVAL '275 days',
       'AVAILABLE', spv_id, TRUE)
    RETURNING id INTO emp1_id;
  END IF;

  -- Junior Employee 2
  SELECT id INTO emp2_id FROM public.employees
   WHERE tenant_id = itps_id AND email = 'siska.handayani@itps.co.id';
  IF emp2_id IS NULL THEN
    INSERT INTO public.employees
      (tenant_id, first_name, last_name, full_name, email, phone,
       department, position_title, role, employment_type, join_date,
       availability, reports_to_employee_id, is_active)
    VALUES
      (itps_id, 'Siska', 'Handayani', 'Siska Handayani', 'siska.handayani@itps.co.id',
       '+62 812 1111 0005', 'Engineering', 'Software Developer', 'EMPLOYEE',
       'PERMANENT', CURRENT_DATE - INTERVAL '180 days', 'AVAILABLE',
       spv_id, TRUE)
    RETURNING id INTO emp2_id;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 4. CLIENTS
  -- ---------------------------------------------------------------------------

  SELECT id INTO cli1_id FROM public.clients
   WHERE tenant_id = itps_id AND name = 'PT Sinar Digital Nusantara';
  IF cli1_id IS NULL THEN
    INSERT INTO public.clients
      (tenant_id, name, industry, contact_name, contact_email, contact_phone,
       status, onboarded_at)
    VALUES
      (itps_id, 'PT Sinar Digital Nusantara', 'Retail Technology',
       'Budi Wijaya', 'budi.wijaya@sinardigital.co.id', '+62 21 5555 0100',
       'ACTIVE', now() - INTERVAL '30 days')
    RETURNING id INTO cli1_id;
  END IF;

  SELECT id INTO cli2_id FROM public.clients
   WHERE tenant_id = itps_id AND name = 'CV Prima Elektronika';
  IF cli2_id IS NULL THEN
    INSERT INTO public.clients
      (tenant_id, name, industry, contact_name, contact_email, contact_phone,
       status, onboarded_at)
    VALUES
      (itps_id, 'CV Prima Elektronika', 'Manufacturing',
       'Sari Handayani', 'sari@primaelektronika.com', '+62 21 5555 0200',
       'ACTIVE', now() - INTERVAL '15 days')
    RETURNING id INTO cli2_id;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 5. PROJECTS — one per client
  -- ---------------------------------------------------------------------------

  SELECT id INTO proj1_id FROM public.projects
   WHERE tenant_id = itps_id AND code = 'ITPS-WEB-2026';
  IF proj1_id IS NULL THEN
    INSERT INTO public.projects
      (tenant_id, client_id, code, name, description, status,
       start_date, end_date, project_type, priority, location,
       contract_value, currency)
    VALUES
      (itps_id, cli1_id, 'ITPS-WEB-2026',
       'Sinar Digital Website Redesign',
       'Full website redesign + e-commerce integration for PT Sinar Digital Nusantara.',
       'ACTIVE', CURRENT_DATE - INTERVAL '20 days', CURRENT_DATE + INTERVAL '90 days',
       'FIXED_PRICE', 'HIGH', 'Jakarta, DKI',
       250000000, 'IDR')
    RETURNING id INTO proj1_id;
  END IF;

  SELECT id INTO proj2_id FROM public.projects
   WHERE tenant_id = itps_id AND code = 'ITPS-ERP-2026';
  IF proj2_id IS NULL THEN
    INSERT INTO public.projects
      (tenant_id, client_id, code, name, description, status,
       start_date, end_date, project_type, priority, location,
       contract_value, currency)
    VALUES
      (itps_id, cli2_id, 'ITPS-ERP-2026',
       'Prima Elektronika ERP Rollout',
       'ERP implementation covering inventory + finance + HR modules for 3 branches.',
       'PLANNING', CURRENT_DATE + INTERVAL '10 days', CURRENT_DATE + INTERVAL '180 days',
       'TIME_MATERIAL', 'MEDIUM', 'Bandung, Jawa Barat',
       450000000, 'IDR')
    RETURNING id INTO proj2_id;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 6. ASSIGNMENTS — Budi (PM) on both projects, Ari (SPV) on both,
  --    juniors on Website only for now.
  -- ---------------------------------------------------------------------------

  -- PM assignments
  IF pm_id IS NOT NULL THEN
    INSERT INTO public.project_pm_assignments
      (tenant_id, project_id, pm_employee_id, assignment_role, status, started_at)
    SELECT itps_id, proj1_id, pm_id, 'PRIMARY_PM', 'ACTIVE', now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.project_pm_assignments
       WHERE project_id = proj1_id AND pm_employee_id = pm_id
    );

    INSERT INTO public.project_pm_assignments
      (tenant_id, project_id, pm_employee_id, assignment_role, status, started_at)
    SELECT itps_id, proj2_id, pm_id, 'PRIMARY_PM', 'ACTIVE', now()
    WHERE NOT EXISTS (
      SELECT 1 FROM public.project_pm_assignments
       WHERE project_id = proj2_id AND pm_employee_id = pm_id
    );
  END IF;

  -- Employee assignments — allocation split so no one hits >100% cumulatively.
  --   Ari  : 50% Website + 50% ERP
  --   Andi : 100% Website
  --   Siska: 100% Website
  -- `project_member_role` uses UPPERCASE canonical labels
  -- (SITE_SUPERVISOR, ENGINEER, DEVELOPER, …); do NOT pass the
  -- capitalised strings shown in the UI or the insert will trip the
  -- enum check.
  INSERT INTO public.project_employee_assignments
    (tenant_id, project_id, employee_id, allocation_percentage, status, started_at, role)
  SELECT itps_id, proj1_id, spv_id, 50, 'ACTIVE', now(), 'SITE_SUPERVISOR'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.project_employee_assignments
     WHERE project_id = proj1_id AND employee_id = spv_id
  );

  INSERT INTO public.project_employee_assignments
    (tenant_id, project_id, employee_id, allocation_percentage, status, started_at, role)
  SELECT itps_id, proj2_id, spv_id, 50, 'ACTIVE', now(), 'SITE_SUPERVISOR'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.project_employee_assignments
     WHERE project_id = proj2_id AND employee_id = spv_id
  );

  INSERT INTO public.project_employee_assignments
    (tenant_id, project_id, employee_id, allocation_percentage, status, started_at, role)
  SELECT itps_id, proj1_id, emp1_id, 100, 'ACTIVE', now(), 'ENGINEER'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.project_employee_assignments
     WHERE project_id = proj1_id AND employee_id = emp1_id
  );

  INSERT INTO public.project_employee_assignments
    (tenant_id, project_id, employee_id, allocation_percentage, status, started_at, role)
  SELECT itps_id, proj1_id, emp2_id, 100, 'ACTIVE', now(), 'DEVELOPER'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.project_employee_assignments
     WHERE project_id = proj1_id AND employee_id = emp2_id
  );

  -- ---------------------------------------------------------------------------
  -- 7. WORK SHIFTS — Morning / Afternoon / Night (base catalog, no project_id)
  -- ---------------------------------------------------------------------------

  INSERT INTO public.work_shifts
    (tenant_id, code, name, start_time, end_time, duration,
     shift_allowance, is_night, is_active)
  SELECT itps_id, 'PAGI', 'Shift Pagi', '08:00', '17:00',
         (INTERVAL '9 hours'), 0, FALSE, TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM public.work_shifts WHERE tenant_id = itps_id AND code = 'PAGI'
  );

  INSERT INTO public.work_shifts
    (tenant_id, code, name, start_time, end_time, duration,
     shift_allowance, is_night, is_active)
  SELECT itps_id, 'SIANG', 'Shift Siang', '13:00', '22:00',
         (INTERVAL '9 hours'), 25000, FALSE, TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM public.work_shifts WHERE tenant_id = itps_id AND code = 'SIANG'
  );

  INSERT INTO public.work_shifts
    (tenant_id, code, name, start_time, end_time, duration,
     shift_allowance, is_night, is_active)
  SELECT itps_id, 'MALAM', 'Shift Malam', '22:00', '07:00',
         (INTERVAL '9 hours'), 50000, TRUE, TRUE
  WHERE NOT EXISTS (
    SELECT 1 FROM public.work_shifts WHERE tenant_id = itps_id AND code = 'MALAM'
  );

  RAISE NOTICE 'itps seeding complete. Summary:';
END;
$$;

-- Post-run summary — outside the DO block so the counts appear in psql output.
SELECT 'employees' AS module, COUNT(*) AS itps_count
  FROM public.employees WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug='itps')
UNION ALL SELECT 'clients', COUNT(*)
  FROM public.clients WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug='itps')
UNION ALL SELECT 'projects', COUNT(*)
  FROM public.projects WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug='itps')
UNION ALL SELECT 'project_pm_assignments', COUNT(*)
  FROM public.project_pm_assignments WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug='itps')
UNION ALL SELECT 'project_employee_assignments', COUNT(*)
  FROM public.project_employee_assignments WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug='itps')
UNION ALL SELECT 'work_shifts', COUNT(*)
  FROM public.work_shifts WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug='itps')
UNION ALL SELECT 'lookup_options', COUNT(*)
  FROM public.lookup_options WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug='itps')
UNION ALL SELECT 'ai_configs', COUNT(*)
  FROM public.tenant_ai_configs WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug='itps')
ORDER BY 1;

COMMIT;
