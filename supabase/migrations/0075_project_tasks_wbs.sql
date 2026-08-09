-- ===========================================================================
-- Migration 0075 — project_tasks (WBS Work Breakdown Structure)
--
-- Introduces a hierarchical task table that sits UNDER project_milestones
-- (Phase 1 of the WBS/Gantt initiative — see `.cursorrules` §7, §17 and the
-- WBS discussion thread).
--
-- Design (Hybrid model):
--   - project_milestones (existing) = Level 1 "phase gate", weighted, rolls
--     up into `projects.progress`. Preserved as-is.
--   - project_tasks (this migration) = Level 2..N work-package tree.
--       - `parent_task_id` self-reference → recursive tree.
--       - Optional `milestone_id` anchor for Level-2 roots (so a task tree
--         can be grouped under a phase gate). Nullable so tasks may exist
--         independently for projects without a formal milestone plan.
--       - `depends_on_task_id` — simple finish-to-start dependency (single
--         predecessor). Enough for Gantt Phase 2 MVP; can be widened to a
--         join table later if we need multi-predecessor / SS / FF / SF.
--       - `progress_pct` (0..100), stored per-task. NOT rolled up in DB —
--         the app computes weighted rollup at read time (`buildTree`).
--       - `sort_order` for sibling ordering (0-based, dense within siblings).
--       - `wbs_code` derived by the app at read time from `sort_order` +
--         parent chain; NOT persisted to keep writes cheap and avoid
--         cascading updates on reorder.
--   - RLS + policies mirror project_milestones (rules §5).
--
-- Roles allowed to mutate:
--   - INSERT / UPDATE: PM, OM, DIRECTOR, ADMIN (canonical).
--   - DELETE: OM, DIRECTOR, ADMIN (canonical).
--   - SELECT: any authenticated tenant member.
--
-- Rollback (for rules §22):
--   BEGIN;
--     DROP TRIGGER IF EXISTS project_tasks_set_updated_at ON public.project_tasks;
--     DROP TABLE IF EXISTS public.project_tasks;
--     DROP TYPE  IF EXISTS public.task_status;
--   COMMIT;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. task_status enum
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type public.task_status as enum (
      'TODO',
      'IN_PROGRESS',
      'BLOCKED',
      'REVIEW',
      'DONE',
      'CANCELLED'
    );
  end if;
end$$;

comment on type public.task_status is
  'WBS task lifecycle (Phase 1). TODO→IN_PROGRESS→(BLOCKED|REVIEW)→DONE, or CANCELLED. Distinct from milestone_status which uses PLANNED/AT_RISK semantics.';

-- ---------------------------------------------------------------------------
-- 2. project_tasks table
-- ---------------------------------------------------------------------------
create table if not exists public.project_tasks (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  project_id            uuid not null references public.projects(id) on delete cascade,
  milestone_id          uuid references public.project_milestones(id) on delete set null,
  parent_task_id        uuid references public.project_tasks(id) on delete cascade,
  sort_order            integer not null default 0,
  name                  text not null,
  description           text,
  status                public.task_status not null default 'TODO',
  progress_pct          numeric(5,2) not null default 0
    check (progress_pct >= 0 and progress_pct <= 100),
  weight_pct            numeric(5,2) not null default 0
    check (weight_pct >= 0 and weight_pct <= 100),
  planned_start_date    date,
  planned_end_date      date,
  actual_start_date     date,
  actual_end_date       date,
  owner_employee_id     uuid references public.employees(id) on delete set null,
  depends_on_task_id    uuid references public.project_tasks(id) on delete set null,
  budget_amount         numeric(18,2),
  created_by            uuid references public.employees(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint project_tasks_name_not_blank check (length(trim(name)) > 0),
  constraint project_tasks_dates_ok check (
    planned_end_date is null or planned_start_date is null
      or planned_end_date >= planned_start_date
  ),
  constraint project_tasks_actual_dates_ok check (
    actual_end_date is null or actual_start_date is null
      or actual_end_date >= actual_start_date
  ),
  constraint project_tasks_no_self_parent check (
    parent_task_id is null or parent_task_id <> id
  ),
  constraint project_tasks_no_self_dep check (
    depends_on_task_id is null or depends_on_task_id <> id
  )
);

comment on table public.project_tasks is
  'WBS Work Breakdown Structure — hierarchical task tree sitting under project_milestones. Self-referential via parent_task_id. See rules §17 and .cursorrules WBS section.';

comment on column public.project_tasks.milestone_id is
  'Optional Level-1 anchor (project_milestones.id). Root-level tasks may set this to group under a phase gate. Nullable to allow projects without a formal milestone plan.';

comment on column public.project_tasks.progress_pct is
  'Task completion 0-100. Rollup to parent + milestone + project is computed by the app at read time (buildTree), not persisted, so reorder / edit are cheap.';

comment on column public.project_tasks.depends_on_task_id is
  'Finish-to-start predecessor (single). Enough for Gantt Phase 2 MVP; widen to a join table when multi-predecessor / SS / FF / SF are required.';

comment on column public.project_tasks.sort_order is
  'Sibling ordering within (project_id, parent_task_id). 0-based, dense. wbs_code is derived at read time from sort_order + parent chain (e.g. "1.2.3").';

-- ---------------------------------------------------------------------------
-- 3. Indexes (rules §22 — tenant_id in every composite index)
-- ---------------------------------------------------------------------------
create index if not exists project_tasks_tenant_project_idx
  on public.project_tasks (tenant_id, project_id);

create index if not exists project_tasks_project_parent_idx
  on public.project_tasks (project_id, parent_task_id, sort_order);

create index if not exists project_tasks_project_milestone_idx
  on public.project_tasks (project_id, milestone_id)
  where milestone_id is not null;

create index if not exists project_tasks_owner_idx
  on public.project_tasks (owner_employee_id)
  where owner_employee_id is not null;

create index if not exists project_tasks_depends_on_idx
  on public.project_tasks (depends_on_task_id)
  where depends_on_task_id is not null;

-- ---------------------------------------------------------------------------
-- 4. updated_at trigger
-- ---------------------------------------------------------------------------
drop trigger if exists project_tasks_set_updated_at on public.project_tasks;
create trigger project_tasks_set_updated_at
  before update on public.project_tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.project_tasks enable row level security;

-- Read: any authenticated tenant member.
drop policy if exists project_tasks_tenant_read on public.project_tasks;
create policy project_tasks_tenant_read
  on public.project_tasks
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- Insert: PM / OM / DIRECTOR / ADMIN.
drop policy if exists project_tasks_ops_insert on public.project_tasks;
create policy project_tasks_ops_insert
  on public.project_tasks
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('PM', 'OM', 'DIRECTOR', 'ADMIN')
  );

-- Update: PM / OM / DIRECTOR / ADMIN.
drop policy if exists project_tasks_ops_update on public.project_tasks;
create policy project_tasks_ops_update
  on public.project_tasks
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('PM', 'OM', 'DIRECTOR', 'ADMIN')
  )
  with check (tenant_id = public.current_tenant_id());

-- Delete: OM / DIRECTOR / ADMIN (stricter than update, mirrors milestone).
drop policy if exists project_tasks_ops_delete on public.project_tasks;
create policy project_tasks_ops_delete
  on public.project_tasks
  for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.canonical_employee_role() in ('OM', 'DIRECTOR', 'ADMIN')
  );

-- ---------------------------------------------------------------------------
-- 6. Same-project + same-tenant guard for parent_task_id / milestone_id /
--    depends_on_task_id (mirrors project_issues.milestone_id trigger in
--    migration 0051). Prevents forging a cross-project or cross-tenant tree.
-- ---------------------------------------------------------------------------
create or replace function public.project_tasks_check_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_project uuid;
  v_parent_tenant  uuid;
  v_ms_project     uuid;
  v_ms_tenant      uuid;
  v_dep_project    uuid;
  v_dep_tenant     uuid;
begin
  if new.parent_task_id is not null then
    select project_id, tenant_id
      into v_parent_project, v_parent_tenant
      from public.project_tasks
     where id = new.parent_task_id;
    if v_parent_project is null then
      raise exception 'parent_task_id % not found', new.parent_task_id;
    end if;
    if v_parent_project <> new.project_id
       or v_parent_tenant <> new.tenant_id then
      raise exception 'parent_task_id must belong to the same project/tenant';
    end if;
  end if;

  if new.milestone_id is not null then
    select project_id, tenant_id
      into v_ms_project, v_ms_tenant
      from public.project_milestones
     where id = new.milestone_id;
    if v_ms_project is null then
      raise exception 'milestone_id % not found', new.milestone_id;
    end if;
    if v_ms_project <> new.project_id
       or v_ms_tenant <> new.tenant_id then
      raise exception 'milestone_id must belong to the same project/tenant';
    end if;
  end if;

  if new.depends_on_task_id is not null then
    select project_id, tenant_id
      into v_dep_project, v_dep_tenant
      from public.project_tasks
     where id = new.depends_on_task_id;
    if v_dep_project is null then
      raise exception 'depends_on_task_id % not found', new.depends_on_task_id;
    end if;
    if v_dep_project <> new.project_id
       or v_dep_tenant <> new.tenant_id then
      raise exception 'depends_on_task_id must belong to the same project/tenant';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.project_tasks_check_refs() is
  'Guards parent_task_id / milestone_id / depends_on_task_id against cross-project or cross-tenant forgery. Runs before insert/update on project_tasks.';

drop trigger if exists project_tasks_check_refs_trg on public.project_tasks;
create trigger project_tasks_check_refs_trg
  before insert or update on public.project_tasks
  for each row execute function public.project_tasks_check_refs();
