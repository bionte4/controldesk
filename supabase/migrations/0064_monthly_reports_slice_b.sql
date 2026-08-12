-- Migration: 0064_monthly_reports_slice_b.sql
-- Purpose : Monthly Report Slice B — client sign-off + Berita Acara.
--           PM-mediated flow (no client portal): after PM approves the
--           report, PM sends it to the client externally (email / WA),
--           then records the client's decision manually. On approve,
--           PM generates the Berita Acara (record-only; PDF export is
--           deferred to Slice C or a later polish).
--
-- State transitions (extending 0061):
--   APPROVED_BY_PM
--     ├─ [PM: send to client]        → SENT_TO_CLIENT
--     │    ├─ [PM: record approve]   → APPROVED_BY_CLIENT
--     │    │    └─ [PM: generate BA] → BA_GENERATED
--     │    └─ [PM: record reject]    → APPROVED_BY_PM (loop back)
--
-- Model additions:
--   * `sent_to_client_*` — audit of when + who dispatched the report.
--   * `client_*` fields — PM's record of the client's decision.
--   * `ba_*` fields — Berita Acara metadata (number, period, notes).
--   * `tenant_ba_counters` + `next_ba_number()` — auto-generate a
--       per-tenant per-year BA number (format `BA/{slug}/{yyyy}/NNNN`).
--   * 4 new `notification_kind` values.
--
-- Rollback :
--   alter table public.monthly_reports
--     drop column if exists sent_to_client_at,
--     drop column if exists sent_to_client_by,
--     drop column if exists client_reviewer_name,
--     drop column if exists client_reviewer_email,
--     drop column if exists client_decided_at,
--     drop column if exists client_decision_notes,
--     drop column if exists client_signature_path,
--     drop column if exists client_signature_file_name,
--     drop column if exists ba_number,
--     drop column if exists ba_period_start,
--     drop column if exists ba_period_end,
--     drop column if exists ba_notes,
--     drop column if exists ba_generated_at,
--     drop column if exists ba_generated_by;
--   drop function if exists public.next_ba_number(uuid, int);
--   drop table if exists public.tenant_ba_counters;

alter table public.monthly_reports
  -- Dispatch audit — who and when the PM handed the report to client.
  add column if not exists sent_to_client_at  timestamptz,
  add column if not exists sent_to_client_by  uuid references public.employees(id) on delete set null,
  -- PM records the client's decision. `client_reviewer_name` is free
  -- text because clients don't have ControlDesk accounts in this
  -- slice. Signature is a Supabase Storage path (bucket
  -- `tenant-attachments`, convention {tenant}/monthly_reports/{id}/signature-*).
  add column if not exists client_reviewer_name       text,
  add column if not exists client_reviewer_email      text,
  add column if not exists client_decided_at          timestamptz,
  add column if not exists client_decision_notes      text,
  add column if not exists client_signature_path      text,
  add column if not exists client_signature_file_name text,
  -- Berita Acara — record only. Number auto-generated, unique per
  -- tenant so we can support historical lookup by BA reference.
  add column if not exists ba_number         text,
  add column if not exists ba_period_start   date,
  add column if not exists ba_period_end     date,
  add column if not exists ba_notes          text,
  add column if not exists ba_generated_at   timestamptz,
  add column if not exists ba_generated_by   uuid references public.employees(id) on delete set null;

comment on column public.monthly_reports.sent_to_client_at is
  'When the PM dispatched the report to the client (Slice B).';
comment on column public.monthly_reports.client_reviewer_name is
  'Name of the client representative who approved/rejected (free text — clients have no ControlDesk account in Slice B).';
comment on column public.monthly_reports.client_signature_path is
  'Supabase Storage path for the signed report or client signature image. Convention: {tenant_id}/monthly_reports/{report_id}/signature-*.';
comment on column public.monthly_reports.ba_number is
  'Berita Acara reference number — unique per tenant. Format `BA/{tenant_slug}/{year}/NNNN`.';

-- Unique BA number per tenant. Partial index because most rows never
-- reach `ba_number` (only rows past BA_GENERATED).
create unique index if not exists monthly_reports_ba_number_uidx
  on public.monthly_reports (tenant_id, ba_number)
  where ba_number is not null;

-- ---------------------------------------------------------------------
-- Per-tenant per-year counter for BA numbering. Kept in a dedicated
-- table so we can atomically bump via `INSERT … ON CONFLICT DO UPDATE`
-- without stalling other writes. A plain Postgres sequence wouldn't
-- reset per year and wouldn't scope by tenant.
-- ---------------------------------------------------------------------
create table if not exists public.tenant_ba_counters (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  year       int  not null check (year between 2000 and 2100),
  last_seq   int  not null default 0 check (last_seq >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, year)
);

alter table public.tenant_ba_counters enable row level security;

create policy tenant_ba_counters_read on public.tenant_ba_counters
  for select using (tenant_id = current_tenant_id());
-- Writes are intentionally not exposed via policy — mutation only
-- goes through the SECURITY DEFINER `next_ba_number()` helper below,
-- which bypasses RLS with its own tenant argument enforcement.

create or replace function public.next_ba_number(
  v_tenant_id uuid,
  v_year int
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seq  int;
  v_slug text;
begin
  if v_tenant_id is null then
    raise exception 'tenant_id is required';
  end if;
  if v_year is null then
    v_year := extract(year from now())::int;
  end if;

  -- Atomic upsert-and-bump. `RETURNING` gives the new sequence value
  -- without a race condition, even when many PMs generate BAs
  -- concurrently.
  insert into public.tenant_ba_counters as t (tenant_id, year, last_seq)
    values (v_tenant_id, v_year, 1)
  on conflict (tenant_id, year) do update
    set last_seq   = t.last_seq + 1,
        updated_at = now()
  returning last_seq into v_seq;

  select coalesce(upper(slug), 'X') into v_slug
    from public.tenants where id = v_tenant_id;

  return 'BA/' || v_slug || '/' || v_year || '/' || lpad(v_seq::text, 4, '0');
end $$;

revoke all on function public.next_ba_number(uuid, int) from public;
grant execute on function public.next_ba_number(uuid, int) to authenticated;

comment on function public.next_ba_number(uuid, int) is
  'Return the next Berita Acara reference for the given tenant + year, atomically bumping the per-tenant counter. Format `BA/{slug}/{yyyy}/NNNN`.';

-- ---------------------------------------------------------------------
-- New notification kinds for Slice B.
-- ---------------------------------------------------------------------
do $$ begin
  alter type public.notification_kind add value if not exists 'MONTHLY_REPORT_SENT_TO_CLIENT';
  alter type public.notification_kind add value if not exists 'MONTHLY_REPORT_APPROVED_BY_CLIENT';
  alter type public.notification_kind add value if not exists 'MONTHLY_REPORT_REJECTED_BY_CLIENT';
  alter type public.notification_kind add value if not exists 'MONTHLY_REPORT_BA_GENERATED';
exception when others then null; end $$;
