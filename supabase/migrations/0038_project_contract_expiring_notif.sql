-- ControlDesk — 0038_project_contract_expiring_notif.sql
--
-- Adds a notification kind for project-contract-expiry reminders (rules §7
-- + §20). Mirrors the employee-contract-expiring flow introduced in 0034
-- but for projects with an approaching `end_date`.
--
-- Rollback (Postgres enums are additive; removing an enum value requires a
-- rebuild). Manual rollback path:
--   1. update public.notifications set kind = null where kind = 'PROJECT_CONTRACT_EXPIRING';
--   2. create type public.notification_kind_new as enum (<original values>);
--   3. alter table public.notifications alter column kind type public.notification_kind_new using kind::text::public.notification_kind_new;
--   4. drop type public.notification_kind; alter type public.notification_kind_new rename to public.notification_kind;

do $$
begin
  if not exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'notification_kind'
       and e.enumlabel = 'PROJECT_CONTRACT_EXPIRING'
  ) then
    alter type public.notification_kind
      add value 'PROJECT_CONTRACT_EXPIRING';
  end if;
end $$;

comment on type public.notification_kind is
  'Top-level classification for internal in-app notifications. PROJECT_CONTRACT_EXPIRING is emitted by /api/cron/project-contract-reminders when a project end_date falls inside a configured horizon (30 / 14 / 7 / 1 days).';
