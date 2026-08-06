-- ControlDesk — 0007_storage_buckets.sql
-- Supabase Storage bucket + tenant-scoped RLS (rules §19).
--
-- Convention:
--   Bucket:  `tenant-attachments` (private)
--   Path:    {tenant_id}/{resource_type}/{resource_id}/{filename}
--   Access:  Signed URLs only (TTL 300s), no public URLs.
--
-- Rollback:
--   delete from storage.buckets where id = 'tenant-attachments';
--   drop policy if exists storage_tenant_read on storage.objects;
--   drop policy if exists storage_tenant_insert on storage.objects;
--   drop policy if exists storage_tenant_delete on storage.objects;

-- ---------------------------------------------------------------------------
-- 1. Bucket.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tenant-attachments',
  'tenant-attachments',
  false,
  10485760,  -- 10 MB (contract PDFs can override at the app layer)
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. RLS on storage.objects — path prefix must match the caller's tenant.
--
-- `storage.foldername(name)` returns the leading path segments as an array;
-- `[1]` is the tenant_id folder (see §19 path convention).
-- ---------------------------------------------------------------------------
drop policy if exists storage_tenant_read on storage.objects;
create policy storage_tenant_read
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'tenant-attachments'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

drop policy if exists storage_tenant_insert on storage.objects;
create policy storage_tenant_insert
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'tenant-attachments'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

drop policy if exists storage_tenant_delete on storage.objects;
create policy storage_tenant_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'tenant-attachments'
    and (storage.foldername(name))[1] = public.current_tenant_id()::text
  );

-- No UPDATE policy — files are immutable. Uploaders must delete + re-upload
-- via a new attachment row (which produces a fresh audit trail).
