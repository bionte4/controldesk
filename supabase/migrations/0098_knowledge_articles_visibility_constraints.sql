-- 0098_knowledge_articles_visibility_constraints.sql
--
-- Phase 2c-I: Wire the visibility ACL constraints on the columns
-- that migration 0095 already provisioned. The columns
-- (`visibility`, `visibility_roles`, `visibility_project_id`) and
-- the enum (`knowledge_article_visibility` with values `TENANT_WIDE`,
-- `ROLE_GATED`, `PROJECT_SCOPED`) exist since Tier 1 shipped —
-- migration 0095 explicitly parked them "reserved for Fase 2" while
-- Zod hard-locked the accepted set to `['TENANT_WIDE']`.
--
-- This migration adds:
--
--   1. `knowledge_articles_visibility_side_fields_chk` — a partial
--      CHECK constraint so a caller cannot INSERT / UPDATE a row
--      into an internally inconsistent state (e.g., `visibility =
--      'ROLE_GATED'` but `visibility_roles = '{}'`, or `visibility =
--      'PROJECT_SCOPED'` but `visibility_project_id IS NULL`). Zod
--      already refuses these on the write path but the constraint
--      protects against direct DB writes and future SQL migrations.
--
--   2. `knowledge_articles_visibility_project_idx` — a partial B-tree
--      index on `(tenant_id, visibility_project_id)` filtered to
--      `visibility = 'PROJECT_SCOPED'`. The data-layer helper
--      `resolveVisibilityFilter()` will emit a filter clause of the
--      shape `(visibility='PROJECT_SCOPED' and visibility_project_id
--      = any($1))` on every list query the KB uses. Without this
--      index the planner has to seq-scan the tenant's article set to
--      resolve the branch — cheap today with tens of articles, ugly
--      once tenants have thousands. Partial index keeps the index
--      body tiny (only PROJECT_SCOPED rows are indexed) and updates
--      only fire on that branch.
--
--   3. Same constraints mirrored on `knowledge_article_revisions`
--      snapshot columns. Revisions are append-only and immutable
--      (trigger `tg_knowledge_article_revisions_immutable`) so the
--      check runs at INSERT time only — the trigger will still block
--      any UPDATE anyway.
--
-- Non-goals — SELECT-side visibility gating in RLS. That lands in
-- Fase 2c-III with a new SELECT policy branch that references
-- current-user role + project assignments. Fase 2c-I stops at "the
-- data-layer helper filters on read; the DB refuses inconsistent
-- writes."
--
-- Migration is idempotent — every constraint / index uses `if not
-- exists` or is guarded by a `do $$ … exception when
-- duplicate_object then null; end $$;` block.
--
-- Rollback:
--   drop index if exists public.knowledge_articles_visibility_project_idx;
--   alter table public.knowledge_articles
--     drop constraint if exists knowledge_articles_visibility_side_fields_chk;
--   alter table public.knowledge_article_revisions
--     drop constraint if exists knowledge_article_revisions_visibility_side_fields_chk;

begin;

-- ---------------------------------------------------------------------------
-- 1. Side-field CHECK on `knowledge_articles`
-- ---------------------------------------------------------------------------
-- Semantics:
--   TENANT_WIDE     ⇒ side fields ignored (may be non-empty but the
--                     read helper treats them as unset; we do NOT
--                     force them to empty at the DB layer so a caller
--                     that toggles between visibility modes doesn't
--                     lose their role/project selection).
--   ROLE_GATED      ⇒ `array_length(visibility_roles, 1) >= 1`.
--                     Zod also enforces canonical role strings; the
--                     DB check is a structural guardrail only, not a
--                     role-name allowlist (that would require a
--                     scalar subquery against the enum).
--   PROJECT_SCOPED  ⇒ `visibility_project_id IS NOT NULL`.

do $$
begin
  alter table public.knowledge_articles
    add constraint knowledge_articles_visibility_side_fields_chk
    check (
      visibility = 'TENANT_WIDE'
      or (
        visibility = 'ROLE_GATED'
        and coalesce(array_length(visibility_roles, 1), 0) >= 1
      )
      or (
        visibility = 'PROJECT_SCOPED'
        and visibility_project_id is not null
      )
    );
exception when duplicate_object then
  null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Partial index for PROJECT_SCOPED lookups
-- ---------------------------------------------------------------------------
-- The read-side filter emits `.eq('visibility_project_id', <uuid>)`
-- for each of the caller's active project IDs, so an index on
-- `(tenant_id, visibility_project_id)` is optimal.

create index if not exists knowledge_articles_visibility_project_idx
  on public.knowledge_articles (tenant_id, visibility_project_id)
  where visibility = 'PROJECT_SCOPED';

-- ---------------------------------------------------------------------------
-- 3. Same side-field CHECK on the revision snapshot
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.knowledge_article_revisions
    add constraint knowledge_article_revisions_visibility_side_fields_chk
    check (
      visibility = 'TENANT_WIDE'
      or (
        visibility = 'ROLE_GATED'
        and coalesce(array_length(visibility_roles, 1), 0) >= 1
      )
      or (
        visibility = 'PROJECT_SCOPED'
        and visibility_project_id is not null
      )
    );
exception when duplicate_object then
  null;
end $$;

commit;
