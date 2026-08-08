-- =============================================================================
-- Migration 0051 — Project Issues ORM-style fields (rules §26 upgrade).
--
-- Extends `public.project_issues` with the fields commonly found in issue
-- trackers (Jira / Linear / Odoo-like):
--
--   * category      — classification independent of severity/urgency
--                     (BUG / FEATURE / TASK / INCIDENT / RISK / IMPROVEMENT /
--                     QUESTION)
--   * milestone_id  — optional link into `project_milestones` so an issue
--                     surfaces as delivery risk on the milestone timeline
--   * due_date      — optional manual target completion date (distinct from
--                     the SLA `sla_due_at` which is derived from severity)
--   * tags          — free-form text labels for grouping / search
--   * notes         — internal-only remarks (not shown in customer-facing
--                     summaries)
--
-- All new columns are nullable/defaulted so no application code breaks and no
-- backfill script is needed. Severity + status semantics remain untouched.
--
-- Rollback:
--   alter table public.project_issues
--     drop column if exists notes,
--     drop column if exists tags,
--     drop column if exists due_date,
--     drop column if exists milestone_id,
--     drop column if exists category;
--   drop type if exists public.project_issue_category;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum: project_issue_category
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'project_issue_category') then
    create type public.project_issue_category as enum (
      'BUG',          -- defect / regression
      'FEATURE',      -- new capability request
      'TASK',         -- neutral work item
      'INCIDENT',     -- production incident / outage
      'RISK',         -- delivery / compliance risk observation
      'IMPROVEMENT',  -- refactor / polish / debt
      'QUESTION'      -- clarification / decision needed
    );
  end if;
end $$;

comment on type public.project_issue_category is
  'Issue classification independent of severity. Drives filters and dashboards; '
  'does not affect SLA (severity does).';

-- ---------------------------------------------------------------------------
-- 2. New columns on project_issues
-- ---------------------------------------------------------------------------
alter table public.project_issues
  add column if not exists category      public.project_issue_category not null default 'BUG',
  add column if not exists milestone_id  uuid references public.project_milestones(id) on delete set null,
  add column if not exists due_date      date,
  add column if not exists tags          text[] not null default '{}',
  add column if not exists notes         text;

comment on column public.project_issues.category is
  'Issue type: BUG / FEATURE / TASK / INCIDENT / RISK / IMPROVEMENT / QUESTION. '
  'Independent of severity (which drives SLA).';
comment on column public.project_issues.milestone_id is
  'Optional link to the milestone whose delivery is affected. When set, the '
  'issue shows up on the milestone timeline as a risk marker.';
comment on column public.project_issues.due_date is
  'Optional manual target completion date. Distinct from sla_due_at which is '
  'derived from severity — the two coexist so a MEDIUM issue can still have '
  'a hard deadline set by the PM.';
comment on column public.project_issues.tags is
  'Free-form labels (max 20 entries, each ≤ 50 chars — enforced app-side). '
  'Indexed with GIN for prefix / any-match search.';
comment on column public.project_issues.notes is
  'Internal triage remarks. Not surfaced in customer / client-facing views.';

-- ---------------------------------------------------------------------------
-- 3. Constraints & indexes
-- ---------------------------------------------------------------------------

-- Milestone (if set) must belong to the same project + same tenant. Enforced
-- via a stateful FK trigger because a plain composite FK would require a
-- unique (project_id, id) index on project_milestones that we don't want to
-- add for one caller. Cheap trigger validates on write only.
create or replace function public.project_issues_check_milestone()
returns trigger
language plpgsql
as $$
declare
  v_project uuid;
  v_tenant  uuid;
begin
  if new.milestone_id is null then
    return new;
  end if;
  select project_id, tenant_id
    into v_project, v_tenant
  from public.project_milestones
   where id = new.milestone_id;
  if v_project is null then
    raise exception 'milestone % not found', new.milestone_id
      using errcode = '23503';
  end if;
  if v_project <> new.project_id then
    raise exception 'milestone % belongs to a different project', new.milestone_id
      using errcode = '23514';
  end if;
  if v_tenant <> new.tenant_id then
    raise exception 'milestone % belongs to a different tenant', new.milestone_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists project_issues_check_milestone on public.project_issues;
create trigger project_issues_check_milestone
  before insert or update of milestone_id on public.project_issues
  for each row execute function public.project_issues_check_milestone();

-- Cheap tag search / filter by category dashboards.
create index if not exists project_issues_tags_gin_idx
  on public.project_issues using gin (tags);

create index if not exists project_issues_tenant_category_idx
  on public.project_issues (tenant_id, category, status);

create index if not exists project_issues_tenant_milestone_idx
  on public.project_issues (tenant_id, milestone_id)
  where milestone_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Extend the events append-only log so category / milestone / due / tags
--    changes are visible in the timeline UI without adding new columns.
--    We reuse the generic `UPDATED` kind + `metadata` jsonb — no schema
--    change on `project_issue_events` needed.
-- ---------------------------------------------------------------------------

-- (No SQL required. The Server Action layer records the diff in metadata.)
