-- 0088_seed_default_eval_templates.sql
--
-- Fixes a gap discovered post-Fase 6 (mirror of migration 0082 but for
-- performance-evaluation templates): the "Contract Renewal Review" +
-- "Evaluasi Triwulanan PKWT" templates only exist for the `demo` tenant
-- because `supabase/seed.sql` hard-codes `where slug='demo'`. Every
-- other tenant lands on `/hr/performance/templates` with an empty list
-- and no way to submit a new evaluation.
--
-- This migration:
--
--   1. Introduces `public.seed_default_eval_templates(p_tenant uuid)` —
--      a security-definer helper that inserts the two shipping
--      templates + all their items for one tenant. Idempotent via
--      pre-insert `not exists` checks per template so the function is
--      safe to invoke on every provisioning or manual reseed.
--
--   2. Rewrites `public.provision_tenant()` to call the helper as
--      Step 2c alongside the CoA + master-data seeds. New tenants
--      (`pnpm tenant:create`, self-signup via `complete_tenant_signup`,
--      super-admin UI) land with the templates automatically.
--
--   3. Backfills every existing tenant so pre-existing rows catch up
--      to the same state as tenants provisioned AFTER this migration
--      lands.
--
-- Rollback:
--   drop function if exists public.seed_default_eval_templates(uuid);
--   -- restore migration 0082's provision_tenant body (drop step 2c).
--   -- backfilled rows can be pruned with:
--   --   delete from public.evaluation_templates
--   --     where name in ('Contract Renewal Review', 'Evaluasi Triwulanan PKWT');

-- ---------------------------------------------------------------------
-- 1. seed_default_eval_templates(p_tenant uuid)
-- ---------------------------------------------------------------------
create or replace function public.seed_default_eval_templates(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_eid   uuid;
  v_template_id uuid;
begin
  if p_tenant is null then
    return;
  end if;

  -- Best-effort attribution: prefer a TENANT_ADMIN as the seed's
  -- "created_by" so `/hr/performance/templates` doesn't render a
  -- blank author column. When the tenant has no admin yet (e.g. a
  -- provisioning race), fall back to NULL — the FK is optional.
  select id into v_admin_eid
  from public.employees
  where tenant_id = p_tenant and role = 'TENANT_ADMIN'
  order by created_at asc
  limit 1;

  -- ---------------------------------------------------------------
  -- Template 1 — "Contract Renewal Review" (English, 7 items).
  -- ---------------------------------------------------------------
  if not exists (
    select 1 from public.evaluation_templates
    where tenant_id = p_tenant and name = 'Contract Renewal Review'
  ) then
    insert into public.evaluation_templates
      (tenant_id, name, description, is_active, created_by)
    values (
      p_tenant,
      'Contract Renewal Review',
      'Default contract-renewal evaluation form. Adjust weights as needed for your team.',
      true,
      v_admin_eid
    )
    returning id into v_template_id;

    insert into public.evaluation_template_items
      (tenant_id, template_id, seq, name, description, weight_pct, question_type, is_required)
    values
      (p_tenant, v_template_id, 1, 'Quality of work',
        'How consistently does the employee meet the quality bar for deliverables?',
        25, 'SCORE_1_5', true),
      (p_tenant, v_template_id, 2, 'Productivity & throughput',
        'Volume of tickets / milestones delivered vs. expectations.',
        20, 'SCORE_1_5', true),
      (p_tenant, v_template_id, 3, 'Reliability & discipline',
        'Attendance, timesheet compliance, adherence to SLA.',
        15, 'SCORE_1_5', true),
      (p_tenant, v_template_id, 4, 'Teamwork & communication',
        'How well the employee collaborates and communicates with peers / client.',
        15, 'SCORE_1_5', true),
      (p_tenant, v_template_id, 5, 'Initiative & ownership',
        'Ability to take ownership, propose improvements, and unblock others.',
        15, 'SCORE_1_5', true),
      (p_tenant, v_template_id, 6, 'Growth vs. previous cycle',
        'Improvement compared to the previous evaluation cycle.',
        10, 'SCORE_1_5', false),
      (p_tenant, v_template_id, 7, 'Areas for coaching',
        'Free-form notes: gaps to close, coaching plan, follow-ups.',
        0, 'TEXT', false);
  end if;

  -- ---------------------------------------------------------------
  -- Template 2 — "Evaluasi Triwulanan PKWT" (Bahasa, 10 aspek).
  -- ---------------------------------------------------------------
  if not exists (
    select 1 from public.evaluation_templates
    where tenant_id = p_tenant and name = 'Evaluasi Triwulanan PKWT'
  ) then
    insert into public.evaluation_templates
      (tenant_id, name, description, is_active, created_by)
    values (
      p_tenant,
      'Evaluasi Triwulanan PKWT',
      'Formulir baku evaluasi triwulanan untuk karyawan PKWT. Skala 1-5, komentar wajib per aspek.',
      true,
      v_admin_eid
    )
    returning id into v_template_id;

    insert into public.evaluation_template_items
      (tenant_id, template_id, seq, name, description, weight_pct, question_type, is_required)
    values
      (p_tenant, v_template_id, 1, 'Ketepatan hasil kerja dengan target dan batas waktu',
        'Sejauh mana karyawan dapat menyelesaikan pekerjaan sesuai target dan batas waktu yang telah ditetapkan.',
        10, 'SCORE_1_5', true),
      (p_tenant, v_template_id, 2, 'Kualitas pekerjaan',
        'Sejauh mana pekerjaan karyawan terselesaikan dengan baik, efektif, dan akurat.',
        10, 'SCORE_1_5', true),
      (p_tenant, v_template_id, 3, 'Pemahaman mengenai pekerjaan',
        'Sejauh mana karyawan memahami dan mengaplikasikan bagaimana dan mengapa perlu mengerjakan hal-hal yang menjadi tugasnya, sesuai peran saat ini.',
        10, 'SCORE_1_5', true),
      (p_tenant, v_template_id, 4, 'Hubungan kerja dengan atasan langsung',
        'Sejauh mana karyawan menunjukkan sikap responsif terhadap arahan atasan, serta seberapa proaktif mencari bimbingan untuk pengembangan diri.',
        10, 'SCORE_1_5', true),
      (p_tenant, v_template_id, 5, 'Kerjasama dengan karyawan lain',
        'Sejauh mana karyawan dapat menjalin hubungan baik dengan sesama karyawan.',
        10, 'SCORE_1_5', true),
      (p_tenant, v_template_id, 6, 'Kehadiran dan kedisiplinan',
        'Sejauh mana karyawan dapat hadir tepat waktu dan menunjukkan kedisiplinan konsisten.',
        10, 'SCORE_1_5', true),
      (p_tenant, v_template_id, 7, 'Inisiatif dan kreativitas',
        'Sejauh mana karyawan mampu mengelola pengerjaan tugasnya secara mandiri dan menerapkan metode kreatif.',
        10, 'SCORE_1_5', true),
      (p_tenant, v_template_id, 8, 'Keterbukaan untuk belajar dan berkembang',
        'Sejauh mana karyawan menunjukkan kemampuan dan kesiapan menerima tugas / tanggung jawab baru yang lebih kompleks.',
        10, 'SCORE_1_5', true),
      (p_tenant, v_template_id, 9, 'Kemampuan berkomunikasi',
        'Sejauh mana karyawan dapat menyampaikan ide / pendapat secara efektif (lisan, tertulis, verbal, non-verbal).',
        10, 'SCORE_1_5', true),
      (p_tenant, v_template_id, 10, 'Kemampuan mengambil keputusan dan menyelesaikan masalah',
        'Sejauh mana karyawan dapat mengelola prioritas pekerjaan secara efektif, mempertimbangkan resiko sebelum bertindak.',
        10, 'SCORE_1_5', true);
  end if;
end;
$$;

comment on function public.seed_default_eval_templates(uuid) is
  'Seeds the two shipping performance-evaluation templates '
  '("Contract Renewal Review" EN + "Evaluasi Triwulanan PKWT" ID) '
  'for one tenant. Idempotent via name-based existence checks — safe '
  'to call from provision_tenant() and manually re-run for backfill.';

revoke all on function public.seed_default_eval_templates(uuid)
  from authenticated, anon, public;

grant execute on function public.seed_default_eval_templates(uuid)
  to service_role;

-- ---------------------------------------------------------------------
-- 2. Rewrite provision_tenant() — same body as migration 0082 with a
--    new Step 2c that seeds evaluation templates. Signature and
--    audit-log payload identical, only the `metadata` JSONB gains an
--    `eval_templates_seeded` breadcrumb so callers can prove the fix
--    landed.
-- ---------------------------------------------------------------------
create or replace function public.provision_tenant(
  p_slug          text,
  p_name          text,
  p_admin_user_id uuid,
  p_admin_email   text,
  p_admin_name    text,
  p_source        text default 'ops-cli'
)
returns table (
  tenant_id   uuid,
  employee_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id   uuid;
  v_employee_id uuid;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}$' then
    raise exception 'SLUG_INVALID: slug must match ^[a-z0-9][a-z0-9-]{1,62}$'
      using errcode = 'check_violation';
  end if;

  if p_admin_user_id is null then
    raise exception 'ADMIN_USER_ID_REQUIRED: auth user must exist before provisioning'
      using errcode = 'not_null_violation';
  end if;

  if p_admin_email is null or length(trim(p_admin_email)) = 0 then
    raise exception 'ADMIN_EMAIL_REQUIRED';
  end if;

  if p_admin_name is null or length(trim(p_admin_name)) = 0 then
    raise exception 'ADMIN_NAME_REQUIRED';
  end if;

  -- Step 1: tenants row.
  insert into public.tenants (slug, name)
  values (lower(p_slug), p_name)
  returning id into v_tenant_id;

  -- Step 2a: default Chart of Accounts.
  perform public.seed_default_coa(v_tenant_id);

  -- Step 2b: default lookup master data (departments / positions /
  -- budget_category).
  perform public.seed_default_master_data(v_tenant_id);

  -- Step 2c: default performance-evaluation templates. Runs AFTER
  -- the admin employee is inserted below? No — the helper does its
  -- own best-effort admin lookup and falls back to NULL, so calling
  -- it here before Step 3 is safe. Placing it here keeps all
  -- seeding steps grouped together instead of interleaving with the
  -- employee insert.
  perform public.seed_default_eval_templates(v_tenant_id);

  -- Step 3: initial TENANT_ADMIN employees row.
  insert into public.employees (
    tenant_id, user_id, role, reports_to_employee_id,
    full_name, email, is_active
  ) values (
    v_tenant_id, p_admin_user_id, 'TENANT_ADMIN', null,
    p_admin_name, p_admin_email, true
  )
  returning id into v_employee_id;

  -- Step 3b: backfill created_by on the templates we just seeded so
  -- the /hr/performance/templates author column shows the admin who
  -- provisioned this tenant instead of NULL. Cheap update — 2 rows.
  update public.evaluation_templates
    set created_by = v_employee_id
  where tenant_id = v_tenant_id
    and created_by is null;

  -- Step 4: immutable audit trail.
  insert into public.security_audit_logs (
    tenant_id, actor_user_id, actor_employee_id, actor_role,
    action_type, resource_name, resource_id, new_values, metadata
  ) values (
    v_tenant_id,
    p_admin_user_id,
    v_employee_id,
    'TENANT_ADMIN',
    'CREATE',
    'tenants',
    v_tenant_id::text,
    jsonb_build_object(
      'slug', lower(p_slug),
      'name', p_name,
      'admin_email', p_admin_email,
      'admin_name', p_admin_name
    ),
    jsonb_build_object(
      'provisioned_by', p_source,
      'coa_seeded', true,
      'master_data_seeded', true,
      'eval_templates_seeded', true,
      'runbook', 'docs/ops/tenant-provisioning.md'
    )
  );

  tenant_id := v_tenant_id;
  employee_id := v_employee_id;
  return next;
end;
$$;

comment on function public.provision_tenant(text, text, uuid, text, text, text) is
  'Atomic tenant provisioning (rules §3). Seeds CoA, lookup master '
  'data, performance-evaluation templates, and inserts the '
  'TENANT_ADMIN employee — all in one transaction.';

revoke all on function public.provision_tenant(text, text, uuid, text, text, text)
  from authenticated, anon, public;

grant execute on function public.provision_tenant(text, text, uuid, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------
-- 3. Backfill — call seed_default_eval_templates() for every existing
--    tenant. Idempotent (skips tenants that already have the templates
--    via the not-exists checks in the helper).
-- ---------------------------------------------------------------------
do $$
declare
  t_id uuid;
begin
  for t_id in select id from public.tenants loop
    perform public.seed_default_eval_templates(t_id);
  end loop;
end $$;

-- Best-effort: fill created_by for any templates seeded above where
-- the tenant has a TENANT_ADMIN. Skip tenants without an admin —
-- the FK is optional and a subsequent login will not surface an
-- issue.
update public.evaluation_templates et
set created_by = adm.id
from (
  select distinct on (tenant_id) tenant_id, id
  from public.employees
  where role = 'TENANT_ADMIN'
  order by tenant_id, created_at asc
) adm
where et.created_by is null
  and et.tenant_id = adm.tenant_id
  and et.name in ('Contract Renewal Review', 'Evaluasi Triwulanan PKWT');
