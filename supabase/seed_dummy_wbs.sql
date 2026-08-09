-- =============================================================================
-- ControlDesk — seed_dummy_wbs.sql (top-up / append-only)
--
-- Populates the "Kirana Data Annotation Pilot" project (KIRA-DA) with a
-- 3-level WBS (Work Breakdown Structure) so the /projects/{id} detail page
-- has a visible tree + Gantt when demo-ing the module.
--
-- Idempotent — all rows use deterministic UUIDs + `ON CONFLICT DO NOTHING`.
-- Safe to re-apply as often as you like.
--
-- Apply:
--   docker exec -i supabase_db_controldesk psql -U postgres -d postgres \
--     < supabase/seed_dummy_wbs.sql
-- =============================================================================

DO $$
DECLARE
  v_tenant_id  uuid := (SELECT id FROM public.tenants WHERE slug = 'demo');
  v_project_id uuid := '33333333-1111-4111-8111-444444444444';   -- KIRA-DA

  -- Milestones (from seed.sql)
  v_ms_discovery   uuid := 'a6a56d73-97e5-4083-ab29-ea85d7e5908e';
  v_ms_pilot       uuid := '15a6596a-e89a-40d9-b6ba-ad9363c26758';
  v_ms_production  uuid := '8607643f-1c69-40df-8994-ab316613d548';
  v_ms_uat         uuid := '4924b738-4061-4971-93d7-446144d9640c';

  -- Employees
  v_pm         uuid := '925aa5d7-bf5f-403a-a7b0-837a145a0be7';   -- Putri PM
  v_supervisor uuid := '836c59fc-8b7f-4506-a0cc-754fd10c95ed';   -- Sinta Supervisor
  v_employee   uuid := '39fab0e2-ae3e-4ee2-895f-9dbdf28c037a';   -- Eko Employee
  v_admin      uuid := '84ab41b6-d695-4b26-9035-7727bbb7853e';   -- Ayu Admin (created_by)

  -- WBS task ids (deterministic — grouped by milestone)
  -- M1 · Discovery & SOW sign-off
  v_t_1_1      uuid := 'aa000000-0001-4111-8111-000000000101';   -- Kick-off workshop
  v_t_1_1_1    uuid := 'aa000000-0001-4111-8111-000000000102';   -- Prep agenda
  v_t_1_1_2    uuid := 'aa000000-0001-4111-8111-000000000103';   -- Facilitate workshop
  v_t_1_2      uuid := 'aa000000-0001-4111-8111-000000000104';   -- Draft SOW
  v_t_1_2_1    uuid := 'aa000000-0001-4111-8111-000000000105';   -- Collect requirements
  v_t_1_2_2    uuid := 'aa000000-0001-4111-8111-000000000106';   -- Write SOW v1
  v_t_1_3      uuid := 'aa000000-0001-4111-8111-000000000107';   -- Client review & sign

  -- M2 · Labelling schema + pilot batch
  v_t_2_1      uuid := 'aa000000-0002-4111-8111-000000000201';   -- Design taxonomy
  v_t_2_1_1    uuid := 'aa000000-0002-4111-8111-000000000202';   -- Research standards
  v_t_2_1_2    uuid := 'aa000000-0002-4111-8111-000000000203';   -- Draft taxonomy v1
  v_t_2_1_3    uuid := 'aa000000-0002-4111-8111-000000000204';   -- Client alignment
  v_t_2_2      uuid := 'aa000000-0002-4111-8111-000000000205';   -- Recruit + train annotators
  v_t_2_3      uuid := 'aa000000-0002-4111-8111-000000000206';   -- Pilot batch annotation
  v_t_2_4      uuid := 'aa000000-0002-4111-8111-000000000207';   -- QA + IAA report

  -- M3 · Full production run
  v_t_3_1      uuid := 'aa000000-0003-4111-8111-000000000301';   -- Scale annotator team
  v_t_3_2      uuid := 'aa000000-0003-4111-8111-000000000302';   -- Weekly production runs
  v_t_3_3      uuid := 'aa000000-0003-4111-8111-000000000303';   -- Continuous QA
  v_t_3_4      uuid := 'aa000000-0003-4111-8111-000000000304';   -- Final delivery package

  -- M4 · UAT + handover
  v_t_4_1      uuid := 'aa000000-0004-4111-8111-000000000401';   -- Client UAT
  v_t_4_2      uuid := 'aa000000-0004-4111-8111-000000000402';   -- Address feedback
  v_t_4_3      uuid := 'aa000000-0004-4111-8111-000000000403';   -- Handover docs

  v_count integer;
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Demo tenant not found — run seed.sql first.';
  END IF;

  -- Guard: skip if this project already has tasks (idempotent-ish; delete
  -- the tasks manually if you want to reseed a different mix).
  SELECT COUNT(*) INTO v_count
    FROM public.project_tasks
   WHERE project_id = v_project_id;
  IF v_count > 0 THEN
    RAISE NOTICE 'Skipping WBS seed — project already has % task rows.', v_count;
    RETURN;
  END IF;

  -- ---------------------------------------------------------------------------
  -- Milestone 1 · Discovery & SOW sign-off (nearly done — mostly progress 100)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.project_tasks
    (id, tenant_id, project_id, milestone_id, parent_task_id, sort_order,
     name, description, status, progress_pct, weight_pct,
     planned_start_date, planned_end_date, actual_start_date, actual_end_date,
     owner_employee_id, depends_on_task_id, budget_amount, created_by)
  VALUES
    (v_t_1_1, v_tenant_id, v_project_id, v_ms_discovery, NULL, 0,
     'Kick-off workshop',
     'Facilitator + client stakeholder alignment — establish success criteria.',
     'DONE', 100, 20,
     '2026-08-29', '2026-09-01', '2026-08-29', '2026-09-01',
     v_pm, NULL, NULL, v_admin),

    (v_t_1_1_1, v_tenant_id, v_project_id, v_ms_discovery, v_t_1_1, 0,
     'Prep agenda + invites',
     'Circulate agenda 3 days before, book meeting room + Zoom.',
     'DONE', 100, 40,
     '2026-08-29', '2026-08-30', '2026-08-29', '2026-08-30',
     v_pm, NULL, NULL, v_admin),

    (v_t_1_1_2, v_tenant_id, v_project_id, v_ms_discovery, v_t_1_1, 1,
     'Facilitate workshop',
     'Half-day session, capture decisions in Notion.',
     'DONE', 100, 60,
     '2026-08-31', '2026-09-01', '2026-08-31', '2026-09-01',
     v_pm, NULL, NULL, v_admin),

    (v_t_1_2, v_tenant_id, v_project_id, v_ms_discovery, NULL, 1,
     'Draft SOW & requirements',
     'Translate workshop outputs into a signable SOW.',
     'DONE', 100, 45,
     '2026-09-01', '2026-09-05', '2026-09-01', '2026-09-05',
     v_pm, v_t_1_1, 8000000, v_admin),

    (v_t_1_2_1, v_tenant_id, v_project_id, v_ms_discovery, v_t_1_2, 0,
     'Collect functional requirements',
     'Interview stakeholders, capture use cases.',
     'DONE', 100, 50,
     '2026-09-01', '2026-09-03', '2026-09-01', '2026-09-03',
     v_pm, NULL, NULL, v_admin),

    (v_t_1_2_2, v_tenant_id, v_project_id, v_ms_discovery, v_t_1_2, 1,
     'Write SOW v1 + circulate',
     'Legal review by finance, then send to client.',
     'DONE', 100, 50,
     '2026-09-03', '2026-09-05', '2026-09-03', '2026-09-05',
     v_pm, NULL, NULL, v_admin),

    (v_t_1_3, v_tenant_id, v_project_id, v_ms_discovery, NULL, 2,
     'Client review & signature',
     'Iterate on redlines, obtain signed SOW.',
     'IN_PROGRESS', 80, 35,
     '2026-09-05', '2026-09-08', '2026-09-05', NULL,
     v_pm, v_t_1_2, NULL, v_admin);

  -- ---------------------------------------------------------------------------
  -- Milestone 2 · Labelling schema + pilot batch (currently in-flight)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.project_tasks
    (id, tenant_id, project_id, milestone_id, parent_task_id, sort_order,
     name, description, status, progress_pct, weight_pct,
     planned_start_date, planned_end_date, actual_start_date, actual_end_date,
     owner_employee_id, depends_on_task_id, budget_amount, created_by)
  VALUES
    (v_t_2_1, v_tenant_id, v_project_id, v_ms_pilot, NULL, 0,
     'Design labelling taxonomy',
     '3-level taxonomy covering intent + entity + sentiment.',
     'IN_PROGRESS', 60, 25,
     '2026-09-08', '2026-09-15', '2026-09-08', NULL,
     v_employee, v_t_1_3, 5000000, v_admin),

    (v_t_2_1_1, v_tenant_id, v_project_id, v_ms_pilot, v_t_2_1, 0,
     'Research industry standard schemas',
     'Compare Meta Human, GoEmotions, CLINC-150.',
     'DONE', 100, 30,
     '2026-09-08', '2026-09-10', '2026-09-08', '2026-09-10',
     v_employee, NULL, NULL, v_admin),

    (v_t_2_1_2, v_tenant_id, v_project_id, v_ms_pilot, v_t_2_1, 1,
     'Draft taxonomy v1',
     'YAML schema + example labelled snippets.',
     'IN_PROGRESS', 70, 40,
     '2026-09-10', '2026-09-13', '2026-09-10', NULL,
     v_employee, NULL, NULL, v_admin),

    (v_t_2_1_3, v_tenant_id, v_project_id, v_ms_pilot, v_t_2_1, 2,
     'Client alignment call',
     'Walk client through schema, capture change requests.',
     'TODO', 0, 30,
     '2026-09-14', '2026-09-15', NULL, NULL,
     v_pm, v_t_2_1_2, NULL, v_admin),

    (v_t_2_2, v_tenant_id, v_project_id, v_ms_pilot, NULL, 1,
     'Recruit + train annotators',
     '10 annotators — screening, contracts, 2-day training.',
     'IN_PROGRESS', 40, 30,
     '2026-09-15', '2026-09-22', '2026-09-15', NULL,
     v_supervisor, v_t_2_1, 12000000, v_admin),

    (v_t_2_3, v_tenant_id, v_project_id, v_ms_pilot, NULL, 2,
     'Pilot batch annotation (500 items)',
     'First batch — measures throughput + baseline quality.',
     'TODO', 0, 30,
     '2026-09-22', '2026-09-30', NULL, NULL,
     v_supervisor, v_t_2_2, 8000000, v_admin),

    (v_t_2_4, v_tenant_id, v_project_id, v_ms_pilot, NULL, 3,
     'QA + inter-annotator agreement report',
     'Cohen kappa report, retraining plan if IAA < 0.75.',
     'BLOCKED', 0, 15,
     '2026-09-30', '2026-10-03', NULL, NULL,
     v_employee, v_t_2_3, NULL, v_admin);

  -- ---------------------------------------------------------------------------
  -- Milestone 3 · Full production run (upcoming, all TODO)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.project_tasks
    (id, tenant_id, project_id, milestone_id, parent_task_id, sort_order,
     name, description, status, progress_pct, weight_pct,
     planned_start_date, planned_end_date, actual_start_date, actual_end_date,
     owner_employee_id, depends_on_task_id, budget_amount, created_by)
  VALUES
    (v_t_3_1, v_tenant_id, v_project_id, v_ms_production, NULL, 0,
     'Scale up annotator team',
     'Grow to 25 annotators — split shifts for 24/6 coverage.',
     'TODO', 0, 20,
     '2026-10-03', '2026-10-10', NULL, NULL,
     v_supervisor, v_t_2_4, 18000000, v_admin),

    (v_t_3_2, v_tenant_id, v_project_id, v_ms_production, NULL, 1,
     'Weekly production runs',
     '~10 000 items/week for 4 weeks.',
     'TODO', 0, 40,
     '2026-10-10', '2026-11-05', NULL, NULL,
     v_supervisor, v_t_3_1, 60000000, v_admin),

    (v_t_3_3, v_tenant_id, v_project_id, v_ms_production, NULL, 2,
     'Continuous QA (rolling audit)',
     '10% sample per batch, log defects in QA sheet.',
     'TODO', 0, 25,
     '2026-10-10', '2026-11-05', NULL, NULL,
     v_employee, v_t_3_2, NULL, v_admin),

    (v_t_3_4, v_tenant_id, v_project_id, v_ms_production, NULL, 3,
     'Final delivery package',
     'Cleaned dataset in JSONL + Parquet + PII-redacted CSV.',
     'TODO', 0, 15,
     '2026-11-05', '2026-11-12', NULL, NULL,
     v_pm, v_t_3_3, NULL, v_admin);

  -- ---------------------------------------------------------------------------
  -- Milestone 4 · UAT + handover
  -- ---------------------------------------------------------------------------
  INSERT INTO public.project_tasks
    (id, tenant_id, project_id, milestone_id, parent_task_id, sort_order,
     name, description, status, progress_pct, weight_pct,
     planned_start_date, planned_end_date, actual_start_date, actual_end_date,
     owner_employee_id, depends_on_task_id, budget_amount, created_by)
  VALUES
    (v_t_4_1, v_tenant_id, v_project_id, v_ms_uat, NULL, 0,
     'Client UAT',
     'Client reviews sample + accuracy report.',
     'TODO', 0, 40,
     '2026-11-12', '2026-11-20', NULL, NULL,
     v_pm, v_t_3_4, NULL, v_admin),

    (v_t_4_2, v_tenant_id, v_project_id, v_ms_uat, NULL, 1,
     'Address feedback + rework',
     'Fix flagged batches + resubmit for approval.',
     'TODO', 0, 40,
     '2026-11-20', '2026-11-25', NULL, NULL,
     v_employee, v_t_4_1, 5000000, v_admin),

    (v_t_4_3, v_tenant_id, v_project_id, v_ms_uat, NULL, 2,
     'Handover documentation',
     'Runbook, schema doc, retraining playbook.',
     'TODO', 0, 20,
     '2026-11-25', '2026-11-27', NULL, NULL,
     v_pm, v_t_4_2, NULL, v_admin);

  RAISE NOTICE 'WBS seed applied — 23 tasks across 4 milestones for KIRA-DA.';
END $$;

-- Summary check
SELECT
  m.seq            AS milestone,
  m.name           AS milestone_name,
  COUNT(t.id)      AS task_count,
  ROUND(AVG(t.progress_pct)::numeric, 1) AS avg_progress
FROM public.project_milestones m
LEFT JOIN public.project_tasks t
  ON t.milestone_id = m.id
WHERE m.project_id = '33333333-1111-4111-8111-444444444444'
GROUP BY m.seq, m.name
ORDER BY m.seq;
