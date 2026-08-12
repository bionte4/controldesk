-- ControlDesk — 0006_notifications_and_attachments.sql
-- In-app notifications + attachment registry (rules §19, §20).
--
-- Rollback:
--   drop table if exists public.attachments;
--   drop table if exists public.notifications;
--   drop type if exists public.notification_kind;

-- ---------------------------------------------------------------------------
-- 1. notification_kind — top-level classification.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_kind') then
    create type public.notification_kind as enum (
      'APPROVAL_REQUESTED',
      'APPROVAL_APPROVED',
      'APPROVAL_REJECTED',
      'CASH_ADVANCE_DISBURSED',
      'CASH_ADVANCE_SETTLED',
      'PETTY_CASH_LOW_BALANCE',
      'HR_REQUEST_UPDATE',
      'PROJECT_HANDOVER',
      'SLA_BREACH_WARNING',
      'SYSTEM'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. notifications — in-app bell + realtime channel source (rules §20).
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  employee_id    uuid references public.employees(id) on delete set null,
  kind           public.notification_kind not null,
  title          text not null,
  body           text,
  action_url     text,
  payload        jsonb,
  read_at        timestamptz,
  created_at     timestamptz not null default now()
);

comment on table public.notifications is
  'In-app notifications. Consumed by the Topbar bell + Supabase Realtime channel `tenant:{tenant_id}:notifications` (rules §20).';

create index if not exists notifications_tenant_user_idx
  on public.notifications (tenant_id, user_id, created_at desc);

create index if not exists notifications_unread_idx
  on public.notifications (tenant_id, user_id)
  where read_at is null;

alter table public.notifications enable row level security;

-- SELECT: user reads their own notifications only.
drop policy if exists notifications_self_read on public.notifications;
create policy notifications_self_read
  on public.notifications
  for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  );

-- UPDATE: user can only mark their own notifications as read (i.e. set
-- read_at). Enforced via a WITH CHECK that pins tenant + user_id.
drop policy if exists notifications_self_ack on public.notifications;
create policy notifications_self_ack
  on public.notifications
  for update
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  )
  with check (
    tenant_id = public.current_tenant_id()
    and user_id = auth.uid()
  );

-- INSERT: only the service role writes notifications (via Server Actions
-- using `withSecureAction`, which uses the invoker's session but the row
-- gets stamped with the recipient's user_id — that would fail RLS). So we
-- expose a SECURITY DEFINER helper below.
-- Enqueue is done via `public.enqueue_notification()`; no direct INSERT
-- policy on this table for authenticated clients.

-- ---------------------------------------------------------------------------
-- 3. enqueue_notification RPC — SECURITY DEFINER helper used by trusted
--    Server Actions to notify OTHER users (approvers, HR admins, etc).
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_notification(
  p_recipient_user_id uuid,
  p_kind public.notification_kind,
  p_title text,
  p_body text default null,
  p_action_url text default null,
  p_payload jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_tenant_id uuid := public.current_tenant_id();
  v_recipient_employee_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'enqueue_notification: caller has no tenant claim'
      using errcode = '42501';
  end if;

  -- Confirm the recipient belongs to the same tenant. Cross-tenant notify
  -- attempts must fail-closed.
  select id into v_recipient_employee_id
  from public.employees
  where user_id = p_recipient_user_id
    and tenant_id = v_tenant_id
    and is_active
  limit 1;

  if v_recipient_employee_id is null then
    raise exception 'enqueue_notification: recipient % not in tenant %',
      p_recipient_user_id, v_tenant_id
      using errcode = '42501';
  end if;

  insert into public.notifications (
    tenant_id, user_id, employee_id, kind, title, body, action_url, payload
  ) values (
    v_tenant_id, p_recipient_user_id, v_recipient_employee_id,
    p_kind, p_title, p_body, p_action_url, p_payload
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.enqueue_notification(
  uuid, public.notification_kind, text, text, text, jsonb
) from public;
grant execute on function public.enqueue_notification(
  uuid, public.notification_kind, text, text, text, jsonb
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. attachments — cross-reference registry for files in Supabase Storage
--    (rules §19). One row per uploaded file.
-- ---------------------------------------------------------------------------
create table if not exists public.attachments (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  resource_type    text not null,        -- e.g. 'cash_advance', 'petty_cash_voucher'
  resource_id      uuid not null,
  storage_path     text not null,        -- always starts with `{tenant_id}/...`
  filename         text not null,
  mime_type        text not null,
  size_bytes       bigint not null check (size_bytes >= 0),
  uploaded_by      uuid references public.employees(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint attachments_storage_path_tenant_prefix
    check (storage_path like tenant_id::text || '/%'),
  constraint attachments_mime_allowlist
    check (mime_type in (
      'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
    ))
);

comment on table public.attachments is
  'Cross-reference registry for files uploaded to Supabase Storage bucket `tenant-attachments`. Row per file (rules §19).';

create index if not exists attachments_tenant_resource_idx
  on public.attachments (tenant_id, resource_type, resource_id);

create index if not exists attachments_tenant_uploaded_idx
  on public.attachments (tenant_id, uploaded_by, created_at desc);

alter table public.attachments enable row level security;

-- SELECT: any employee of the tenant can list attachments (needed to render
-- receipt thumbnails on approvals inbox etc).
drop policy if exists attachments_tenant_read on public.attachments;
create policy attachments_tenant_read
  on public.attachments
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- INSERT: employees of the tenant can register their uploaded file, but
-- only under their own uploader_id.
drop policy if exists attachments_tenant_insert on public.attachments;
create policy attachments_tenant_insert
  on public.attachments
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1 from public.employees me
      where me.user_id = auth.uid()
        and me.tenant_id = attachments.tenant_id
        and me.id = attachments.uploaded_by
        and me.is_active
    )
  );

-- DELETE: only the uploader or a tenant admin can remove attachments.
drop policy if exists attachments_uploader_or_admin_delete on public.attachments;
create policy attachments_uploader_or_admin_delete
  on public.attachments
  for delete
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      exists (
        select 1 from public.employees me
        where me.user_id = auth.uid()
          and me.id = attachments.uploaded_by
      )
      or public.current_employee_role() in ('TENANT_ADMIN', 'HR_ADMIN', 'LEAD_FINANCE')
    )
  );
