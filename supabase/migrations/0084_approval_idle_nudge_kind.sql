-- Migration 0084: Add APPROVAL_IDLE_24H notification kind.
--
-- Enables the /api/cron/approval-idle-nudge worker (rules §20 "Digest"
-- nudge companion) to write a per-approver reminder as soon as a
-- pending item crosses the 24h age threshold — bridging the gap
-- between "just submitted" (approver saw it in-app) and "will be in
-- the 08:00 digest email" (up to 24h later).
--
-- Category mapping (see src/lib/notifications/categories.ts):
--   APPROVAL_IDLE_24H → APPROVALS
--
-- Preference-gated like every other kind — users can silence the
-- APPROVALS category if the nudges become noise.
--
-- Idempotency: the cron dedupes per (recipient_user_id, resource_kind,
-- resource_id) tuple by querying existing `notifications` rows with
-- this kind before enqueuing. No new index needed — the existing
-- `(user_id, kind, created_at desc)` scan is fast enough for the
-- expected pending-item volume.
--
-- Rollback (DESTRUCTIVE — do not run against prod):
--   -- Postgres does not support removing enum values in place; the
--   -- rollback requires a full type swap:
--   -- 1. create type public.notification_kind_new as enum (<all values except APPROVAL_IDLE_24H>);
--   -- 2. alter table public.notifications alter column kind
--   --      type public.notification_kind_new using kind::text::public.notification_kind_new;
--   -- 3. alter table public.user_notification_preferences alter column kind
--   --      type public.notification_kind_new using kind::text::public.notification_kind_new;
--   -- 4. drop type public.notification_kind;
--   -- 5. alter type public.notification_kind_new rename to notification_kind;

do $$
begin
  if not exists (
    select 1 from pg_enum
    where enumtypid = 'public.notification_kind'::regtype
      and enumlabel = 'APPROVAL_IDLE_24H'
  ) then
    execute 'alter type public.notification_kind add value ''APPROVAL_IDLE_24H''';
  end if;
exception when others then null; end $$;
