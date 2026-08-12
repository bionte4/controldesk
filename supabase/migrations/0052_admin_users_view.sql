-- =============================================================================
-- Migration 0052 — Admin users listing (read-only view, Fase 1).
--
-- Introduces `public.admin_list_users()`, a `SECURITY DEFINER` function that
-- returns the internal users of the current tenant joined with their linked
-- `employees` row + `auth.users` audit fields (`last_sign_in_at`,
-- `banned_until`, `email_confirmed_at`, `created_at`).
--
-- Why a function (not a view):
--   * `auth.users` sits in a separate schema that we cannot slap RLS onto.
--   * We need TWO tenant-scoping paths:
--       (a) the row must have a matching `employees` record with
--           `tenant_id = current_tenant_id()`, OR
--       (b) the auth user's `app_metadata.tenant_slug` matches the current
--           tenant (covers admins who haven't been given an `employees` row
--           yet, e.g. the initial tenant bootstrap user).
--   * We need a role guard: only `TENANT_ADMIN` / `HR_ADMIN` (legacy) or
--     `ADMIN` (canonical) may enumerate users — everyone else gets an empty
--     set (not an error, so the UI can hide the page rather than 500).
--   * A function lets us compose the filter + guard + join in one place with
--     `SECURITY DEFINER` and return a stable typed shape.
--
-- Rollback:
--   drop function if exists public.admin_list_users();
-- =============================================================================

create or replace function public.admin_list_users()
returns table (
  user_id                uuid,
  email                  text,
  employee_id            uuid,
  employee_name          text,
  employee_role          public.employee_role,
  employee_is_active     boolean,
  last_sign_in_at        timestamptz,
  email_confirmed_at     timestamptz,
  banned_until           timestamptz,
  auth_created_at        timestamptz,
  tenant_id              uuid
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with actor as (
    select
      public.current_tenant_id()    as tenant_id,
      public.current_employee_role() as role
  ),
  guarded as (
    -- If actor is not admin, return an empty result. This is intentional so
    -- non-admins get a clean empty-state UI instead of a 403. UI must still
    -- hide the link via `filterNavForRole()`; this is the defense-in-depth.
    select *
    from actor
    where role in ('TENANT_ADMIN', 'HR_ADMIN', 'ADMIN')
  )
  select
    u.id                                             as user_id,
    u.email                                          as email,
    e.id                                             as employee_id,
    e.full_name                                      as employee_name,
    e.role                                           as employee_role,
    e.is_active                                      as employee_is_active,
    u.last_sign_in_at                                as last_sign_in_at,
    u.email_confirmed_at                             as email_confirmed_at,
    u.banned_until                                   as banned_until,
    u.created_at                                     as auth_created_at,
    coalesce(e.tenant_id, g.tenant_id)               as tenant_id
  from guarded g
  join auth.users u
    on true
  left join public.employees e
    on e.user_id = u.id
   and e.tenant_id = g.tenant_id
  where
    -- Rule (a): employee link exists and matches tenant.
    e.tenant_id = g.tenant_id
    -- OR rule (b): auth user's app_metadata.tenant_slug matches this tenant.
    -- This covers bootstrap admins that don't have an employees row yet.
    or (
      (u.raw_app_meta_data ->> 'tenant_slug') = (
        select t.slug
        from public.tenants t
        where t.id = g.tenant_id
      )
    )
  order by e.full_name nulls last, u.email;
$$;

comment on function public.admin_list_users() is
  'Return internal users of the current tenant (auth.users ⋈ employees) with '
  'last_sign_in_at + banned_until audit fields. Empty result for non-admin '
  'actors. Rules: §17 (audit surfaces), §22 (7-year retention respected via '
  'read-only projection).';

-- Public grants: we intentionally do NOT expose to `anon`; the JWT-based
-- role guard inside the function body handles authorization for authenticated
-- callers. Service role still gets full access for cron/admin scripts.
revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated, service_role;
