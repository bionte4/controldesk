-- 0099_knowledge_articles_visibility_rls.sql
--
-- Fase 2c-III: Defense-in-depth. The Fase 2c-I / II commits added a
-- visibility ACL at the data layer + UI, but curious tenant members
-- could still hit `/rest/v1/knowledge_articles?status=eq.PUBLISHED`
-- directly with the anon key + their JWT and receive every published
-- article regardless of ROLE_GATED / PROJECT_SCOPED tags — RLS today
-- only checks tenant + status + author-or-admin. For KB use cases
-- like "HR salary bands" or "confidential supplier data" that
-- app-layer filter isn't sufficient.
--
-- This migration folds the visibility ACL into the DB SELECT policy
-- so REST snoops and any future direct-SQL callers are equally
-- protected. Two helper functions are added to keep the policy
-- readable (SECURITY DEFINER so the subqueries can bypass RLS while
-- resolving the caller's identity — otherwise a policy that queries
-- `project_employee_assignments` would recurse into its own tenant
-- policy and deadlock).
--
--   1. `public.current_employee_id()` — sibling to
--      `current_tenant_id()` / `current_employee_role()`. Reads the
--      `employee_id` claim injected by the JWT hook (migration 0003).
--
--   2. `public.is_project_member(project_id)` — returns TRUE when
--      the caller currently holds an ACTIVE assignment on the given
--      project. Cheap: single-index probe on
--      `project_employee_assignments (tenant_id, employee_id, status)`.
--
-- The updated SELECT policy adds a visibility clause AFTER the
-- existing tenant / status / author / admin checks. Semantics stay
-- identical for TENANT_WIDE + DRAFT + admin bypass; only ROLE_GATED
-- and PROJECT_SCOPED PUBLISHED articles get narrower.
--
-- UPDATE / INSERT policies are UNCHANGED. Rationale — write-side
-- self-scoping-out protection is the PDP's job (Fase 2c-III also
-- touches `decideKnowledgeArticle` for that) and the CHECK
-- constraint from 0098 already refuses inconsistent writes.
--
-- Migration is idempotent — every function uses `create or replace`
-- and the policy is dropped-and-recreated.
--
-- Rollback:
--   drop policy if exists knowledge_articles_select on
--     public.knowledge_articles;
--   -- re-apply the SELECT policy from 0097 verbatim.
--   drop function if exists public.is_project_member(uuid);
--   drop function if exists public.current_employee_id();

begin;

-- ---------------------------------------------------------------------------
-- Helper 1 — current_employee_id()
-- ---------------------------------------------------------------------------

create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb
      ->> 'employee_id',
    ''
  )::uuid;
$$;

comment on function public.current_employee_id() is
  'Returns the employee_id claim from the current JWT (injected by the auth hook in 0003), or null when anonymous / non-employee. Symmetric to current_tenant_id() and current_employee_role().';

revoke all on function public.current_employee_id() from public;
grant execute on function public.current_employee_id()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper 2 — is_project_member(project_id uuid)
-- ---------------------------------------------------------------------------
-- Returns TRUE iff the caller holds an ACTIVE assignment on
-- `project_id`. SECURITY DEFINER so it bypasses RLS on the
-- assignment table (needed because the KB SELECT policy would
-- otherwise recurse: policy A queries table B, table B has policy
-- that queries table A). Kept STABLE so the planner can hoist and
-- memoise within a single query.
--
-- Marked as `set search_path = public` per the guidance for
-- SECURITY DEFINER helpers — the search_path pin prevents a
-- shadowed schema attack from redirecting the subquery.

create or replace function public.is_project_member(project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_employee_assignments
    where employee_id = public.current_employee_id()
      and project_employee_assignments.project_id = is_project_member.project_id
      and status = 'ACTIVE'
  );
$$;

comment on function public.is_project_member(uuid) is
  'True when the current caller (via JWT employee_id) holds an ACTIVE assignment on the given project. Used by knowledge_articles visibility RLS to gate PROJECT_SCOPED articles at the DB layer.';

revoke all on function public.is_project_member(uuid) from public;
grant execute on function public.is_project_member(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- SELECT policy — replace with visibility-aware version.
-- ---------------------------------------------------------------------------
-- The full precedence order (top to bottom):
--
--   1. Cross-tenant reads REJECTED (tenant_id match).
--   2. Non-PUBLISHED drafts + archived: same author-OR-admin gate
--      as 0097. Visibility is not checked for drafts — the author
--      needs to be able to preview their own ROLE_GATED article
--      before publishing.
--   3. PUBLISHED articles branch by visibility:
--      • TENANT_WIDE — all tenant members OK.
--      • ROLE_GATED — caller's role OR its canonical fold must be
--        in `visibility_roles`. Fold is inline via a small CASE
--        because a helper wouldn't buy readability. The array
--        overlap (`&&`) treats each side as an unordered set.
--      • PROJECT_SCOPED — `is_project_member(visibility_project_id)`.
--   4. Author bypass — an author always sees their own row.
--   5. Admin bypass — same list as 0097 (TENANT_ADMIN, HEAD_MANAGER,
--      HR_ADMIN, ADMIN, DIRECTOR).

drop policy if exists knowledge_articles_select on public.knowledge_articles;

create policy knowledge_articles_select
  on public.knowledge_articles
  for select
  using (
    tenant_id = public.current_tenant_id()
    and (
      -- (a) Author bypass — see your own drafts + drafts you own
      -- regardless of visibility.
      author_employee_id in (
        select id from public.employees where user_id = auth.uid()
      )
      -- (b) Admin bypass — see everything within the tenant.
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
      -- (c) PUBLISHED with visibility enforcement.
      or (
        status = 'PUBLISHED'
        and (
          visibility = 'TENANT_WIDE'
          or (
            visibility = 'ROLE_GATED'
            and (
              -- Overlap check: caller's DB role OR its canonical
              -- fold intersects with `visibility_roles`. Inline
              -- CASE handles the 10 legacy DB values that fold
              -- into the 7 canonical slots (see roles.ts
              -- toCanonicalRole for the ground truth).
              visibility_roles && array[
                public.current_employee_role()::text,
                (case public.current_employee_role()::text
                  when 'TENANT_ADMIN' then 'ADMIN'
                  when 'HR_ADMIN' then 'ADMIN'
                  when 'GENERAL_MANAGER' then 'DIRECTOR'
                  when 'HEAD_MANAGER' then 'DIRECTOR'
                  when 'LEAD_FINANCE' then 'FINANCE'
                  when 'PETTY_CASH_CUSTODIAN' then 'FINANCE'
                  when 'OPERATIONS_MANAGER' then 'OM'
                  when 'PROJECT_MANAGER' then 'PM'
                  when 'SUPERVISOR' then 'SUPERVISOR'
                  when 'EMPLOYEE' then 'EMPLOYEE'
                  else public.current_employee_role()::text
                end)
              ]
            )
          )
          or (
            visibility = 'PROJECT_SCOPED'
            and visibility_project_id is not null
            and public.is_project_member(visibility_project_id)
          )
        )
      )
    )
  );

commit;
