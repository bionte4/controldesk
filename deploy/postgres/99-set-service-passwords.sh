#!/bin/sh
set -eu

# The Supabase service containers use the shared POSTGRES_PASSWORD from
# docker-compose.prod.yml. The base image creates these roles without login
# passwords, so assign the deployment password after its migrate.sh completes.
psql --no-password --no-psqlrc -v ON_ERROR_STOP=1 \
  -v service_password="$POSTGRES_PASSWORD" -U supabase_admin -d postgres <<'SQL'
alter role postgres password :'service_password';
alter role authenticator password :'service_password';
alter role supabase_admin password :'service_password';
alter role supabase_auth_admin password :'service_password';
alter role supabase_storage_admin password :'service_password';
create schema if not exists _realtime authorization supabase_admin;
SQL
