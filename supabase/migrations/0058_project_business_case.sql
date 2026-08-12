-- Migration: 0058_project_business_case.sql
-- Purpose : Introduce first-class "Business Case" stage for projects
--           without spawning a separate table. Adds the minimum BC
--           fields on `projects` so a DRAFT-status row functionally
--           represents the intake stage (rules §6, §22).
--
-- Lifecycle : DRAFT (BC intake) → PLANNING (budget drafting) →
--             ACTIVE (PM assigned, ops unlocked) → COMPLETED / ARCHIVED.
--
-- BC input is limited to OM + ADMIN via PDP (see roles-and-permissions).
--
-- Rollback :
--   alter table public.projects
--     drop column if exists bc_executive_summary,
--     drop column if exists bc_target_gm_pct,
--     drop column if exists bc_sponsor_id,
--     drop column if exists bc_approved_by,
--     drop column if exists bc_approved_at;

alter table public.projects
  add column if not exists bc_executive_summary text,
  add column if not exists bc_target_gm_pct numeric(5, 2),
  add column if not exists bc_sponsor_id uuid references public.employees(id) on delete set null,
  add column if not exists bc_approved_by uuid references public.employees(id) on delete set null,
  add column if not exists bc_approved_at timestamptz;

-- Target gross-margin percent must be between 0 and 100 (business rule).
-- Nullable during rollout — existing rows won't have a BC entry.
alter table public.projects
  drop constraint if exists projects_bc_target_gm_pct_range;
alter table public.projects
  add constraint projects_bc_target_gm_pct_range
    check (
      bc_target_gm_pct is null
      or (bc_target_gm_pct >= 0 and bc_target_gm_pct <= 100)
    );

-- Both `approved_by` and `approved_at` should either both be set or both
-- be null — approving BC without recording the timestamp (or vice versa)
-- would corrupt audit reports.
alter table public.projects
  drop constraint if exists projects_bc_approval_consistency;
alter table public.projects
  add constraint projects_bc_approval_consistency
    check (
      (bc_approved_by is null and bc_approved_at is null)
      or (bc_approved_by is not null and bc_approved_at is not null)
    );

comment on column public.projects.bc_executive_summary is
  'Business Case executive summary (1–3 paragraphs). Filled during the DRAFT stage before the project is promoted to PLANNING.';
comment on column public.projects.bc_target_gm_pct is
  'Target gross-margin percentage for the project as pitched in the BC. Used later to benchmark actual GM.';
comment on column public.projects.bc_sponsor_id is
  'Employee (usually OM / ADMIN / DIRECTOR) who sponsors and owns the BC. Not necessarily the PM.';
comment on column public.projects.bc_approved_by is
  'Employee who approved the BC and moved the project from DRAFT → PLANNING. Null while still in DRAFT.';
comment on column public.projects.bc_approved_at is
  'Timestamp when the BC was approved (mirrors bc_approved_by).';

-- Index for OM dashboards that filter by "BC awaiting approval" (i.e.
-- DRAFT status). Kept small via partial predicate; RLS already scopes
-- by tenant.
create index if not exists projects_bc_pending_idx
  on public.projects (tenant_id, created_at desc)
  where status = 'DRAFT'::project_status;
