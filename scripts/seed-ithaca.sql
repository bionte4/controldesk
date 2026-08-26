-- Provision a complete local/demo workspace for PT Ithaca Resources.
-- Idempotent: safe to re-run. The accounts use a reserved `.test` domain
-- and one shared development password; replace them with Invite User in prod.

begin;

do $$
declare
  v_tenant uuid;
  v_demo uuid;
  v_admin uuid;
  v_gm uuid;
  v_pm uuid;
  v_spv uuid;
  v_fin uuid;
  v_hr uuid;
  v_emp uuid;
  v_client_berau uuid;
  v_client_wahau uuid;
  v_project_berau uuid;
  v_project_wahau uuid;
  v_account record;
  v_user uuid;
  v_manager uuid;
  v_password text := 'Ithaca#2026';
begin
  insert into public.tenants
    (slug, name, timezone, status, plan, provisioned_via)
  values
    ('ithaca', 'PT Ithaca Resources', 'Asia/Jakarta', 'active', 'enterprise', 'seed')
  on conflict (slug) do update
    set name = excluded.name,
        timezone = excluded.timezone,
        status = excluded.status,
        plan = excluded.plan
  returning id into v_tenant;

  perform public.seed_default_coa(v_tenant);

  -- Use role labels as names so this dev seed never impersonates real staff.
  for v_account in
    select * from (values
      ('ControlDesk Administrator', 'admin@ithaca-resources.test', 'TENANT_ADMIN', 'Administration', 'System Administrator'),
      ('General Manager', 'gm@ithaca-resources.test', 'GENERAL_MANAGER', 'Management', 'General Manager'),
      ('Project Manager', 'pm@ithaca-resources.test', 'PROJECT_MANAGER', 'Operations', 'Project Manager'),
      ('Site Supervisor', 'supervisor@ithaca-resources.test', 'SUPERVISOR', 'Operations', 'Site Supervisor'),
      ('Operations Manager', 'operations.manager@ithaca-resources.test', 'OPERATIONS_MANAGER', 'Operations', 'Operations Manager'),
      ('Head Manager', 'head.manager@ithaca-resources.test', 'HEAD_MANAGER', 'Management', 'Head Manager'),
      ('Petty Cash Custodian', 'petty.cash@ithaca-resources.test', 'PETTY_CASH_CUSTODIAN', 'Finance', 'Petty Cash Custodian'),
      ('Finance Lead', 'finance@ithaca-resources.test', 'LEAD_FINANCE', 'Finance', 'Finance Lead'),
      ('HR Administrator', 'hr@ithaca-resources.test', 'HR_ADMIN', 'Human Resources', 'HR Administrator'),
      ('Field Employee', 'employee@ithaca-resources.test', 'EMPLOYEE', 'Operations', 'Field Employee'),
      ('Legacy Admin', 'legacy.admin@ithaca-resources.test', 'ADMIN', 'Administration', 'Legacy Admin'),
      ('Director', 'director@ithaca-resources.test', 'DIRECTOR', 'Management', 'Director'),
      ('Finance Officer', 'finance.officer@ithaca-resources.test', 'FINANCE', 'Finance', 'Finance Officer'),
      ('Legacy Project Manager', 'legacy.pm@ithaca-resources.test', 'PM', 'Operations', 'Legacy Project Manager'),
      ('Legacy Operations Manager', 'legacy.om@ithaca-resources.test', 'OM', 'Operations', 'Legacy Operations Manager')
    ) as a(full_name, email, employee_role, department, position_title)
  loop
    select id into v_user from auth.users where email = v_account.email limit 1;
    if v_user is null then
      v_user := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change,
        email_change_token_new, recovery_token
      ) values (
        '00000000-0000-0000-0000-000000000000', v_user,
        'authenticated', 'authenticated', v_account.email,
        crypt(v_password, gen_salt('bf')), now(),
        jsonb_build_object('provider', 'email', 'providers', array['email']),
        jsonb_build_object('full_name', v_account.full_name,
          'tenant_slug', 'ithaca', 'tenant_id', v_tenant::text,
          'role', v_account.employee_role),
        now(), now(), '', '', '', ''
      );
      insert into auth.identities
        (provider_id, user_id, identity_data, provider,
         last_sign_in_at, created_at, updated_at)
      values
        (v_user::text, v_user,
         jsonb_build_object('sub', v_user::text, 'email', v_account.email,
           'email_verified', true, 'phone_verified', false),
         'email', null, now(), now());
    end if;

    select case v_account.employee_role
      when 'TENANT_ADMIN' then null
      when 'GENERAL_MANAGER' then v_admin
      when 'PROJECT_MANAGER' then v_gm
      when 'SUPERVISOR' then v_pm
      else v_gm end into v_manager;

    insert into public.employees
      (tenant_id, user_id, role, reports_to_employee_id, full_name, email,
       department, position_title, employment_type, join_date,
       availability, is_active)
    values
      (v_tenant, v_user, v_account.employee_role::public.employee_role,
       v_manager, v_account.full_name, v_account.email,
       v_account.department, v_account.position_title, 'PERMANENT',
       current_date - interval '365 days', 'AVAILABLE', true)
    on conflict (tenant_id, email) do update
      set user_id = excluded.user_id, role = excluded.role,
          reports_to_employee_id = excluded.reports_to_employee_id,
          department = excluded.department,
          position_title = excluded.position_title, is_active = true
    returning id into v_user;

    case v_account.employee_role
      when 'TENANT_ADMIN' then v_admin := v_user;
      when 'GENERAL_MANAGER' then v_gm := v_user;
      when 'PROJECT_MANAGER' then v_pm := v_user;
      when 'SUPERVISOR' then v_spv := v_user;
      when 'LEAD_FINANCE' then v_fin := v_user;
      when 'HR_ADMIN' then v_hr := v_user;
      when 'EMPLOYEE' then v_emp := v_user;
      else null;
    end case;
  end loop;

  -- Copy the standard lookup catalog from demo without copying workflow data.
  select id into v_demo from public.tenants where slug = 'demo';
  if v_demo is not null then
    insert into public.lookup_options
      (tenant_id, domain, code, label, sort_order, is_active)
    select v_tenant, domain, code, label, sort_order, is_active
    from public.lookup_options source
    where source.tenant_id = v_demo
      and not exists (
        select 1 from public.lookup_options target
        where target.tenant_id = v_tenant
          and target.domain = source.domain and target.code = source.code
      );
  end if;

  select id into v_client_berau from public.clients
  where tenant_id = v_tenant and name = 'Berau Mining Cluster' limit 1;
  if v_client_berau is null then
    insert into public.clients
      (tenant_id, name, industry, contact_name, contact_email, contact_phone, status, onboarded_at)
    values
      (v_tenant, 'Berau Mining Cluster', 'Coal Mining', 'Berau Operations Desk',
       'berau.operations@ithaca-resources.test', '+62 21 8086 9600', 'ACTIVE', now())
    returning id into v_client_berau;
  end if;

  select id into v_client_wahau from public.clients
  where tenant_id = v_tenant and name = 'Wahau Mining Cluster' limit 1;
  if v_client_wahau is null then
    insert into public.clients
      (tenant_id, name, industry, contact_name, contact_email, contact_phone, status, onboarded_at)
    values
      (v_tenant, 'Wahau Mining Cluster', 'Coal Mining', 'Wahau Operations Desk',
       'wahau.operations@ithaca-resources.test', '+62 21 8086 9600', 'ACTIVE', now())
    returning id into v_client_wahau;
  end if;

  insert into public.projects
    (tenant_id, client_id, code, name, description, status, start_date,
     end_date, project_type, priority, location, contract_value, currency, created_by)
  values
    (v_tenant, v_client_berau, 'ITH-BERAU-2026', 'Berau Operations Program',
     'ControlDesk sample program for the Berau operating cluster.', 'ACTIVE',
     current_date - 30, current_date + 335, 'INTERNAL', 'HIGH',
     'Berau, Kalimantan Timur', 0, 'IDR', v_admin)
  on conflict (tenant_id, code) do update set name = excluded.name
  returning id into v_project_berau;

  insert into public.projects
    (tenant_id, client_id, code, name, description, status, start_date,
     end_date, project_type, priority, location, contract_value, currency, created_by)
  values
    (v_tenant, v_client_wahau, 'ITH-WAHAU-2026', 'Wahau Operations Program',
     'ControlDesk sample program for the Wahau operating cluster.', 'PLANNING',
     current_date, current_date + 365, 'INTERNAL', 'HIGH',
     'Kutai Timur, Kalimantan Timur', 0, 'IDR', v_admin)
  on conflict (tenant_id, code) do update set name = excluded.name
  returning id into v_project_wahau;

  insert into public.project_pm_assignments
    (tenant_id, project_id, pm_employee_id, assignment_role, status, started_at)
  values
    (v_tenant, v_project_berau, v_pm, 'PRIMARY_PM', 'ACTIVE', now()),
    (v_tenant, v_project_wahau, v_pm, 'PRIMARY_PM', 'ACTIVE', now())
  on conflict do nothing;

  insert into public.project_employee_assignments
    (tenant_id, project_id, employee_id, allocation_percentage, status, started_at, role)
  select v_tenant, v_project_berau, v_spv, 50, 'ACTIVE', now(), 'SITE_SUPERVISOR'
  where not exists (select 1 from public.project_employee_assignments
    where project_id = v_project_berau and employee_id = v_spv);
  insert into public.project_employee_assignments
    (tenant_id, project_id, employee_id, allocation_percentage, status, started_at, role)
  select v_tenant, v_project_berau, v_emp, 100, 'ACTIVE', now(), 'ENGINEER'
  where not exists (select 1 from public.project_employee_assignments
    where project_id = v_project_berau and employee_id = v_emp);
  insert into public.project_employee_assignments
    (tenant_id, project_id, employee_id, allocation_percentage, status, started_at, role)
  select v_tenant, v_project_wahau, v_spv, 50, 'ACTIVE', now(), 'SITE_SUPERVISOR'
  where not exists (select 1 from public.project_employee_assignments
    where project_id = v_project_wahau and employee_id = v_spv);

  insert into public.work_shifts
    (tenant_id, code, name, start_time, end_time, duration, shift_allowance, is_night)
  values
    (v_tenant, 'PAGI', 'Shift Pagi', '08:00', '17:00', interval '9 hours', 0, false),
    (v_tenant, 'SIANG', 'Shift Siang', '13:00', '22:00', interval '9 hours', 0, false),
    (v_tenant, 'MALAM', 'Shift Malam', '22:00', '07:00', interval '9 hours', 100000, true)
  on conflict do nothing;

  if not exists (
    select 1 from public.security_audit_logs
    where tenant_id = v_tenant and resource_name = 'tenants'
      and action_type = 'CREATE'
  ) then
    insert into public.security_audit_logs
      (tenant_id, actor_user_id, actor_employee_id, actor_role, action_type,
       resource_name, resource_id, new_values, metadata)
    select v_tenant, e.user_id, e.id, 'TENANT_ADMIN', 'CREATE', 'tenants',
      v_tenant::text,
      jsonb_build_object('slug', 'ithaca', 'name', 'PT Ithaca Resources'),
      jsonb_build_object('provisioned_by', 'seed', 'coa_seeded', true)
    from public.employees e where e.id = v_admin;
  end if;
end;
$$;

commit;

select t.slug, t.name,
  (select count(*) from public.employees e where e.tenant_id = t.id) as accounts,
  (select count(*) from public.chart_of_accounts c where c.tenant_id = t.id) as coa,
  (select count(*) from public.clients c where c.tenant_id = t.id) as clients,
  (select count(*) from public.projects p where p.tenant_id = t.id) as projects
from public.tenants t where t.slug = 'ithaca';
