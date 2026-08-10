-- ControlDesk — 0078_tenant_self_signup.sql
--
-- Fase 6 of the tenant lifecycle roadmap (docs/ops/tenant-provisioning.md).
-- Adds:
--
--   1. tenants.plan text (check-constrained) — 'trial', 'starter',
--      'pro', 'enterprise'. Default 'trial'. Aspirational field —
--      billing/Stripe integration deferred; today all self-signup
--      tenants land on 'trial'.
--   2. tenants.trial_ends_at timestamptz — auto-set to now()+14 days
--      at insert time for self-signup tenants. Existing tenants keep
--      NULL (interpreted as "not on trial" i.e. paid/perpetual).
--   3. tenants.provisioned_via text — audit label ('super-admin-ui',
--      'ops-cli', 'self-signup'). Backfills existing rows to
--      'unknown' so we can distinguish self-signup from operator
--      provisioning without touching audit logs.
--   4. tenant_signup_requests — pending signup requests (before email
--      verification). Row gets consumed when the user clicks the
--      verify link (converted to a real tenants row via RPC).
--   5. Two RPC functions:
--      - resolve_tenant_plan_by_slug — anon-callable, used by proxy
--        to short-circuit expired trials (currently only surfaces
--        the value; enforcement is banner-only for Fase 6).
--      - complete_tenant_signup — consumes a valid signup request +
--        provisions the tenant atomically (wraps provision_tenant).
--
-- Rollback:
--   drop function public.complete_tenant_signup(uuid, text);
--   drop function public.resolve_tenant_plan_by_slug(text);
--   drop table public.tenant_signup_requests;
--   alter table public.tenants drop column provisioned_via;
--   alter table public.tenants drop column trial_ends_at;
--   alter table public.tenants drop column plan;

-- ---------------------------------------------------------------------------
-- 1. tenants.plan / trial_ends_at / provisioned_via
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists plan text not null default 'trial';

alter table public.tenants
  drop constraint if exists tenants_plan_check;
alter table public.tenants
  add constraint tenants_plan_check
    check (plan in ('trial', 'starter', 'pro', 'enterprise'));

comment on column public.tenants.plan is
  'Billing tier. Currently informational — billing integration deferred. '
  'Self-signup defaults to trial; ops-created tenants inherit trial too '
  'unless explicitly overridden.';

alter table public.tenants
  add column if not exists trial_ends_at timestamptz;

comment on column public.tenants.trial_ends_at is
  'When the trial expires. NULL = not on trial (paid / perpetual). '
  'Self-signup path sets this to now() + 14 days via complete_tenant_signup(). '
  'Enforcement today is banner-only; ops manually suspends expired '
  'tenants via /super-admin/tenants until billing lands.';

alter table public.tenants
  add column if not exists provisioned_via text not null default 'unknown';

alter table public.tenants
  drop constraint if exists tenants_provisioned_via_check;
alter table public.tenants
  add constraint tenants_provisioned_via_check
    check (provisioned_via in ('unknown', 'super-admin-ui', 'ops-cli', 'self-signup', 'seed'));

comment on column public.tenants.provisioned_via is
  'Audit label for how this tenant was created. unknown = existed '
  'before column added. seed = supabase/seed.sql (demo tenant).';

create index if not exists tenants_plan_idx on public.tenants(plan);
create index if not exists tenants_trial_ends_at_idx
  on public.tenants(trial_ends_at) where trial_ends_at is not null;

-- Backfill: mark the demo tenant explicitly so we don't confuse it
-- with a real self-signup during dev.
update public.tenants
  set provisioned_via = 'seed'
  where slug = 'demo' and provisioned_via = 'unknown';

-- ---------------------------------------------------------------------------
-- 2. tenant_signup_requests — pending requests before verification
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_signup_requests (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null,
  name              text not null,
  admin_email       citext not null,
  admin_name        text not null,
  token_hash        text not null,       -- sha256 of raw token; raw never stored
  expires_at        timestamptz not null,
  ip_address        inet,
  user_agent        text,
  verified_at       timestamptz,
  verified_tenant_id uuid references public.tenants(id) on delete set null,
  created_at        timestamptz not null default now()
);

comment on table public.tenant_signup_requests is
  'Pending self-signup requests. A row is created when someone fills '
  'the /register-org form. The verify link contains a raw token whose '
  'sha256 must match token_hash. When verify succeeds, complete_tenant_signup '
  'stamps verified_at + verified_tenant_id and provisions the tenant.';

create unique index if not exists tenant_signup_requests_token_hash_idx
  on public.tenant_signup_requests(token_hash);

create index if not exists tenant_signup_requests_email_idx
  on public.tenant_signup_requests(admin_email);

create index if not exists tenant_signup_requests_expires_idx
  on public.tenant_signup_requests(expires_at)
  where verified_at is null;

alter table public.tenant_signup_requests enable row level security;

-- No policies: signup requests are anon-only writes via service_role
-- from the Server Action, and read via SECURITY DEFINER RPCs. No
-- direct authenticated access.

-- ---------------------------------------------------------------------------
-- 3. resolve_tenant_plan_by_slug — anon-callable proxy helper
-- ---------------------------------------------------------------------------
create or replace function public.resolve_tenant_plan_by_slug(p_slug text)
returns table (
  plan          text,
  trial_ends_at timestamptz,
  status        text
)
language sql
security definer
stable
set search_path = public
as $$
  select plan, trial_ends_at, status::text
  from public.tenants
  where slug = lower(p_slug)
  limit 1;
$$;

comment on function public.resolve_tenant_plan_by_slug(text) is
  'Anon-callable — used by the app to surface trial-remaining banner '
  'and (eventually) by proxy to gate expired trials.';

grant execute on function public.resolve_tenant_plan_by_slug(text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. complete_tenant_signup — verify token + provision tenant atomically
-- ---------------------------------------------------------------------------
-- This is the "commit" step of the two-phase self-signup:
--   Phase 1: /register-org POST → row in tenant_signup_requests + email.
--   Phase 2: /register-org/verify/{token} → this RPC → tenants row.
--
-- Caller passes the admin_user_id (which the calling server action
-- created via auth.admin.createUser AFTER validating the token match)
-- and the raw token. This function:
--   1. sha256(p_raw_token) → look up unverified, unexpired request.
--   2. Call provision_tenant() with 'self-signup' source label.
--   3. Set plan='trial' + trial_ends_at=now()+14 days on the new row.
--   4. Stamp verified_at + verified_tenant_id on the request.
create or replace function public.complete_tenant_signup(
  p_raw_token       text,
  p_admin_user_id   uuid
)
returns table (
  tenant_id   uuid,
  employee_id uuid,
  admin_email text,
  admin_name  text,
  slug        text,
  name        text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_hash text;
  v_provisioned record;
  v_trial_end timestamptz := now() + interval '14 days';
begin
  v_hash := encode(sha256(p_raw_token::bytea), 'hex');

  select *
  into v_req
  from public.tenant_signup_requests
  where token_hash = v_hash
    and verified_at is null
    and expires_at > now()
  for update
  limit 1;

  if v_req is null then
    raise exception 'invalid_or_expired_token'
      using errcode = '22023',
            hint = 'Signup token tidak ditemukan, sudah dipakai, atau kadaluarsa.';
  end if;

  -- Race check: another self-signup may have grabbed this slug in the
  -- interim (email verification took a while). Reject cleanly rather
  -- than let provision_tenant fail with a cryptic FK error.
  if exists (select 1 from public.tenants where slug = v_req.slug) then
    raise exception 'slug_taken'
      using errcode = '23505',
            hint = format('Slug %s sudah dipakai — silakan ulangi pendaftaran dengan slug lain.', v_req.slug);
  end if;

  -- Reuse Fase 1's provision_tenant() so we get identical semantics:
  -- CoA seed, employee row, audit log entry.
  select * into v_provisioned
  from public.provision_tenant(
    v_req.slug,
    v_req.name,
    p_admin_user_id,
    v_req.admin_email::text,
    v_req.admin_name,
    'self-signup'
  );

  -- Stamp plan + trial expiry + provisioned_via on the freshly-created row.
  update public.tenants
    set plan            = 'trial',
        trial_ends_at   = v_trial_end,
        provisioned_via = 'self-signup'
    where id = v_provisioned.tenant_id;

  -- Consume the request so the token can't be replayed.
  update public.tenant_signup_requests
    set verified_at        = now(),
        verified_tenant_id = v_provisioned.tenant_id
    where id = v_req.id;

  return query select
    v_provisioned.tenant_id,
    v_provisioned.employee_id,
    v_req.admin_email::text,
    v_req.admin_name,
    v_req.slug,
    v_req.name;
end;
$$;

comment on function public.complete_tenant_signup(text, uuid) is
  'Two-phase self-signup commit. Verifies the raw token against '
  'tenant_signup_requests.token_hash, then delegates to provision_tenant() '
  'and stamps plan=trial + trial_ends_at=now()+14 days. Consumes the '
  'signup request so tokens are single-use.';

-- Locked to service_role only — the server action is trusted to
-- create the auth user first, then invoke this RPC. Not exposed to
-- anon/authenticated so the token cannot be replayed from an
-- attacker-controlled JWT session.
revoke all on function public.complete_tenant_signup(text, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_tenant_signup(text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Cleanup helper: purge expired unverified signup requests
-- ---------------------------------------------------------------------------
-- Optional — runnable manually or via cron. Not scheduled here to
-- avoid opinions on pg_cron installation. Ops runs this periodically.
create or replace function public.purge_expired_signup_requests()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  with deleted as (
    delete from public.tenant_signup_requests
    where verified_at is null
      and expires_at < now() - interval '7 days'
    returning 1
  )
  select count(*) into v_count from deleted;
  return v_count;
end;
$$;

comment on function public.purge_expired_signup_requests() is
  'Deletes unverified signup requests older than 7 days past expiry. '
  'Safe to run periodically. Verified requests are retained for audit.';

grant execute on function public.purge_expired_signup_requests() to service_role;
