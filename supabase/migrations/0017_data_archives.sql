-- ControlDesk — 0017_data_archives.sql
-- Cold-storage archive layer for long-retention financial + audit data
-- (rules §22). The archive job exports rows past their `archive_after_days`
-- window into signed NDJSON gzip blobs on Supabase Storage, and records
-- each batch in `public.data_archives` before the retention worker is
-- ever allowed to hard-purge the source rows.
--
-- Design invariants:
--   • Every archive artifact is scoped to (tenant_id, source_table, batch_range).
--   • Restore is always signed-URL + service-role — no public artifacts.
--   • The registry table is INSERT + UPDATE only (updates limited to
--     purged_at / restore_verified_at). Rows are never deleted; they act as
--     the compliance breadcrumb.
--
-- Rollback:
--   drop table if exists public.data_archives cascade;
--   drop type  if exists public.data_archive_source cascade;
--   drop type  if exists public.data_archive_status cascade;
--   delete from storage.buckets where id = 'tenant-archives';
--   drop policy if exists archives_tenant_read   on storage.objects;
--   drop policy if exists archives_service_write on storage.objects;

-- ---------------------------------------------------------------------------
-- 1. Enums.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'data_archive_source') then
    create type public.data_archive_source as enum (
      'security_audit_logs',
      'cash_advance_settlements',
      'petty_cash_vouchers',
      'project_expenses',
      'cash_advances'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'data_archive_status') then
    create type public.data_archive_status as enum (
      'PENDING',      -- registry row inserted, upload not yet confirmed
      'ARCHIVED',     -- upload committed, source rows still present
      'PURGED',       -- source rows deleted, artifact retained
      'RESTORED',     -- artifact re-imported (rare)
      'FAILED'        -- upload or checksum failed; requires ops attention
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. `data_archives` registry.
-- ---------------------------------------------------------------------------
create table if not exists public.data_archives (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  source_table          public.data_archive_source not null,
  batch_start           timestamptz not null,     -- earliest source row created_at (inclusive)
  batch_end             timestamptz not null,     -- latest   source row created_at (exclusive)
  row_count             integer not null check (row_count >= 0),
  bytes_written         bigint not null check (bytes_written >= 0),
  storage_path          text not null,            -- e.g. {tenant_id}/security_audit_logs/2018-Q1.ndjson.gz
  checksum_sha256       text not null,
  status                public.data_archive_status not null default 'PENDING',
  error_message         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  purged_at             timestamptz,
  purged_row_count      integer check (purged_row_count is null or purged_row_count >= 0),
  restore_verified_at   timestamptz,
  constraint archives_batch_range_ordered check (batch_end > batch_start),
  constraint archives_unique_batch unique (tenant_id, source_table, batch_start, batch_end)
);

comment on table public.data_archives is
  'Cold-storage archive registry (rules §22). One row per (tenant, source, batch range). Immutable except for status transitions.';

create index if not exists data_archives_tenant_source_idx
  on public.data_archives (tenant_id, source_table, batch_end desc);
create index if not exists data_archives_status_idx
  on public.data_archives (status, created_at desc);

-- Immutability guard: allow status transitions but never let anyone rewrite
-- historical batch metadata.
create or replace function public.enforce_data_archive_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.tenant_id      is distinct from new.tenant_id      then raise exception 'tenant_id is immutable'; end if;
  if old.source_table   is distinct from new.source_table   then raise exception 'source_table is immutable'; end if;
  if old.batch_start    is distinct from new.batch_start    then raise exception 'batch_start is immutable'; end if;
  if old.batch_end      is distinct from new.batch_end      then raise exception 'batch_end is immutable'; end if;
  if old.storage_path   is distinct from new.storage_path   then raise exception 'storage_path is immutable'; end if;
  if old.checksum_sha256 is distinct from new.checksum_sha256 then raise exception 'checksum_sha256 is immutable'; end if;
  if old.row_count      is distinct from new.row_count      then raise exception 'row_count is immutable'; end if;
  if old.bytes_written  is distinct from new.bytes_written  then raise exception 'bytes_written is immutable'; end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_data_archives_immutable on public.data_archives;
create trigger trg_data_archives_immutable
  before update on public.data_archives
  for each row
  execute function public.enforce_data_archive_immutability();

-- Deletes are never allowed on registry — they are compliance breadcrumbs.
create or replace function public.enforce_data_archive_no_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'data_archives rows cannot be deleted; mark PURGED instead';
end $$;

drop trigger if exists trg_data_archives_no_delete on public.data_archives;
create trigger trg_data_archives_no_delete
  before delete on public.data_archives
  for each row
  execute function public.enforce_data_archive_no_delete();

-- ---------------------------------------------------------------------------
-- 3. RLS — TENANT_ADMIN + GM read-only, service_role full write.
-- ---------------------------------------------------------------------------
alter table public.data_archives enable row level security;

drop policy if exists data_archives_service_all on public.data_archives;
create policy data_archives_service_all
  on public.data_archives
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists data_archives_tenant_read on public.data_archives;
create policy data_archives_tenant_read
  on public.data_archives
  for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_employee_role() in ('TENANT_ADMIN', 'GENERAL_MANAGER')
  );

-- ---------------------------------------------------------------------------
-- 4. Storage bucket — `tenant-archives` (private, no MIME allowlist since we
--    upload gzipped NDJSON).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values (
  'tenant-archives',
  'tenant-archives',
  false,
  524288000     -- 500 MB per artifact ceiling
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- Path convention: {tenant_id}/{source_table}/{yyyy}/{yyyy-mm}.ndjson.gz
drop policy if exists archives_tenant_read on storage.objects;
create policy archives_tenant_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'tenant-archives'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
    and public.current_employee_role() in ('TENANT_ADMIN', 'GENERAL_MANAGER')
  );

-- Only service_role writes. Do NOT grant INSERT / UPDATE / DELETE to any
-- other role; the archive worker runs on the server with the service key.
drop policy if exists archives_service_write on storage.objects;
create policy archives_service_write
  on storage.objects
  for insert
  to service_role
  with check (bucket_id = 'tenant-archives');

-- ---------------------------------------------------------------------------
-- 5. `purge_archived_audit_logs` — SECURITY DEFINER function to hard-delete
--    audit-log rows within a batch window. The plain retention worker cannot
--    delete rows directly because migration 0004 attaches an append-only
--    immutability trigger. This function suspends the trigger locally and
--    verifies that a matching ARCHIVED batch exists before running the
--    DELETE — no cold copy, no purge.
-- ---------------------------------------------------------------------------
create or replace function public.purge_archived_audit_logs(
  p_tenant_id  uuid,
  p_batch_start timestamptz,
  p_batch_end  timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_registry_id uuid;
  v_deleted int := 0;
begin
  select id into v_registry_id
    from public.data_archives
   where tenant_id    = p_tenant_id
     and source_table = 'security_audit_logs'
     and batch_start  = p_batch_start
     and batch_end    = p_batch_end
     and status       = 'ARCHIVED';

  if v_registry_id is null then
    raise exception 'no ARCHIVED data_archives row for %/%/%',
      p_tenant_id, p_batch_start, p_batch_end
      using errcode = '42501';
  end if;

  -- Locally bypass the immutability trigger for THIS statement only. The
  -- session_replication_role is reset when the transaction ends.
  set local session_replication_role = replica;

  with deleted as (
    delete from public.security_audit_logs
     where tenant_id = p_tenant_id
       and created_at >= p_batch_start
       and created_at <  p_batch_end
    returning 1
  )
  select count(*) into v_deleted from deleted;

  update public.data_archives
     set status = 'PURGED',
         purged_at = now(),
         purged_row_count = v_deleted
   where id = v_registry_id;

  return v_deleted;
end $$;

comment on function public.purge_archived_audit_logs(uuid, timestamptz, timestamptz) is
  'Rules §22: hard-delete audit rows only after a matching ARCHIVED batch exists. Bypasses the append-only trigger via session_replication_role=replica.';

revoke all on function public.purge_archived_audit_logs(uuid, timestamptz, timestamptz) from public, authenticated;
grant execute on function public.purge_archived_audit_logs(uuid, timestamptz, timestamptz) to service_role;
