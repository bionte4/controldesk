-- Enterprise session timeout policy: tenant-specific idle, warning, and
-- absolute lifetime. Enforcement lives in proxy using HMAC-signed cookies.

alter table public.tenants
  add column if not exists idle_timeout_minutes integer not null default 30,
  add column if not exists idle_warning_minutes integer not null default 2,
  add column if not exists absolute_session_minutes integer not null default 480;

alter table public.tenants drop constraint if exists tenants_idle_timeout_range;
alter table public.tenants add constraint tenants_idle_timeout_range
  check (idle_timeout_minutes between 5 and 1440);
alter table public.tenants drop constraint if exists tenants_idle_warning_range;
alter table public.tenants add constraint tenants_idle_warning_range
  check (idle_warning_minutes between 1 and 60 and idle_warning_minutes < idle_timeout_minutes);
alter table public.tenants drop constraint if exists tenants_absolute_session_range;
alter table public.tenants add constraint tenants_absolute_session_range
  check (absolute_session_minutes between 30 and 10080 and absolute_session_minutes >= idle_timeout_minutes);

comment on column public.tenants.idle_timeout_minutes is
  'Server-enforced inactivity limit. Human activity heartbeat refreshes a signed HttpOnly timestamp.';
comment on column public.tenants.absolute_session_minutes is
  'Non-sliding maximum lifetime from first authenticated request; requires reauthentication.';

create or replace function public.resolve_tenant_session_policy_by_slug(p_slug text)
returns table(idle_timeout_minutes integer, idle_warning_minutes integer, absolute_session_minutes integer)
language sql security definer stable set search_path = public as $$
  select t.idle_timeout_minutes, t.idle_warning_minutes, t.absolute_session_minutes
  from public.tenants t where t.slug=p_slug limit 1;
$$;
grant execute on function public.resolve_tenant_session_policy_by_slug(text)
  to anon, authenticated, service_role;

comment on function public.resolve_tenant_session_policy_by_slug(text) is
  'Narrow anon-callable policy resolver used by proxy before tenant authentication.';
