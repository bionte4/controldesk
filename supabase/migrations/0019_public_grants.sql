-- 0019_public_grants.sql
-- Rules §5 — grant the standard Supabase role trio (anon / authenticated
-- / service_role) SELECT/INSERT/UPDATE/DELETE on every table + sequence
-- created by our earlier migrations, and set default privileges so that
-- future tables also inherit these grants.
--
-- Rollback:
--   revoke all on all tables    in schema public from anon, authenticated, service_role;
--   revoke all on all sequences in schema public from anon, authenticated, service_role;
--   alter default privileges for role postgres in schema public
--     revoke all on tables from anon, authenticated, service_role;
--   alter default privileges for role postgres in schema public
--     revoke all on sequences from anon, authenticated, service_role;
--
-- Why this is needed: `supabase start` initialises the DB with default
-- privileges for the `supabase_admin` role that auto-grant everything
-- to the Supabase client roles. Migrations, however, run as the
-- `postgres` role, whose default privileges only include Dxtm (delete,
-- truncate, references, trigger). Without this migration every table
-- created since 0002 is unreachable via the PostgREST APIs — even for
-- service_role — because it lacks the base SELECT grant. RLS then
-- becomes irrelevant; PostgREST rejects the request before the policy
-- is even evaluated.
-- ----------------------------------------------------------------------------

-- --- 1. Catch-up grants on every already-landed table + sequence -----------
grant usage on schema public
  to anon, authenticated, service_role;

grant select, insert, update, delete
  on all tables in schema public
  to authenticated, service_role;

grant select
  on all tables in schema public
  to anon;

grant usage, select, update
  on all sequences in schema public
  to anon, authenticated, service_role;

grant execute
  on all functions in schema public
  to anon, authenticated, service_role;

-- --- 2. Default privileges for tables created BY the postgres role --------
--     Applies to every migration that lands AFTER 0019.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

alter default privileges for role postgres in schema public
  grant select on tables to anon;

alter default privileges for role postgres in schema public
  grant usage, select, update on sequences to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated, service_role;

comment on schema public is
  'RLS is the real gatekeeper on tenant-scoped data (rules §5). This
   migration only ensures the base object-level grants exist so
   PostgREST can reach the tables at all; every SELECT / DML still
   traverses the policies declared in migrations 0002…0018.';
