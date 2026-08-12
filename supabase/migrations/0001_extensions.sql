-- ControlDesk — 0001_extensions.sql
-- Enables Postgres extensions required by the whole schema.

create extension if not exists "pgcrypto"  with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists "citext"    with schema extensions;

-- Convenience: `gen_random_uuid()` from pgcrypto is used everywhere below.
