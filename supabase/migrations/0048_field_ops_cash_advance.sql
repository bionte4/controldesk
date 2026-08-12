-- =============================================================================
-- 0048 — Field Ops Cash Advance form (rules §9 / §11 + mockup).
--
-- Extends `cash_advances` (ca_type='FIELD_OPS') with two child tables that
-- capture the extra fields required by the "Pengajuan Dana Operasional
-- Lapangan" form:
--
--   1. `cash_advance_field_ops_details` — 1:1 with `cash_advances`, stores
--      ticket-based context (ticket, area, PIC), transportation planning,
--      and the disbursement bank account.
--
--   2. `cash_advance_rab_lines` — N:1 with `cash_advances`, stores the
--      user-composed RAB (Rincian Anggaran) rows. An AFTER trigger keeps
--      `cash_advances.amount` in sync with SUM(rab_lines.amount) so the
--      state machine's threshold matrix always reads a coherent total.
--
-- Also adds:
--   - Enum value `FIELD_TECHNICIAN` to `project_member_role` so employees
--     can be flagged as field-workers via their active project assignment.
--     Detection is assignment-scoped, letting one person be a field tech on
--     one project and a plain member on another (rules §7 multi-project).
--
--   - Helper `has_active_field_tech_assignment(uuid)` — returns TRUE when
--     the given employee has ≥1 ACTIVE assignment with
--     role='FIELD_TECHNICIAN'. Used by the UI to gate the "Pengajuan
--     Operasional" button.
--
--   - Helper `resolve_field_ops_l2_approver(uuid)` — returns the employee
--     to notify at the L2 (Manager On-site) step of a FIELD_OPS cash
--     advance for a given project. Preference: SITE_SUPERVISOR assignment
--     → PROJECT_MANAGER (via project_pm_assignments PRIMARY_PM) →
--     project_employee_assignments with role=TECH_LEAD as a last resort.
--
-- The canonical state machine + threshold matrix
-- (`caFieldOpsApprovalChain`) already handles the chain shape (SPV → PM →
-- OM → FINANCE → DIRECTOR with thresholds 5jt / 20jt / 50jt), so no state
-- machine changes are required here.
--
-- -----------------------------------------------------------------------------
-- Rollback:
--   drop function if exists public.resolve_field_ops_l2_approver(uuid);
--   drop function if exists public.has_active_field_tech_assignment(uuid);
--   drop trigger  if exists carab_sync_ca_amount     on public.cash_advance_rab_lines;
--   drop function if exists public.carab_sync_ca_amount();
--   drop table    if exists public.cash_advance_rab_lines;
--   drop table    if exists public.cash_advance_field_ops_details;
--   -- Note: project_member_role enum value FIELD_TECHNICIAN cannot be
--   -- removed by ALTER TYPE; leaving it in place is harmless because
--   -- existing rows keep working. If a full rollback is required,
--   -- recreate the enum and re-typecast the column via
--   -- alter table … alter column … type public.project_member_role using …
-- =============================================================================

-- Prerequisite: migration 0047_field_ops_enum.sql (adds FIELD_TECHNICIAN to
-- project_member_role) must have been applied first.

-- ---------------------------------------------------------------------------
-- 1. cash_advance_field_ops_details — 1:1 with cash_advances.
-- ---------------------------------------------------------------------------
create table if not exists public.cash_advance_field_ops_details (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  cash_advance_id   uuid not null unique references public.cash_advances(id) on delete cascade,

  -- Section 1: Informasi Pekerjaan & Site.
  ticket_number     text not null,
  justification     text,
  unit_pengaju      text,
  cid_company       text,
  area              text,
  tujuan            text,
  pic_name          text,
  pic_phone         text,
  pickup_key_bts    boolean not null default false,

  -- Section 2: Transportasi & Lokasi.
  transport_need    text,
  jarak_pp_km       numeric(7,1),
  gmap_duration     text,
  driver_phone      text,

  -- Section 3: Informasi Rekening Pencairan.
  -- NOTE: `bank_account_no` is PII (rules §3). Column type is plain text
  -- for now; a later migration will introduce pgcrypto-backed encryption.
  -- The UI must mask this value for non-Finance roles.
  bank_owner_name   text,
  bank_name         text,
  bank_account_no   text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.employees(id) on delete set null,
  updated_by        uuid references public.employees(id) on delete set null,

  constraint cafod_ticket_not_blank check (length(trim(ticket_number)) > 0),
  constraint cafod_jarak_reasonable check (jarak_pp_km is null or jarak_pp_km >= 0)
);

comment on table public.cash_advance_field_ops_details is
  'Field-ops specific details for a cash_advance row (ca_type=FIELD_OPS). '
  '1:1 with cash_advances via cash_advance_id UNIQUE FK.';

create index if not exists cafod_tenant_ca_idx
  on public.cash_advance_field_ops_details (tenant_id, cash_advance_id);
create index if not exists cafod_tenant_ticket_idx
  on public.cash_advance_field_ops_details (tenant_id, ticket_number);

-- updated_at helper.
create or replace function public.cafod_bump_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cafod_updated_at on public.cash_advance_field_ops_details;
create trigger cafod_updated_at
  before update on public.cash_advance_field_ops_details
  for each row execute function public.cafod_bump_updated_at();

alter table public.cash_advance_field_ops_details enable row level security;

drop policy if exists cafod_tenant_read on public.cash_advance_field_ops_details;
create policy cafod_tenant_read
  on public.cash_advance_field_ops_details
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists cafod_tenant_write on public.cash_advance_field_ops_details;
create policy cafod_tenant_write
  on public.cash_advance_field_ops_details
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists cafod_tenant_update on public.cash_advance_field_ops_details;
create policy cafod_tenant_update
  on public.cash_advance_field_ops_details
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists cafod_tenant_delete on public.cash_advance_field_ops_details;
create policy cafod_tenant_delete
  on public.cash_advance_field_ops_details
  for delete
  to authenticated
  using (tenant_id = public.current_tenant_id());

grant select, insert, update, delete
  on public.cash_advance_field_ops_details
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. cash_advance_rab_lines — N:1 with cash_advances.
-- ---------------------------------------------------------------------------
create table if not exists public.cash_advance_rab_lines (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  cash_advance_id  uuid not null references public.cash_advances(id) on delete cascade,
  seq              smallint not null default 1,
  category         text not null,
  detail           text,
  amount           numeric(18,2) not null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint carab_amount_positive   check (amount > 0),
  constraint carab_category_not_blank check (length(trim(category)) > 0)
);

comment on table public.cash_advance_rab_lines is
  'Rincian Anggaran (RAB) line items for a cash_advance row. Aggregate '
  'SUM(amount) is kept in sync with cash_advances.amount via trigger.';

create index if not exists carab_tenant_ca_idx
  on public.cash_advance_rab_lines (tenant_id, cash_advance_id, seq);

alter table public.cash_advance_rab_lines enable row level security;

drop policy if exists carab_tenant_read on public.cash_advance_rab_lines;
create policy carab_tenant_read
  on public.cash_advance_rab_lines
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists carab_tenant_write on public.cash_advance_rab_lines;
create policy carab_tenant_write
  on public.cash_advance_rab_lines
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

drop policy if exists carab_tenant_update on public.cash_advance_rab_lines;
create policy carab_tenant_update
  on public.cash_advance_rab_lines
  for update
  to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists carab_tenant_delete on public.cash_advance_rab_lines;
create policy carab_tenant_delete
  on public.cash_advance_rab_lines
  for delete
  to authenticated
  using (tenant_id = public.current_tenant_id());

grant select, insert, update, delete
  on public.cash_advance_rab_lines
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Trigger — keep cash_advances.amount in sync with SUM(rab_lines.amount).
--    Fires on INSERT / UPDATE / DELETE on cash_advance_rab_lines.
--    cash_advances.amount has CHECK (amount > 0); the server action inserts
--    the first RAB row inside the same transaction as the parent so the
--    invariant holds. If the last RAB row is later deleted (leaving zero)
--    we leave the parent's amount untouched — the app is expected to
--    treat that as a validation error before submit.
-- ---------------------------------------------------------------------------
create or replace function public.carab_sync_ca_amount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ca_id     uuid;
  v_new_total numeric(18,2);
begin
  if tg_op = 'DELETE' then
    v_ca_id := old.cash_advance_id;
  else
    v_ca_id := new.cash_advance_id;
  end if;

  select coalesce(sum(amount), 0)
    into v_new_total
    from public.cash_advance_rab_lines
   where cash_advance_id = v_ca_id;

  if v_new_total > 0 then
    update public.cash_advances
       set amount     = v_new_total,
           updated_at = now()
     where id = v_ca_id;
  end if;

  return null;
end;
$$;

drop trigger if exists carab_sync_ca_amount on public.cash_advance_rab_lines;
create trigger carab_sync_ca_amount
  after insert or update or delete on public.cash_advance_rab_lines
  for each row execute function public.carab_sync_ca_amount();

-- ---------------------------------------------------------------------------
-- 5. Helper — has_active_field_tech_assignment(uuid emp_id) → boolean.
--    Determines whether the given employee currently holds at least one
--    ACTIVE project_employee_assignment row with role='FIELD_TECHNICIAN'.
--    Used by the UI to gate the "Pengajuan Operasional" button.
-- ---------------------------------------------------------------------------
create or replace function public.has_active_field_tech_assignment(p_emp_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_employee_assignments pea
    where pea.tenant_id  = public.current_tenant_id()
      and pea.employee_id = p_emp_id
      and pea.status      = 'ACTIVE'
      and pea.role        = 'FIELD_TECHNICIAN'
  );
$$;

comment on function public.has_active_field_tech_assignment(uuid) is
  'True when the employee holds ≥1 ACTIVE project_employee_assignment with '
  'role=FIELD_TECHNICIAN. Used to gate the "Pengajuan Operasional" flow.';

grant execute on function public.has_active_field_tech_assignment(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Helper — resolve_field_ops_l2_approver(uuid project_id) → uuid.
--    Returns the employee to notify / expect at the L2 (Manager On-site)
--    step of a FIELD_OPS cash advance for the given project. Preference:
--      (a) Active SITE_SUPERVISOR assignment on that project
--      (b) Active PRIMARY_PM in project_pm_assignments
--      (c) Active CO_PM in project_pm_assignments
--    Returns NULL if none is set — the caller (server action) should
--    surface a clear "assign a Site Supervisor / PM first" error.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_field_ops_l2_approver(p_project_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with candidates as (
    -- (a) SITE_SUPERVISOR takes precedence.
    select 1 as rank, pea.employee_id
    from public.project_employee_assignments pea
    where pea.tenant_id  = public.current_tenant_id()
      and pea.project_id = p_project_id
      and pea.status     = 'ACTIVE'
      and pea.role       = 'SITE_SUPERVISOR'
    union all
    -- (b/c) Fallback: PM slots on the project.
    select case ppa.assignment_role
             when 'PRIMARY_PM' then 2
             when 'CO_PM'      then 3
             else 4
           end as rank,
           ppa.pm_employee_id as employee_id
    from public.project_pm_assignments ppa
    where ppa.tenant_id  = public.current_tenant_id()
      and ppa.project_id = p_project_id
      and ppa.status     = 'ACTIVE'
  )
  select employee_id
  from candidates
  order by rank asc, employee_id asc
  limit 1;
$$;

comment on function public.resolve_field_ops_l2_approver(uuid) is
  'Resolves the L2 approver for a FIELD_OPS cash advance on a given '
  'project. Preference SITE_SUPERVISOR → PRIMARY_PM → CO_PM. NULL when '
  'the project has no active supervisor / PM assignment.';

grant execute on function public.resolve_field_ops_l2_approver(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Attachments — extend allowed resource_type check (if any).
--    The `attachments.resource_type` column is a plain text column with
--    an application-enforced vocabulary; no DB-level change is needed as
--    long as the app writes 'cash_advance' + JSONB metadata for the
--    upload kind (gmap_screenshot | supporting_memo).
-- ---------------------------------------------------------------------------

-- =============================================================================
-- End of migration 0047.
-- =============================================================================
