-- 0097_knowledge_articles_admin_gate_unify.sql
--
-- Fixes: Three admin lists on the Knowledge Base module drifted out of
-- sync after Tier 1 landed. The audit at the start of Phase 2c
-- surfaced this mismatch:
--
--   Layer                                | Admin roles admitted
--   -------------------------------------|---------------------------
--   PDP `decideKnowledgeArticle`         | TENANT_ADMIN, HEAD_MANAGER,
--   (`src/lib/security/pdp.ts`)          | HR_ADMIN
--   Reader `canManage`                   | TENANT_ADMIN, ADMIN,
--   (`src/app/(app)/knowledge/[slug]/    | HEAD_MANAGER, HR_ADMIN
--   page.tsx`)                           |
--   RLS `knowledge_articles_select`      | TENANT_ADMIN, ADMIN
--   RLS `knowledge_articles_update`      | TENANT_ADMIN, ADMIN
--   (`0095_knowledge_articles.sql`)      |
--
-- The bug: a HEAD_MANAGER or HR_ADMIN could see the "Edit / Publish"
-- actions bar in the UI (reader's list allows them), but the RLS
-- UPDATE policy would then reject their write with a generic
-- postgres 42501 permission error. The UX bug isn't loud in dev
-- because dev tenants tend to seed a single TENANT_ADMIN — it only
-- bit in the audit walkthrough of prod-like data.
--
-- Root cause — RLS was authored with the 2-role list on the
-- assumption that HR/senior-mgr admin bypass was app-layer only.
-- Reader `canManage` was extended to 4 roles when the actions bar
-- was added but the RLS policy was never bumped. PDP grew a
-- different 3-role list independently.
--
-- Fix — unify to the union list `{TENANT_ADMIN, HEAD_MANAGER,
-- HR_ADMIN, ADMIN}` in every layer:
--   • App layer routes through `canManageKnowledgeArticles()` in
--     `src/lib/rbac/roles.ts` — the single source of truth. It uses
--     `roleInGate()` so both legacy DB names (TENANT_ADMIN, HR_ADMIN,
--     HEAD_MANAGER) AND their canonical folds (ADMIN, DIRECTOR)
--     match without duplication.
--   • This migration extends the RLS SELECT and UPDATE policies with
--     the same list. Canonical `ADMIN` and `DIRECTOR` are added so
--     tenants that have completed the migration-0021 canonical role
--     migration keep working.
--
-- Behaviour change:
--   HR_ADMIN and HEAD_MANAGER can now:
--     • SELECT any DRAFT article by any author in their tenant (was
--       blocked; only author + TENANT_ADMIN/ADMIN could see other
--       authors' drafts before).
--     • UPDATE any article regardless of authorship (was blocked
--       identically).
--   No new SELECT on published articles — those were already visible
--   tenant-wide via the `status = 'PUBLISHED'` branch of the SELECT
--   policy.
--
-- Non-goals — Fase 2c visibility (ROLE_GATED / PROJECT_SCOPED)
-- enforcement lands in a follow-up migration; this one is purely
-- about the admin-role gate.
--
-- Rollback:
--   drop policy knowledge_articles_select on public.knowledge_articles;
--   drop policy knowledge_articles_update on public.knowledge_articles;
--   -- then re-apply the two policies from migration 0095 verbatim.

begin;

-- ---------------------------------------------------------------------------
-- SELECT — replace the admin subquery with the unified 4-role list plus
-- the two canonical folds. Everything else in the policy stays as
-- migration 0095 wrote it.
-- ---------------------------------------------------------------------------

drop policy if exists knowledge_articles_select on public.knowledge_articles;

create policy knowledge_articles_select
  on public.knowledge_articles
  for select
  using (
    tenant_id = public.current_tenant_id()
    and (
      status = 'PUBLISHED'
      or author_employee_id in (
        select id from public.employees where user_id = auth.uid()
      )
      or exists (
        select 1
        from public.employees e
        where e.user_id = auth.uid()
          and e.tenant_id = public.current_tenant_id()
          and e.role in (
            'TENANT_ADMIN',
            'HEAD_MANAGER',
            'HR_ADMIN',
            -- Canonical GAS-aligned equivalents (post migration 0021).
            -- `ADMIN` folds from TENANT_ADMIN and HR_ADMIN,
            -- `DIRECTOR` folds from HEAD_MANAGER.
            'ADMIN',
            'DIRECTOR'
          )
      )
    )
  );

-- ---------------------------------------------------------------------------
-- UPDATE — same story. `with check` narrows to tenant scope only, no
-- role gating (matches the pattern from 0095).
-- ---------------------------------------------------------------------------

drop policy if exists knowledge_articles_update on public.knowledge_articles;

create policy knowledge_articles_update
  on public.knowledge_articles
  for update
  using (
    tenant_id = public.current_tenant_id()
    and (
      author_employee_id in (
        select id from public.employees where user_id = auth.uid()
      )
      or exists (
        select 1
        from public.employees e
        where e.user_id = auth.uid()
          and e.tenant_id = public.current_tenant_id()
          and e.role in (
            'TENANT_ADMIN',
            'HEAD_MANAGER',
            'HR_ADMIN',
            'ADMIN',
            'DIRECTOR'
          )
      )
    )
  )
  with check (
    tenant_id = public.current_tenant_id()
  );

commit;
