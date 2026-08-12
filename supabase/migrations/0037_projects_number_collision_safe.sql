-- ControlDesk — 0037_projects_number_collision_safe.sql
--
-- Fixes two issues introduced by 0036 when the DB already had rows with
-- manually-assigned `project_number` values (seed data, imported legacy
-- projects, or backfills from GAS):
--
--   Issue 1 (backfill gap): `project_numbering_sequence.last_seq` only
--     tracks trigger-generated numbers, so seeded rows like PRJ-2026-0002
--     were never observed by the counter. First auto-generated number in
--     that tenant/year then collided on
--     `projects_tenant_project_number_uniq`.
--
--   Issue 2 (defence in depth): even after backfilling, a caller could
--     manually insert a future number (e.g. PRJ-2026-0099) causing the
--     next generated value to eventually hit the same collision. The
--     trigger must be self-healing.
--
-- Fix:
--   a) Backfill `project_numbering_sequence` from the max PRJ-{YYYY}-####
--      already present in `public.projects`, per tenant per year.
--   b) Rewrite `auto_generate_project_number` to LOOP until it finds a
--      `project_number` that does not clash with an existing row, bumping
--      the sequence on every attempt. Bounded loop (max 10_000 attempts,
--      matching the 4-digit width) so a runaway never hangs the insert.
--
-- Rollback:
--   drop function if exists public.auto_generate_project_number();
--   (re-apply the definition from 0036 to revert)

-- ---------------------------------------------------------------------------
-- 1. Backfill sequence from existing rows
-- ---------------------------------------------------------------------------
-- Regex captures rows whose project_number matches PRJ-YYYY-#### (the format
-- 0036 generates). Any legacy number in a different shape (e.g. INDO-HELP)
-- is ignored — those cannot collide with generated numbers.
insert into public.project_numbering_sequence (tenant_id, year, last_seq)
select
  p.tenant_id,
  (substring(p.project_number from 5 for 4))::int   as year,
  max((substring(p.project_number from 10 for 4))::int) as last_seq
from public.projects p
where p.project_number ~ '^PRJ-[0-9]{4}-[0-9]{4}$'
group by p.tenant_id, (substring(p.project_number from 5 for 4))::int
on conflict (tenant_id, year)
do update set last_seq = greatest(
  public.project_numbering_sequence.last_seq,
  excluded.last_seq
);

-- ---------------------------------------------------------------------------
-- 2. Collision-safe trigger
-- ---------------------------------------------------------------------------
create or replace function public.auto_generate_project_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year    integer := extract(year from coalesce(new.start_date, current_date))::int;
  v_seq     integer;
  v_num     text;
  v_exists  boolean;
  v_attempts integer := 0;
begin
  -- Caller supplied their own number (e.g. data migration) — trust it.
  if new.project_number is not null and length(trim(new.project_number)) > 0 then
    return new;
  end if;

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 10000 then
      raise exception 'auto_generate_project_number: exhausted 4-digit range for tenant % year %', new.tenant_id, v_year;
    end if;

    -- Bump the sequence atomically. `on conflict do update` guarantees a
    -- single unique value per concurrent inserter within the same tenant/year.
    insert into public.project_numbering_sequence (tenant_id, year, last_seq)
         values (new.tenant_id, v_year, 1)
    on conflict (tenant_id, year)
    do update set last_seq = public.project_numbering_sequence.last_seq + 1
    returning last_seq into v_seq;

    v_num := format('PRJ-%s-%s', v_year, lpad(v_seq::text, 4, '0'));

    -- Skip past manually-assigned numbers that already exist for this tenant.
    select exists (
      select 1
        from public.projects
       where tenant_id = new.tenant_id
         and project_number = v_num
    ) into v_exists;

    exit when not v_exists;
  end loop;

  new.project_number := v_num;
  return new;
end;
$$;

comment on function public.auto_generate_project_number() is
  'BEFORE INSERT trigger: assigns projects.project_number = PRJ-{YYYY}-{seq:04}. Collision-safe (0037): loops past any pre-existing number in the same tenant/year so legacy/seed rows do not break autonumbering.';
