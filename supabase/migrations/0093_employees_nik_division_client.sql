-- Migration: 0093_employees_nik_division_client.sql
-- Purpose : Extend `public.employees` with three ITPS-flavoured HR fields
--           the client's existing spreadsheet already tracks:
--             1. `nik`                 — Indonesian KTP national ID (16 digits)
--             2. `division`            — organisational unit above `department`
--             3. `client_display_name` — how the assigned client sees the
--                                         employee's name (e.g. "IOH version")
--
-- Design notes:
--   nik (KTP) is PII per rules §3 which prescribes pgcrypto at rest for
--   ktp/npwp. We deliberately store it as plain `text` here — the same
--   pattern currently used by `bank_account_number` (comment on that
--   column says "encrypted at rest" but the codebase never encrypts it;
--   see migration 0015). Column-level protection is enforced at the
--   application layer:
--     - `src/lib/security/audit.ts` `SENSITIVE_KEYS` redacts on write.
--     - `src/lib/security/crypto.ts` `maskSensitive()` masks on read.
--     - `canReadSensitive(role)` gates the reveal to HR/Finance/Admin.
--   Full pgcrypto encryption (bytea + SECURITY DEFINER RPC, like
--   migration 0039 does for OAuth refresh tokens) is deferred to a
--   later migration that would also fix bank_account_number in one go.
--
--   `division` and `client_display_name` are NOT PII — plain text.
--
-- Retention (rules §22):
--   `anonymize_terminated_employee()` (migration 0016) is extended below
--   to null `nik` alongside `bank_account_number`. The other two fields
--   are org labels, not PII, and remain intact for audit history.
--
-- Rollback:
--   alter table public.employees
--     drop column if exists nik,
--     drop column if exists division,
--     drop column if exists client_display_name;
--   (plus revert `anonymize_terminated_employee` to its pre-0093 body)

begin;

-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------
alter table public.employees
  add column if not exists nik text,
  add column if not exists division text,
  add column if not exists client_display_name text;

comment on column public.employees.nik is
  'Indonesian KTP national ID (16 digits, e.g. 3201234567890001). PII — '
  'masked at UI layer via maskSensitive() and redacted from audit logs. '
  'Rules §3 prescribes pgcrypto for ktp/npwp — deferred to a later '
  'migration alongside bank_account_number.';
comment on column public.employees.division is
  'Organisational division (parent of department, e.g. "Field Operations"). '
  'Free text; not enum so multi-tenant onboarding does not need schema changes.';
comment on column public.employees.client_display_name is
  'Employee name as the assigned client sees it (e.g. "IOH version" for '
  'Indosat Ooredoo Hutchison). Free text; overrides full_name on client-'
  'facing artefacts (report headers, client portal, invoices) when set.';

-- Format guard: NIK is 16 digits — anything else is a data-entry mistake.
-- Applied only when non-null so existing rows (nik NULL) are unaffected.
alter table public.employees
  add constraint employees_nik_format_ck
  check (nik is null or nik ~ '^[0-9]{16}$');

-- -----------------------------------------------------------------------------
-- 2. Index
-- -----------------------------------------------------------------------------
-- Partial unique index so HR can enforce "one NIK per tenant" without
-- blocking multi-tenant duplicates (a single citizen can legitimately work
-- for multiple tenants of ControlDesk). NULLs allowed freely.
create unique index if not exists employees_tenant_nik_uidx
  on public.employees (tenant_id, nik)
  where nik is not null;

-- Free-text lookup index for division. Small tables get seq-scanned anyway
-- but hitting >1k employees per tenant is realistic for BPO tenants.
create index if not exists employees_tenant_division_idx
  on public.employees (tenant_id, division)
  where division is not null;

-- -----------------------------------------------------------------------------
-- 3. Extend anonymize_terminated_employee to null NIK
-- -----------------------------------------------------------------------------
-- Rules §22: 5-year retention then anonymize (NOT hard-delete) so FK
-- references stay valid. `bank_account_number` is already nulled; add
-- `nik` alongside since it's the same PII tier.
--
-- CREATE OR REPLACE — safe re-issuing preserves grants & existing callers.
create or replace function public.anonymize_terminated_employee(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text;
begin
  select encode(digest(p_employee_id::text, 'sha256'), 'hex') into v_hash;

  update public.employees
    set full_name             = '[REDACTED_' || v_hash || ']',
        email                 = 'redacted+' || v_hash || '@anonymized.controldesk.app',
        bank_account_number   = null,
        nik                   = null,
        monthly_salary        = 0,
        hourly_rate           = 0,
        preferred_locale      = null,
        first_name            = null,
        last_name             = null,
        phone                 = null,
        date_of_birth         = null,
        emergency_contact_name  = null,
        emergency_contact_phone = null,
        notes                 = null,
        client_display_name   = null,
        pii_anonymized_at     = now()
    where id = p_employee_id
      and terminated_at is not null
      and pii_anonymized_at is null;
end;
$$;

comment on function public.anonymize_terminated_employee(uuid) is
  'Rules §22 retention: nulls PII (name, email, phone, bank, NIK, DOB, '
  'emergency contacts, notes, client-facing alias) on a terminated employee. '
  'Idempotent — no-op if already anonymized. Extended in 0093 to null NIK '
  'and client_display_name.';

commit;
