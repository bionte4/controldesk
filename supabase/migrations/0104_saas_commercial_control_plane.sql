-- ControlDesk — SaaS commercial control plane (business plan phases 1–5).
-- Keeps technical tenant access, subscription, onboarding, and health as
-- independent dimensions. Billing remains manual; no payment provider.

do $$ begin
  create type public.tenant_commercial_stage as enum
    ('lead', 'qualified', 'trial', 'pilot', 'customer', 'churned');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.tenant_onboarding_status as enum
    ('new', 'configuring', 'activated', 'stalled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.tenant_subscription_status as enum
    ('trialing', 'active', 'past_due', 'canceled', 'expired');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.tenant_health_status as enum
    ('healthy', 'attention', 'at_risk');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.tenant_access_mode as enum
    ('full', 'read_only', 'suspended', 'terminated');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.manual_invoice_status as enum
    ('draft', 'issued', 'paid', 'overdue', 'void');
exception when duplicate_object then null; end $$;

create table if not exists public.saas_plans (
  code text primary key,
  name text not null,
  description text,
  is_active boolean not null default true,
  base_price_idr bigint not null default 0 check (base_price_idr >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.saas_plans (code, name, description, base_price_idr) values
  ('trial', 'Trial', 'Self-service evaluation', 0),
  ('field_control', 'Field Control', 'Cash advance, settlement, and approvals', 5000000),
  ('project_margin', 'Project Margin', 'Field control plus project profitability', 10000000),
  ('service_governance', 'Service Governance', 'SLA, portal, integrations, and governance', 18000000),
  ('custom', 'Custom', 'Contract-defined enterprise package', 0)
on conflict (code) do nothing;

create table if not exists public.saas_plan_entitlements (
  plan_code text not null references public.saas_plans(code) on delete cascade,
  capability_key text not null,
  enabled boolean not null default true,
  limit_value bigint check (limit_value is null or limit_value >= 0),
  unit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_code, capability_key)
);

insert into public.saas_plan_entitlements
  (plan_code, capability_key, enabled, limit_value, unit) values
  ('trial', 'active_users', true, 10, 'users'),
  ('trial', 'active_projects', true, 2, 'projects'),
  ('trial', 'storage_mb', true, 250, 'MB'),
  ('trial', 'wbs_gantt', true, null, null),
  ('trial', 'bulk_import', true, null, null),
  ('field_control', 'active_users', true, 30, 'users'),
  ('field_control', 'active_projects', true, 10, 'projects'),
  ('field_control', 'storage_mb', true, 2048, 'MB'),
  ('field_control', 'wbs_gantt', true, null, null),
  ('field_control', 'bulk_import', true, null, null),
  ('project_margin', 'active_users', true, 100, 'users'),
  ('project_margin', 'active_projects', true, 50, 'projects'),
  ('project_margin', 'portal_users', true, 25, 'users'),
  ('project_margin', 'storage_mb', true, 10240, 'MB'),
  ('project_margin', 'wbs_gantt', true, null, null),
  ('project_margin', 'bulk_import', true, null, null),
  ('project_margin', 'advanced_reports', true, null, null),
  ('service_governance', 'active_users', true, 250, 'users'),
  ('service_governance', 'active_projects', true, 150, 'projects'),
  ('service_governance', 'portal_users', true, 100, 'users'),
  ('service_governance', 'storage_mb', true, 51200, 'MB'),
  ('service_governance', 'wbs_gantt', true, null, null),
  ('service_governance', 'bulk_import', true, null, null),
  ('service_governance', 'advanced_reports', true, null, null),
  ('service_governance', 'ai_insights', true, null, null),
  ('service_governance', 'ai_chatbot_tools', true, null, null),
  ('service_governance', 'google_calendar_sync', true, 1, 'connections'),
  ('service_governance', 'telegram_bot', true, 1, 'connections'),
  ('service_governance', 'whatsapp_notifications', true, 1, 'connections')
on conflict (plan_code, capability_key) do nothing;

create table if not exists public.tenant_commercial_profiles (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  stage public.tenant_commercial_stage not null default 'trial',
  industry_segment text,
  acquisition_source text,
  sales_owner text,
  customer_success_owner text,
  economic_buyer_name text,
  economic_buyer_email citext,
  champion_name text,
  champion_email citext,
  engineer_count integer check (engineer_count is null or engineer_count >= 0),
  estimated_active_projects integer check (estimated_active_projects is null or estimated_active_projects >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_onboarding (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  status public.tenant_onboarding_status not null default 'new',
  pilot_start_date date,
  pilot_end_date date,
  decision_date date,
  baseline jsonb not null default '{}'::jsonb,
  success_criteria jsonb not null default '[]'::jsonb,
  checklist jsonb not null default '{"kickoff":false,"master_data":false,"users_invited":false,"approval_configured":false,"project_setup":false,"training":false,"first_live_transaction":false}'::jsonb,
  blocker text,
  technical_activated_at timestamptz,
  business_activated_at timestamptz,
  last_reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint tenant_onboarding_pilot_dates check
    (pilot_end_date is null or pilot_start_date is null or pilot_end_date >= pilot_start_date)
);

create table if not exists public.tenant_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_code text not null references public.saas_plans(code),
  status public.tenant_subscription_status not null default 'trialing',
  billing_interval text not null default 'annual' check (billing_interval in ('monthly','quarterly','annual','one_time')),
  recurring_price_idr bigint not null default 0 check (recurring_price_idr >= 0),
  implementation_fee_idr bigint not null default 0 check (implementation_fee_idr >= 0),
  contract_start_date date,
  contract_end_date date,
  renewal_date date,
  auto_renew boolean not null default false,
  payment_terms_days integer not null default 30 check (payment_terms_days between 0 and 365),
  grace_ends_at timestamptz,
  read_only_at timestamptz,
  suspend_at timestamptz,
  canceled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_subscription_contract_dates check
    (contract_end_date is null or contract_start_date is null or contract_end_date >= contract_start_date)
);
create unique index if not exists tenant_subscriptions_one_current_idx
  on public.tenant_subscriptions(tenant_id)
  where status in ('trialing','active','past_due');
create index if not exists tenant_subscriptions_renewal_idx
  on public.tenant_subscriptions(renewal_date) where renewal_date is not null;

create table if not exists public.tenant_entitlement_overrides (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  capability_key text not null,
  enabled boolean,
  limit_value bigint check (limit_value is null or limit_value >= 0),
  reason text not null,
  expires_at timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, capability_key)
);

create table if not exists public.tenant_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  status public.tenant_health_status not null,
  score smallint not null check (score between 0 and 100),
  reasons jsonb not null default '[]'::jsonb,
  activity_14d integer not null default 0,
  active_user_ratio numeric(5,2),
  open_support_issues integer not null default 0,
  sponsor_reviewed_at timestamptz,
  calculated_at timestamptz not null default now(),
  calculated_by text not null default 'rules'
);
create index if not exists tenant_health_latest_idx
  on public.tenant_health_snapshots(tenant_id, calculated_at desc);

create table if not exists public.tenant_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid references public.tenant_subscriptions(id) on delete set null,
  invoice_number text not null unique,
  status public.manual_invoice_status not null default 'draft',
  amount_idr bigint not null check (amount_idr >= 0),
  issued_at date,
  due_at date,
  paid_at timestamptz,
  payment_reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace view public.tenant_current_usage as
select t.id as tenant_id,
  (select count(*) from public.employees e where e.tenant_id=t.id and e.is_active) as active_users,
  (select count(*) from public.projects p where p.tenant_id=t.id and p.status in ('PLANNING','ACTIVE')) as active_projects,
  (select count(*) from public.client_users cu where cu.tenant_id=t.id and cu.status = 'ACTIVE') as portal_users,
  (select count(*) from public.cash_advances ca where ca.tenant_id=t.id) as cash_advances_total
from public.tenants t;

create or replace function public.resolve_tenant_access_by_slug(p_slug text)
returns public.tenant_access_mode
language sql security definer stable set search_path = public
as $$
  select case
    when t.status = 'terminated' then 'terminated'::public.tenant_access_mode
    when t.status = 'suspended' then 'suspended'::public.tenant_access_mode
    when s.suspend_at is not null and s.suspend_at <= now() then 'suspended'::public.tenant_access_mode
    when s.read_only_at is not null and s.read_only_at <= now() then 'read_only'::public.tenant_access_mode
    when s.status in ('canceled','expired') and coalesce(s.grace_ends_at, now()) <= now() then 'read_only'::public.tenant_access_mode
    when s.status = 'past_due' and s.grace_ends_at is not null and s.grace_ends_at <= now() then 'read_only'::public.tenant_access_mode
    else 'full'::public.tenant_access_mode end
  from public.tenants t
  left join lateral (
    select * from public.tenant_subscriptions x
    where x.tenant_id=t.id order by x.created_at desc limit 1
  ) s on true
  where t.slug=p_slug limit 1;
$$;
grant execute on function public.resolve_tenant_access_by_slug(text) to anon, authenticated, service_role;

create or replace function public.resolve_tenant_entitlement(p_tenant uuid, p_capability text)
returns table(enabled boolean, limit_value bigint)
language sql security definer stable set search_path = public
as $$
  with current_plan as (
    select coalesce(s.plan_code,
      case t.plan when 'starter' then 'field_control' when 'pro' then 'project_margin'
        when 'enterprise' then 'service_governance' else 'trial' end) plan_code
    from public.tenants t left join lateral (
      select x.plan_code from public.tenant_subscriptions x
      where x.tenant_id=t.id order by x.created_at desc limit 1
    ) s on true where t.id=p_tenant
  ), base as (
    select e.enabled, e.limit_value from current_plan cp
    left join public.saas_plan_entitlements e
      on e.plan_code=cp.plan_code and e.capability_key=p_capability
  ), override_row as (
    select o.enabled, o.limit_value from public.tenant_entitlement_overrides o
    where o.tenant_id=p_tenant and o.capability_key=p_capability
      and (o.expires_at is null or o.expires_at > now())
  )
  select coalesce(o.enabled, b.enabled, false), coalesce(o.limit_value, b.limit_value)
  from base b left join override_row o on true;
$$;
grant execute on function public.resolve_tenant_entitlement(uuid,text) to authenticated, service_role;

-- Platform control-plane tables are service-role only. Tenant users receive
-- entitlements only through the narrow resolver above.
alter table public.saas_plans enable row level security;
alter table public.saas_plan_entitlements enable row level security;
alter table public.tenant_commercial_profiles enable row level security;
alter table public.tenant_onboarding enable row level security;
alter table public.tenant_subscriptions enable row level security;
alter table public.tenant_entitlement_overrides enable row level security;
alter table public.tenant_health_snapshots enable row level security;
alter table public.tenant_invoices enable row level security;

do $$ declare tbl text; begin
  foreach tbl in array array['saas_plans','saas_plan_entitlements','tenant_commercial_profiles','tenant_onboarding','tenant_subscriptions','tenant_entitlement_overrides','tenant_health_snapshots','tenant_invoices'] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', tbl, tbl);
    if tbl <> 'tenant_health_snapshots' then
      execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', tbl, tbl);
    end if;
  end loop;
end $$;

-- Backfill every existing tenant into a usable control-plane state.
insert into public.tenant_commercial_profiles (tenant_id, stage)
select id, case when plan='trial' then 'trial' else 'customer' end::public.tenant_commercial_stage
from public.tenants on conflict (tenant_id) do nothing;
insert into public.tenant_onboarding (tenant_id)
select id from public.tenants on conflict (tenant_id) do nothing;
insert into public.tenant_subscriptions
  (tenant_id, plan_code, status, contract_start_date, contract_end_date, grace_ends_at, read_only_at, suspend_at)
select id,
  case plan when 'starter' then 'field_control' when 'pro' then 'project_margin'
    when 'enterprise' then 'service_governance' else 'trial' end,
  case when plan='trial' then 'trialing' else 'active' end::public.tenant_subscription_status,
  created_at::date, trial_ends_at::date,
  case when trial_ends_at is not null then trial_ends_at + interval '7 days' end,
  trial_ends_at,
  case when trial_ends_at is not null then trial_ends_at + interval '7 days' end
from public.tenants t
where not exists (select 1 from public.tenant_subscriptions s where s.tenant_id=t.id);

-- Provisioning paths (CLI, Super Admin, self-signup) continue to write only
-- public.tenants. These triggers attach the commercial defaults so future
-- tenants cannot bypass trial lifecycle or entitlement enforcement.
create or replace function public.seed_tenant_commercial_control()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.tenant_commercial_profiles (tenant_id, stage)
  values (new.id, case when new.plan='trial' then 'trial' else 'customer' end::public.tenant_commercial_stage)
  on conflict (tenant_id) do nothing;
  insert into public.tenant_onboarding (tenant_id) values (new.id)
  on conflict (tenant_id) do nothing;
  insert into public.tenant_subscriptions
    (tenant_id, plan_code, status, contract_start_date, contract_end_date, grace_ends_at, read_only_at, suspend_at)
  values (
    new.id,
    case new.plan when 'starter' then 'field_control' when 'pro' then 'project_margin'
      when 'enterprise' then 'service_governance' else 'trial' end,
    case when new.plan='trial' then 'trialing' else 'active' end::public.tenant_subscription_status,
    new.created_at::date, new.trial_ends_at::date,
    case when new.trial_ends_at is not null then new.trial_ends_at + interval '7 days' end,
    new.trial_ends_at,
    case when new.trial_ends_at is not null then new.trial_ends_at + interval '7 days' end
  ) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists tenants_seed_commercial_control on public.tenants;
create trigger tenants_seed_commercial_control
  after insert on public.tenants for each row execute function public.seed_tenant_commercial_control();

create or replace function public.sync_trial_subscription_from_tenant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.plan='trial' then
    update public.tenant_subscriptions set
      contract_end_date=new.trial_ends_at::date,
      grace_ends_at=case when new.trial_ends_at is not null then new.trial_ends_at + interval '7 days' end,
      read_only_at=new.trial_ends_at,
      suspend_at=case when new.trial_ends_at is not null then new.trial_ends_at + interval '7 days' end,
      updated_at=now()
    where tenant_id=new.id and status='trialing';
  end if;
  return new;
end;
$$;
drop trigger if exists tenants_sync_trial_subscription on public.tenants;
create trigger tenants_sync_trial_subscription
  after update of plan, trial_ends_at on public.tenants
  for each row execute function public.sync_trial_subscription_from_tenant();

comment on function public.resolve_tenant_access_by_slug(text) is
  'Returns commercial access mode independently from tenant technical status; proxy blocks mutations in read_only mode.';
comment on function public.resolve_tenant_entitlement(uuid,text) is
  'Resolves effective package entitlement plus time-bound tenant override.';
