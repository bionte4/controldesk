-- Migration: 0094_employees_pii_encryption.sql
-- Purpose : Move `nik` and `bank_account_number` from plaintext columns
--           to Node-side AES-256-GCM encryption (rules §3).
--
-- Design:
--   The application-layer helpers in `src/lib/security/employee-pii.ts`
--   produce compact ciphertext strings of the form
--     v1.<b64u iv>.<b64u ct>.<b64u tag>
--   which we store in plain `text` columns (mirrors the pattern chosen
--   for OAuth refresh tokens in migration 0042 — see the rationale
--   there for why we bailed on the pgcrypto-inside-Postgres approach).
--
--   For NIK we ALSO store a deterministic HMAC-SHA256 blind index
--   (`nik_hash bytea`) so `(tenant_id, nik_hash)` can enforce
--   uniqueness without the DB seeing plaintext. The HMAC is keyed
--   with a HKDF-derived subkey from APP_ENCRYPTION_KEY that is
--   distinct from the encryption key (domain separation via HKDF
--   info string). The hash is namespaced by `tenant_id` so a
--   compromised hash set from tenant A cannot be correlated to
--   tenant B.
--
-- Data safety:
--   As of writing, zero rows have a non-null `nik` or
--   `bank_account_number`:
--
--     select count(*) filter (where nik is not null),
--            count(*) filter (where bank_account_number is not null)
--       from public.employees;
--     -- expects: (0, 0)
--
--   The migration therefore DROPS the plaintext columns without a
--   backfill. If you deploy this against an environment that has
--   accumulated plaintext data, run the Node-side backfill script
--   in `scripts/employees-pii-backfill.mjs` (not shipped in this
--   migration; contact ops if you need it) BEFORE applying — the
--   drop is destructive.
--
-- Rollback:
--   alter table public.employees
--     add column nik text,
--     add column bank_account_number text;
--   -- plus recreate `employees_nik_format_ck` and
--   -- `employees_tenant_nik_uidx` from migration 0093, and revert
--   -- `anonymize_terminated_employee()` to its 0093 body.

begin;

-- -----------------------------------------------------------------------------
-- 1. Add encrypted columns + blind index
-- -----------------------------------------------------------------------------
alter table public.employees
  add column if not exists nik_enc text,
  add column if not exists nik_hash bytea,
  add column if not exists bank_account_number_enc text;

comment on column public.employees.nik_enc is
  'Encrypted Indonesian KTP NIK (16-digit national ID). Format: '
  'v1.<b64u iv>.<b64u ct>.<b64u tag>. See '
  'src/lib/security/employee-pii.ts for the AES-256-GCM helper. '
  'Blinded lookups go through `nik_hash` below.';
comment on column public.employees.nik_hash is
  'HMAC-SHA256(tenant_id || 0x00 || trimmed_nik) using a HKDF-derived '
  'subkey. Enables `(tenant_id, nik_hash)` uniqueness without decrypting.';
comment on column public.employees.bank_account_number_enc is
  'Encrypted bank account number. Same ciphertext format as `nik_enc`. '
  'No blind index — HR duplicate-check is not a use case for bank number.';

-- Wire-format guards. The check is cheap (LIKE prefix match) and
-- catches the most common data-corruption mode: a caller inserts the
-- plaintext by accident, dodging the encrypt helper.
alter table public.employees
  add constraint employees_nik_enc_format_ck
  check (nik_enc is null or nik_enc like 'v1.%.%.%');

alter table public.employees
  add constraint employees_bank_account_enc_format_ck
  check (bank_account_number_enc is null or bank_account_number_enc like 'v1.%.%.%');

-- If NIK ciphertext is set, NIK hash must also be set (they're a
-- pair produced by the same encrypt call). Prevents partial writes
-- that would break the uniqueness constraint below.
alter table public.employees
  add constraint employees_nik_enc_hash_paired_ck
  check (
    (nik_enc is null and nik_hash is null) or
    (nik_enc is not null and nik_hash is not null)
  );

-- -----------------------------------------------------------------------------
-- 2. Drop the old plaintext columns + their index/constraint
-- -----------------------------------------------------------------------------
-- Uniqueness moves from `(tenant_id, nik)` plaintext to
-- `(tenant_id, nik_hash)` ciphertext. Drop the old first so the
-- name is available for the new one — a fresh install can rename
-- when adding the new index, but incremental deploys need the drop.
drop index if exists public.employees_tenant_nik_uidx;

alter table public.employees
  drop constraint if exists employees_nik_format_ck;

-- The plaintext columns themselves. `if exists` guards against
-- partial rollbacks in staging.
alter table public.employees
  drop column if exists nik,
  drop column if exists bank_account_number;

-- Rebuild the "one NIK per tenant" uniqueness against the hash.
-- Partial index: only rows with a hash are constrained — NULL
-- (i.e. "field never set") is always allowed, matching the pre-0094
-- semantics.
create unique index if not exists employees_tenant_nik_hash_uidx
  on public.employees (tenant_id, nik_hash)
  where nik_hash is not null;

-- The division index from 0093 is untouched — division isn't PII.

-- -----------------------------------------------------------------------------
-- 3. Retention: extend anonymize_terminated_employee() to null the
--    new encrypted columns + hash. Same trigger contract as 0093;
--    body is CREATE OR REPLACE so existing grants survive.
-- -----------------------------------------------------------------------------
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
    set full_name                 = '[REDACTED_' || v_hash || ']',
        email                     = 'redacted+' || v_hash || '@anonymized.controldesk.app',
        nik_enc                   = null,
        nik_hash                  = null,
        bank_account_number_enc   = null,
        monthly_salary            = 0,
        hourly_rate               = 0,
        preferred_locale          = null,
        first_name                = null,
        last_name                 = null,
        phone                     = null,
        date_of_birth             = null,
        emergency_contact_name    = null,
        emergency_contact_phone   = null,
        notes                     = null,
        client_display_name       = null,
        pii_anonymized_at         = now()
    where id = p_employee_id
      and terminated_at is not null
      and pii_anonymized_at is null;
end;
$$;

comment on function public.anonymize_terminated_employee(uuid) is
  'Rules §22 retention: nulls all PII on a terminated employee. Idempotent — '
  'no-op if already anonymized. Updated in 0094 to null `nik_enc`, `nik_hash`, '
  '`bank_account_number_enc` (moved to Node-side AES-256-GCM at rest).';

commit;
