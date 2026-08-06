-- ControlDesk — 0018_secret_rotations.sql
-- Cross-tenant secret-rotation registry (rules §22 + docs/ops/secret-rotation.md).
--
-- Secrets like `APP_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`,
-- observability tokens, and SMTP creds are *infrastructure-global* — they do
-- not belong to any tenant. This table records the last time each was
-- rotated so the `/api/cron/rotation-check` job can page ops when the 90-day
-- window is closing.
--
-- Design invariants:
--   • One row per environment variable name (unique primary key).
--   • `rotation_interval_days` defaults to 90 (rules §22); some secrets
--     (P0) may be tightened to 60 later.
--   • `last_rotated_at` bumps to now() when TENANT_ADMIN marks a secret
--     rotated in `/settings/secrets`.
--   • The table is INSERT + UPDATE only. Deletes are blocked by a trigger.
--
-- Rollback:
--   drop table if exists public.secret_rotations cascade;
--   drop function if exists public.secret_rotation_status();
--   drop type if exists public.secret_priority cascade;

-- ---------------------------------------------------------------------------
-- 1. Enum for priority (matches the rotation runbook).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'secret_priority') then
    create type public.secret_priority as enum ('P0', 'P1', 'P2');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Registry table.
-- ---------------------------------------------------------------------------
create table if not exists public.secret_rotations (
  name                    text primary key,
  priority                public.secret_priority not null,
  purpose                 text not null,
  last_rotated_at         timestamptz not null default now(),
  rotation_interval_days  integer not null default 90 check (rotation_interval_days > 0),
  last_rotated_by         uuid references auth.users(id) on delete set null,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.secret_rotations is
  'Cross-tenant infrastructure secret registry (rules §22). Tracks last rotation timestamp for 90-day compliance.';

create index if not exists secret_rotations_priority_idx
  on public.secret_rotations (priority, last_rotated_at);

-- ---------------------------------------------------------------------------
-- 3. Immutability trigger — allow only INSERT + UPDATE (never DELETE).
-- ---------------------------------------------------------------------------
create or replace function public.secret_rotations_forbid_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'secret_rotations rows are immutable; mark rotated instead'
    using errcode = '42501';
end $$;

drop trigger if exists secret_rotations_no_delete on public.secret_rotations;
create trigger secret_rotations_no_delete
  before delete on public.secret_rotations
  for each row execute function public.secret_rotations_forbid_delete();

create or replace function public.secret_rotations_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists secret_rotations_touch on public.secret_rotations;
create trigger secret_rotations_touch
  before update on public.secret_rotations
  for each row execute function public.secret_rotations_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS — TENANT_ADMIN + GENERAL_MANAGER may SELECT (for /settings/secrets);
--    UPDATE reserved for TENANT_ADMIN. Service role bypasses.
-- ---------------------------------------------------------------------------
alter table public.secret_rotations enable row level security;

drop policy if exists secret_rotations_admin_read on public.secret_rotations;
create policy secret_rotations_admin_read
  on public.secret_rotations
  for select
  using (
    exists (
      select 1
        from public.employees e
       where e.user_id = auth.uid()
         and e.is_active = true
         and e.role in ('TENANT_ADMIN', 'GENERAL_MANAGER')
    )
  );

drop policy if exists secret_rotations_admin_update on public.secret_rotations;
create policy secret_rotations_admin_update
  on public.secret_rotations
  for update
  using (
    exists (
      select 1
        from public.employees e
       where e.user_id = auth.uid()
         and e.is_active = true
         and e.role    = 'TENANT_ADMIN'
    )
  )
  with check (
    exists (
      select 1
        from public.employees e
       where e.user_id = auth.uid()
         and e.is_active = true
         and e.role    = 'TENANT_ADMIN'
    )
  );

-- Service role bypasses RLS by definition; no INSERT policy needed for humans.

-- ---------------------------------------------------------------------------
-- 5. Status helper — computed severity per secret. Referenced by both the
--    cron job and the UI, so the logic lives in exactly one place.
-- ---------------------------------------------------------------------------
create or replace function public.secret_rotation_status()
returns table (
  name text,
  priority public.secret_priority,
  purpose text,
  last_rotated_at timestamptz,
  rotation_interval_days integer,
  days_since_rotation integer,
  days_until_due integer,
  severity text
)
language sql
stable
as $$
  select
    s.name,
    s.priority,
    s.purpose,
    s.last_rotated_at,
    s.rotation_interval_days,
    floor(extract(epoch from now() - s.last_rotated_at) / 86400)::int
      as days_since_rotation,
    (s.rotation_interval_days
       - floor(extract(epoch from now() - s.last_rotated_at) / 86400)::int)
      as days_until_due,
    case
      when now() - s.last_rotated_at > (s.rotation_interval_days || ' days')::interval
        then 'OVERDUE'
      when now() - s.last_rotated_at
             > ((s.rotation_interval_days - 14) || ' days')::interval
        then 'WARN'
      else 'OK'
    end as severity
  from public.secret_rotations s
$$;

comment on function public.secret_rotation_status() is
  'Computed rotation status. severity = OK (≥15 days remaining) / WARN (≤14 days) / OVERDUE (past due).';

-- ---------------------------------------------------------------------------
-- 6. Seed known secrets from the ops runbook. Idempotent — ON CONFLICT DO
--    NOTHING so re-running the migration in a stale environment is safe.
--    Runbook: docs/ops/secret-rotation.md.
-- ---------------------------------------------------------------------------
insert into public.secret_rotations (name, priority, purpose, notes)
values
  ('APP_ENCRYPTION_KEY',           'P0',
   'HRIS PII column encryption (salary / KTP / NPWP / bank_account).',
   'Rotation requires re-encryption migration — see runbook §APP_ENCRYPTION_KEY.'),
  ('SUPABASE_SERVICE_ROLE_KEY',    'P0',
   'Server actions, cron workers, storage uploads.',
   'Rotate via Supabase dashboard; zero-downtime with roll-during-deploy.'),
  ('CRON_SECRET',                  'P0',
   'Bearer auth for /api/cron/* endpoints.',
   'Regenerate with `openssl rand -hex 32`; update env + Vercel.'),
  ('SENTRY_DSN',                   'P1',
   'Observability sink for warn/error/fatal events (rules §21).',
   'Rotate DSN from Sentry project settings.'),
  ('AXIOM_TOKEN',                  'P1',
   'Alternative observability sink (Axiom dataset ingest).',
   'Rotate from Axiom org settings.'),
  ('OPENAI_API_KEY',               'P1',
   'AI Insights generation (rules §15).',
   'Falls back to mock provider when unset — safe to rotate any time.'),
  ('SMTP_PASS',                    'P1',
   'Digest emails + approval notifications (rules §20).',
   'Falls back to email_outbox SKIPPED state — safe to rotate any time.'),
  ('NEXT_PUBLIC_SUPABASE_ANON_KEY','P2',
   'Client-side Supabase auth + proxy tenant guard.',
   'Rotating requires a full app redeploy.')
on conflict (name) do nothing;
