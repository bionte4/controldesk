-- ControlDesk — 0033_portal_notifications.sql
-- Client Portal — B.4 in-portal notifications feed (GAS §28, rules §20, §28).
--
-- Portal users have no `auth.users` row and therefore cannot receive rows
-- from `public.notifications` (which pins `user_id = auth.uid()` via RLS).
-- This migration introduces a parallel table dedicated to portal recipients
-- + a milestone-status trigger that fans notifications out to every active
-- portal user of the owning client.
--
-- Design decisions:
--   • Each row targets exactly ONE `client_user_id`. Broadcast semantics
--     (all users of a client) are implemented by inserting one row per
--     recipient, keeping the `read_at` per-user model simple.
--   • RLS is service_role only — portal users authenticate via opaque
--     session cookie (see rules §28, `src/lib/portal/session.ts`) and read
--     via `createServiceRoleClient()` with mandatory
--     `.eq("client_user_id", session.client_user.id)` app-layer filters.
--   • The milestone trigger only fires on transitions to states that are
--     interesting to a client (DONE / AT_RISK / CANCELLED) to keep the
--     feed signal-heavy. Internal states (IN_PROGRESS) do not spam clients.
--   • Also emits when `projects.status` moves to `COMPLETED`.
--
-- Rollback:
--   drop trigger if exists portal_notifications_on_project_status
--     on public.projects;
--   drop trigger if exists portal_notifications_on_milestone_status
--     on public.project_milestones;
--   drop function if exists public._portal_notify_project_status();
--   drop function if exists public._portal_notify_milestone_status();
--   drop function if exists public.enqueue_portal_notification(
--     uuid, uuid, public.portal_notification_kind, text, text, text, jsonb);
--   drop table if exists public.portal_notifications;
--   drop type if exists public.portal_notification_kind;

-- ---------------------------------------------------------------------------
-- 1. Enum — portal_notification_kind
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'portal_notification_kind'
  ) then
    create type public.portal_notification_kind as enum (
      'MILESTONE_UPDATE',
      'PROJECT_UPDATE',
      'ANNOUNCEMENT',
      'SYSTEM'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Table — portal_notifications
-- ---------------------------------------------------------------------------
create table if not exists public.portal_notifications (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  client_id           uuid not null references public.clients(id) on delete cascade,
  client_user_id      uuid not null references public.client_users(id) on delete cascade,
  kind                public.portal_notification_kind not null,
  title               text not null,
  body                text,
  action_url          text,
  payload             jsonb,
  read_at             timestamptz,
  created_at          timestamptz not null default now(),
  constraint portal_notifications_title_not_blank
    check (length(trim(title)) > 0)
);

comment on table public.portal_notifications is
  'Client Portal notifications feed (rules §28). Targeted per client_user; app-layer filter enforces tenant + client_user isolation because portal users lack a JWT.';

create index if not exists portal_notifications_recipient_idx
  on public.portal_notifications (tenant_id, client_user_id, created_at desc);

create index if not exists portal_notifications_unread_idx
  on public.portal_notifications (tenant_id, client_user_id)
  where read_at is null;

create index if not exists portal_notifications_client_idx
  on public.portal_notifications (tenant_id, client_id, created_at desc);

alter table public.portal_notifications enable row level security;

drop policy if exists portal_notifications_service_role_only
  on public.portal_notifications;
create policy portal_notifications_service_role_only
  on public.portal_notifications
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- 3. Helper — enqueue_portal_notification()
--    Callable from trusted server actions AND from trigger functions. Fans a
--    single notification out to every ACTIVE client_user of the target
--    client. Returns the number of rows inserted.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_portal_notification(
  p_tenant_id  uuid,
  p_client_id  uuid,
  p_kind       public.portal_notification_kind,
  p_title      text,
  p_body       text default null,
  p_action_url text default null,
  p_payload    jsonb default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  if p_tenant_id is null or p_client_id is null then
    raise exception 'enqueue_portal_notification: tenant_id and client_id are required'
      using errcode = '22004';
  end if;

  insert into public.portal_notifications
    (tenant_id, client_id, client_user_id, kind, title, body, action_url, payload)
  select
    p_tenant_id,
    p_client_id,
    cu.id,
    p_kind,
    p_title,
    p_body,
    p_action_url,
    p_payload
  from public.client_users cu
  where cu.tenant_id = p_tenant_id
    and cu.client_id = p_client_id
    and cu.status = 'ACTIVE';

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.enqueue_portal_notification(
  uuid, uuid, public.portal_notification_kind, text, text, text, jsonb
) from public;
grant execute on function public.enqueue_portal_notification(
  uuid, uuid, public.portal_notification_kind, text, text, text, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Trigger — milestone status change → portal notification
-- ---------------------------------------------------------------------------
create or replace function public._portal_notify_milestone_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_project_code text;
  v_project_name text;
  v_title text;
  v_body text;
begin
  -- Only fire on transitions INTO an interesting state.
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status not in ('DONE', 'AT_RISK', 'CANCELLED') then
    return new;
  end if;

  select p.client_id, p.code, p.name
    into v_client_id, v_project_code, v_project_name
  from public.projects p
  where p.id = new.project_id
    and p.tenant_id = new.tenant_id;

  if v_client_id is null then
    return new;
  end if;

  v_title := case new.status
    when 'DONE'      then 'Milestone completed: ' || new.name
    when 'AT_RISK'   then 'Milestone at risk: ' || new.name
    when 'CANCELLED' then 'Milestone cancelled: ' || new.name
    else new.name
  end;

  v_body := 'Project ' || coalesce(v_project_code, '') ||
    ' — ' || coalesce(v_project_name, '');

  perform public.enqueue_portal_notification(
    new.tenant_id,
    v_client_id,
    'MILESTONE_UPDATE'::public.portal_notification_kind,
    v_title,
    v_body,
    '/portal/projects/' || new.project_id::text,
    jsonb_build_object(
      'milestone_id', new.id,
      'from_status', old.status,
      'to_status', new.status,
      'project_id', new.project_id
    )
  );
  return new;
end;
$$;

drop trigger if exists portal_notifications_on_milestone_status
  on public.project_milestones;
create trigger portal_notifications_on_milestone_status
  after update of status on public.project_milestones
  for each row
  when (old.status is distinct from new.status)
  execute function public._portal_notify_milestone_status();

-- ---------------------------------------------------------------------------
-- 5. Trigger — project completion → portal notification
-- ---------------------------------------------------------------------------
create or replace function public._portal_notify_project_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if new.status <> 'COMPLETED' then
    return new;
  end if;
  if new.client_id is null then
    return new;
  end if;

  perform public.enqueue_portal_notification(
    new.tenant_id,
    new.client_id,
    'PROJECT_UPDATE'::public.portal_notification_kind,
    'Project completed: ' || coalesce(new.name, new.code),
    'All milestones have been signed off. Thank you for the partnership.',
    '/portal/projects/' || new.id::text,
    jsonb_build_object(
      'project_id', new.id,
      'from_status', old.status,
      'to_status', new.status
    )
  );
  return new;
end;
$$;

drop trigger if exists portal_notifications_on_project_status
  on public.projects;
create trigger portal_notifications_on_project_status
  after update of status on public.projects
  for each row
  when (old.status is distinct from new.status)
  execute function public._portal_notify_project_status();
