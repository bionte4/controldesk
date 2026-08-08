-- Migration: 0062_performance_evaluations_pkwt.sql
-- Purpose : Align evaluations with the PKWT (fixed-term contract) form used
--           in-country: adds period + narrative + external-metric fields
--           to `performance_evaluations`, and seeds a 10-aspect template
--           mirroring the "Manajemen Pekerjaan" section.
--
-- Rollback :
--   alter table public.performance_evaluations
--     drop column if exists period_start_date,
--     drop column if exists period_end_date,
--     drop column if exists strengths,
--     drop column if exists dev_areas,
--     drop column if exists dev_proposal,
--     drop column if exists goal_achievement_pct,
--     drop column if exists competency_meet_pct;

alter table public.performance_evaluations
  add column if not exists period_start_date date,
  add column if not exists period_end_date   date,
  -- "Aspek yang menjadi kekuatan" / "Aspek yang perlu dikembangkan" /
  -- "Usulan pengembangan" — mirror the narrative sections of the PKWT
  -- form. Kept nullable because early-cycle evaluations often skip them
  -- while the SPV is still building context.
  add column if not exists strengths     text,
  add column if not exists dev_areas     text,
  add column if not exists dev_proposal  text,
  -- Manual entry — matches "Pencapaian Goal" and "Kompetensi" that live
  -- outside ControlDesk (HC Cloud in the sample form). Server refuses
  -- values outside 0-100 via check constraint.
  add column if not exists goal_achievement_pct numeric(5,2),
  add column if not exists competency_meet_pct  numeric(5,2);

-- Add range constraints only if they don't exist yet.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'performance_evaluations_goal_pct_range'
  ) then
    alter table public.performance_evaluations
      add constraint performance_evaluations_goal_pct_range
        check (goal_achievement_pct is null
               or (goal_achievement_pct >= 0 and goal_achievement_pct <= 100));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'performance_evaluations_competency_pct_range'
  ) then
    alter table public.performance_evaluations
      add constraint performance_evaluations_competency_pct_range
        check (competency_meet_pct is null
               or (competency_meet_pct >= 0 and competency_meet_pct <= 100));
  end if;
end $$;

comment on column public.performance_evaluations.period_start_date is
  'Evaluation period start (usually the start of the quarter under review).';
comment on column public.performance_evaluations.period_end_date is
  'Evaluation period end (usually the last day of the quarter under review).';
comment on column public.performance_evaluations.strengths is
  'PKWT "Aspek yang menjadi kekuatan" — free-form summary of strong points.';
comment on column public.performance_evaluations.dev_areas is
  'PKWT "Aspek yang perlu dikembangkan" — free-form summary of gaps.';
comment on column public.performance_evaluations.dev_proposal is
  'PKWT "Usulan pengembangan" — coaching / training proposal.';
comment on column public.performance_evaluations.goal_achievement_pct is
  'External goal achievement percentage (0-100). Manual entry — sourced from HC Cloud in the sample form.';
comment on column public.performance_evaluations.competency_meet_pct is
  'External competency-met percentage (0-100). Manual entry — sourced from HC Cloud in the sample form.';

-- ---------------------------------------------------------------------
-- Seed the "Evaluasi Triwulanan PKWT" template with 10 aspects mirroring
-- the sample form. Idempotent — skipped when a template with the same
-- name already exists for the demo tenant.
-- ---------------------------------------------------------------------
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

  -- 10 aspects × 10% weight each = 100 total.
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
      'Sejauh mana karyawan dapat menjalin hubungan baik dengan sesama karyawan. Pertimbangkan kepekaan, sopan santun, dan efektivitas komunikasi ketika berinteraksi dengan rekan kerja / atasan / bawahan / pelanggan.',
      10, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 6, 'Kehadiran dan kedisiplinan',
      'Sejauh mana karyawan dapat hadir tepat waktu dan menunjukkan kedisiplinan konsisten, serta selalu menginformasikan atasan langsung ketika terlambat / berhalangan.',
      10, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 7, 'Inisiatif dan kreativitas',
      'Sejauh mana karyawan mampu mengelola pengerjaan tugasnya secara mandiri dan menerapkan metode kreatif dalam mencapai target.',
      10, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 8, 'Keterbukaan untuk belajar dan berkembang',
      'Sejauh mana karyawan menunjukkan kemampuan dan kesiapan menerima tugas / tanggung jawab baru yang lebih kompleks.',
      10, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 9, 'Kemampuan berkomunikasi',
      'Sejauh mana karyawan dapat menyampaikan ide atau pendapat secara efektif (lisan, tertulis, verbal, non-verbal).',
      10, 'SCORE_1_5', true),
    (v_tenant_id, v_template_id, 10, 'Kemampuan mengambil keputusan dan menyelesaikan masalah',
      'Sejauh mana karyawan dapat mengelola prioritas pekerjaan secara efektif, mempertimbangkan situasi / resiko sebelum bertindak.',
      10, 'SCORE_1_5', true);
end $$;
