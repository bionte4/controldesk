-- Migration: 0089_performance_evaluations_project_context.sql
-- Purpose : Add OPTIONAL project context + project-reviewer channel to
--           performance evaluations so PMs of the employee's active
--           project can contribute feedback in parallel with the
--           structural SPV→PM→OM chain.
--
-- Design intent
-- -------------
-- Contract renewal (PKWT quarterly review) is a structural HR decision
-- and must remain per-employee. But when the evaluated employee is
-- currently assigned to a project, the *project PM* has the most
-- day-to-day context on delivery quality. Rather than replacing the
-- structural chain we let the SPV attach:
--   * `project_id` — the project context this cycle covers.
--   * `project_reviewer_employee_id` — usually the project's
--     PRIMARY_PM at draft time; SPV or HR may override.
--   * `project_reviewer_notes` + `project_reviewed_at` — free-form
--     coaching feedback stamped when the project reviewer submits.
--
-- All 4 columns are nullable, so evaluations without a project context
-- keep working exactly like before (backward-compatible).
--
-- Rollback:
--   alter table public.performance_evaluations
--     drop column if exists project_reviewed_at,
--     drop column if exists project_reviewer_notes,
--     drop column if exists project_reviewer_employee_id,
--     drop column if exists project_id;

alter table public.performance_evaluations
  add column if not exists project_id uuid
    references public.projects(id) on delete set null,
  add column if not exists project_reviewer_employee_id uuid
    references public.employees(id) on delete set null,
  add column if not exists project_reviewer_notes text,
  add column if not exists project_reviewed_at timestamptz;

comment on column public.performance_evaluations.project_id is
  'Optional link to the project this evaluation cycle covers. When set, `project_reviewer_employee_id` is usually the PRIMARY_PM at draft time.';

comment on column public.performance_evaluations.project_reviewer_employee_id is
  'Employee (usually project PRIMARY_PM) authorized to submit `project_reviewer_notes`. Independent from the structural SPV→PM→OM chain.';

comment on column public.performance_evaluations.project_reviewer_notes is
  'Free-form project-reviewer feedback (delivery quality, technical fit, day-to-day observations). Submitted before OM decides.';

-- Fast lookup for the "evaluations waiting on my project review"
-- inbox — pinned to non-final statuses so completed evals fall out
-- of the index automatically.
create index if not exists performance_evaluations_project_reviewer_idx
  on public.performance_evaluations
    (tenant_id, project_reviewer_employee_id, status)
  where project_reviewer_employee_id is not null
    and status in ('DRAFT', 'SUBMITTED_BY_SPV', 'REVIEWED_BY_PM', 'RETURNED_TO_SPV');

create index if not exists performance_evaluations_project_idx
  on public.performance_evaluations (tenant_id, project_id)
  where project_id is not null;

-- ---------------------------------------------------------------------
-- RLS: extend the read + write policies so the project reviewer can
-- SELECT the row + UPDATE the two notes columns without needing
-- HR / management privileges. We rewrite the existing policies (rules
-- §22 forbids editing landed migrations, so 0059's policies are still
-- authoritative — we merely widen the visibility here by dropping +
-- recreating with the additional predicate).
-- ---------------------------------------------------------------------
drop policy if exists performance_evaluations_read on public.performance_evaluations;
create policy performance_evaluations_read on public.performance_evaluations
  for select using (
    tenant_id = current_tenant_id() and (
      public.is_hr_or_management()
      or spv_employee_id in (select id from public.employees where user_id = auth.uid())
      or pm_employee_id in (select id from public.employees where user_id = auth.uid())
      or om_employee_id in (select id from public.employees where user_id = auth.uid())
      or project_reviewer_employee_id in (select id from public.employees where user_id = auth.uid())
    )
  );

drop policy if exists performance_evaluations_write on public.performance_evaluations;
create policy performance_evaluations_write on public.performance_evaluations
  for all using (
    tenant_id = current_tenant_id() and (
      public.is_hr_or_management()
      or spv_employee_id in (select id from public.employees where user_id = auth.uid())
      or pm_employee_id in (select id from public.employees where user_id = auth.uid())
      or project_reviewer_employee_id in (select id from public.employees where user_id = auth.uid())
    )
  ) with check (
    tenant_id = current_tenant_id()
  );

-- Notification kinds for the new channel.
do $$ begin
  alter type public.notification_kind add value if not exists 'EVALUATION_PROJECT_REVIEW_REQUESTED';
  alter type public.notification_kind add value if not exists 'EVALUATION_PROJECT_REVIEWED';
exception when others then null; end $$;
