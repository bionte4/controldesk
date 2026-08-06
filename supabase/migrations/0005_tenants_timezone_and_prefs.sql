-- ControlDesk — 0005_tenants_timezone_and_prefs.sql
-- Tenant TZ + per-employee locale preference (rules §18).
--
-- Rollback:
--   alter table public.employees drop column if exists preferred_locale;
--   alter table public.tenants drop column if exists timezone;

-- ---------------------------------------------------------------------------
-- 1. tenants.timezone — IANA name that drives all timezone-aware display
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists timezone text not null default 'Asia/Jakarta',
  add constraint tenants_timezone_nonempty check (length(timezone) > 0);

comment on column public.tenants.timezone is
  'IANA time zone name (e.g. Asia/Jakarta). Used by src/lib/format/date.ts for all UI display; DB always stores UTC (rules §18).';

-- ---------------------------------------------------------------------------
-- 2. employees.preferred_locale — mirrors the NEXT_LOCALE cookie for
--    cross-device sync when the user signs in from a fresh browser.
-- ---------------------------------------------------------------------------
alter table public.employees
  add column if not exists preferred_locale text
    check (preferred_locale in ('id', 'en'));

comment on column public.employees.preferred_locale is
  'User preferred UI locale. NULL falls back to tenant default. See src/lib/i18n/config.ts.';
