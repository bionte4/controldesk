-- =============================================================================
-- 0047 — Add FIELD_TECHNICIAN to project_member_role enum.
--
-- Split into its own migration because Postgres refuses to use a newly
-- added enum value inside the same transaction (SQLSTATE 55P04:
-- "unsafe use of new value ... of enum type"). Migration 0048 uses this
-- value in helper functions and would fail otherwise.
--
-- Rollback: enum values cannot be removed via ALTER TYPE. Rows referencing
-- FIELD_TECHNICIAN would need to be re-classified first (e.g. to MEMBER),
-- then a new enum can be created and swapped in via
-- `alter table ... alter column ... type ... using ...`.
-- =============================================================================

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'project_member_role'
      and e.enumlabel = 'FIELD_TECHNICIAN'
  ) then
    alter type public.project_member_role add value 'FIELD_TECHNICIAN';
  end if;
end$$;

comment on type public.project_member_role is
  'Non-PM member role on a project (rules §7). FIELD_TECHNICIAN grants '
  'access to the field-ops cash advance flow (mockup: Pengajuan Dana '
  'Operasional Lapangan). PM roles still live in project_pm_assignments.';
