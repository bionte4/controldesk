-- Migration: 0059_performance_evaluations.sql
-- Purpose : Introduce performance evaluations for non-permanent
--           employees (rules §6, §12 HR). Slice A of the eval module.
--
-- Workflow: SPV/Team Lead files evaluation → PM reviews (+ coaching) →
--           OM approves. HR keeps templates as master data.
--
-- Confidentiality: evaluation rows are NOT visible to the evaluated
-- employee — RLS grants SELECT only to SPV / PM / OM / HR / Admin.
--
-- Rollback :
--   drop table if exists public.evaluation_answers cascade;
--   drop table if exists public.performance_evaluations cascade;
--   drop table if exists public.evaluation_template_items cascade;
--   drop table if exists public.evaluation_templates cascade;
--   drop type if exists public.evaluation_question_type;
--   drop type if exists public.contract_recommendation;
--   drop type if exists public.evaluation_status;

do $$ begin
  create type public.evaluation_status as enum (
    'DRAFT',
    'SUBMITTED_BY_SPV',
    'REVIEWED_BY_PM',
    'RETURNED_TO_SPV',
    'APPROVED_BY_OM',
    'REJECTED_BY_OM',
    'FINALIZED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.contract_recommendation as enum (
    'EXTEND',
    'NOT_EXTEND',
    'EXTEND_WITH_COACHING'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.evaluation_question_type as enum (
    'SCORE_1_5',
    'TEXT'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Templates (HR master data)
-- ---------------------------------------------------------------------
create table if not exists public.evaluation_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists evaluation_templates_tenant_idx
  on public.evaluation_templates (tenant_id, is_active, name);

create table if not exists public.evaluation_template_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  template_id uuid not null references public.evaluation_templates(id) on delete cascade,
  seq int not null,
  name text not null,
  description text,
  weight_pct numeric(5, 2) not null default 0
    check (weight_pct >= 0 and weight_pct <= 100),
  question_type public.evaluation_question_type not null default 'SCORE_1_5',
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (template_id, seq)
);
create index if not exists evaluation_template_items_tpl_idx
  on public.evaluation_template_items (tenant_id, template_id, seq);

-- ---------------------------------------------------------------------
-- Evaluations (SPV → PM → OM workflow)
-- ---------------------------------------------------------------------
create table if not exists public.performance_evaluations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  template_id uuid not null references public.evaluation_templates(id) on delete restrict,
  contract_end_date date not null,
  spv_employee_id uuid not null references public.employees(id) on delete set null,
  pm_employee_id uuid references public.employees(id) on delete set null,
  om_employee_id uuid references public.employees(id) on delete set null,
  -- Aggregated score (0-100). Auto-computed via trigger from answers.
  total_score numeric(6, 2),
  spv_recommendation public.contract_recommendation,
  spv_notes text,
  pm_notes text,
  om_notes text,
  status public.evaluation_status not null default 'DRAFT',
  submitted_at timestamptz,
  pm_reviewed_at timestamptz,
  om_decided_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists performance_evaluations_tenant_idx
  on public.performance_evaluations (tenant_id, status, contract_end_date);
create index if not exists performance_evaluations_employee_idx
  on public.performance_evaluations (tenant_id, employee_id);
create index if not exists performance_evaluations_spv_pending_idx
  on public.performance_evaluations (tenant_id, spv_employee_id, status)
  where status in ('DRAFT', 'RETURNED_TO_SPV');
create index if not exists performance_evaluations_pm_pending_idx
  on public.performance_evaluations (tenant_id, pm_employee_id, status)
  where status = 'SUBMITTED_BY_SPV';
create index if not exists performance_evaluations_om_pending_idx
  on public.performance_evaluations (tenant_id, status)
  where status = 'REVIEWED_BY_PM';

comment on table public.performance_evaluations is
  'Performance evaluation cycle for non-permanent employees. SPV drafts, PM reviews, OM decides. Not visible to the evaluated employee (RLS).';

create table if not exists public.evaluation_answers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  evaluation_id uuid not null references public.performance_evaluations(id) on delete cascade,
  item_id uuid not null references public.evaluation_template_items(id) on delete restrict,
  numeric_score int check (numeric_score is null or (numeric_score between 1 and 5)),
  text_answer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (evaluation_id, item_id)
);
create index if not exists evaluation_answers_eval_idx
  on public.evaluation_answers (tenant_id, evaluation_id);

-- ---------------------------------------------------------------------
-- Auto-recompute total_score whenever answers change.
-- Weighted by item.weight_pct; skips TEXT items and null scores.
-- ---------------------------------------------------------------------
create or replace function public.recompute_evaluation_total_score()
returns trigger
language plpgsql
as $fn$
declare
  v_eval_id uuid;
  v_total numeric(6, 2);
begin
  v_eval_id := coalesce(new.evaluation_id, old.evaluation_id);
  select coalesce(
    sum(a.numeric_score * i.weight_pct) / nullif(sum(i.weight_pct), 0) * 20,
    0
  )
    into v_total
    from public.evaluation_answers a
    join public.evaluation_template_items i on i.id = a.item_id
   where a.evaluation_id = v_eval_id
     and i.question_type = 'SCORE_1_5'
     and a.numeric_score is not null;

  update public.performance_evaluations
     set total_score = v_total,
         updated_at = now()
   where id = v_eval_id;

  return coalesce(new, old);
end;
$fn$;

drop trigger if exists trg_recompute_eval_score on public.evaluation_answers;
create trigger trg_recompute_eval_score
after insert or update or delete on public.evaluation_answers
for each row execute function public.recompute_evaluation_total_score();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.evaluation_templates enable row level security;
alter table public.evaluation_template_items enable row level security;
alter table public.performance_evaluations enable row level security;
alter table public.evaluation_answers enable row level security;

-- Helper: caller is HR / Admin / OM (management view all evals).
create or replace function public.is_hr_or_management()
returns boolean
language sql
stable
as $fn$
  select exists (
    select 1 from public.employees e
    where e.user_id = auth.uid()
      and e.role in (
        'TENANT_ADMIN', 'HEAD_MANAGER', 'OPERATIONS_MANAGER', 'HR_ADMIN'
      )
  );
$fn$;

-- Templates + items — any authenticated user in the tenant can read
-- (needed to render SPV form). Write restricted to HR / Admin.
create policy evaluation_templates_read on public.evaluation_templates
  for select using (
    tenant_id = current_tenant_id()
  );
create policy evaluation_templates_write on public.evaluation_templates
  for all using (
    tenant_id = current_tenant_id() and public.is_hr_or_management()
  ) with check (
    tenant_id = current_tenant_id() and public.is_hr_or_management()
  );

create policy evaluation_template_items_read on public.evaluation_template_items
  for select using (
    tenant_id = current_tenant_id()
  );
create policy evaluation_template_items_write on public.evaluation_template_items
  for all using (
    tenant_id = current_tenant_id() and public.is_hr_or_management()
  ) with check (
    tenant_id = current_tenant_id() and public.is_hr_or_management()
  );

-- Evaluations — the evaluated employee is *excluded*. Visibility to:
--   * The SPV / PM / OM referenced on the row.
--   * HR / Admin / OM (any).
create policy performance_evaluations_read on public.performance_evaluations
  for select using (
    tenant_id = current_tenant_id() and (
      public.is_hr_or_management()
      or spv_employee_id in (select id from public.employees where user_id = auth.uid())
      or pm_employee_id in (select id from public.employees where user_id = auth.uid())
      or om_employee_id in (select id from public.employees where user_id = auth.uid())
    )
  );

create policy performance_evaluations_write on public.performance_evaluations
  for all using (
    tenant_id = current_tenant_id() and (
      public.is_hr_or_management()
      or spv_employee_id in (select id from public.employees where user_id = auth.uid())
      or pm_employee_id in (select id from public.employees where user_id = auth.uid())
    )
  ) with check (
    tenant_id = current_tenant_id()
  );

create policy evaluation_answers_read on public.evaluation_answers
  for select using (
    tenant_id = current_tenant_id() and exists (
      select 1 from public.performance_evaluations pe
      where pe.id = evaluation_id
        and pe.tenant_id = current_tenant_id()
        and (
          public.is_hr_or_management()
          or pe.spv_employee_id in (select id from public.employees where user_id = auth.uid())
          or pe.pm_employee_id in (select id from public.employees where user_id = auth.uid())
          or pe.om_employee_id in (select id from public.employees where user_id = auth.uid())
        )
    )
  );
create policy evaluation_answers_write on public.evaluation_answers
  for all using (
    tenant_id = current_tenant_id() and exists (
      select 1 from public.performance_evaluations pe
      where pe.id = evaluation_id
        and pe.tenant_id = current_tenant_id()
        and (
          public.is_hr_or_management()
          or pe.spv_employee_id in (select id from public.employees where user_id = auth.uid())
        )
    )
  ) with check (tenant_id = current_tenant_id());

-- ---------------------------------------------------------------------
-- Notification kinds
-- ---------------------------------------------------------------------
do $$ begin
  alter type public.notification_kind add value if not exists 'EVALUATION_DUE';
  alter type public.notification_kind add value if not exists 'EVALUATION_SUBMITTED';
  alter type public.notification_kind add value if not exists 'EVALUATION_REVIEWED';
  alter type public.notification_kind add value if not exists 'EVALUATION_RETURNED';
  alter type public.notification_kind add value if not exists 'EVALUATION_APPROVED';
  alter type public.notification_kind add value if not exists 'EVALUATION_REJECTED';
  alter type public.notification_kind add value if not exists 'EVALUATION_FINALIZED';
exception when others then null; end $$;
