-- ControlDesk — 0035_clients_contract_info.sql
-- Adds primary contract & project-code reference fields to `clients` (rules §6, §22).
--
-- Motivation:
--   ERP migration teams frequently need to record the *primary* / current
--   contract number and internal project code (PID) at the CLIENT level, so
--   ops can locate the client by MSA# or legacy project ID even before the
--   dedicated `bpo_contracts` / `projects` rows exist. Both columns are
--   nullable text (reference-only) and DO NOT replace the `bpo_contracts`
--   table or `projects.code` — those remain the sources of truth for
--   accounting and delivery.
--
-- Rollback:
--   ```
--   alter table public.clients drop column if exists contract_number;
--   alter table public.clients drop column if exists project_code;
--   drop index if exists public.clients_tenant_contract_number_idx;
--   drop index if exists public.clients_tenant_project_code_idx;
--   ```

alter table public.clients
  add column if not exists contract_number text,
  add column if not exists project_code    text;

comment on column public.clients.contract_number is
  'Primary/reference contract number (e.g., MSA#, retainer, SOW). Free-text; source of truth for accounting is bpo_contracts.contract_number.';
comment on column public.clients.project_code is
  'Client-side project identifier / legacy PID for cross-referencing (rules §6). Source of truth for delivery is projects.code.';

-- Length guards (aligned with the Zod schema in src/lib/validation/client.ts).
alter table public.clients
  drop constraint if exists clients_contract_number_len,
  add  constraint clients_contract_number_len
    check (contract_number is null or char_length(contract_number) <= 64);

alter table public.clients
  drop constraint if exists clients_project_code_len,
  add  constraint clients_project_code_len
    check (project_code is null or char_length(project_code) <= 64);

-- Non-unique indexes for tenant-scoped lookup / search (rules §22).
create index if not exists clients_tenant_contract_number_idx
  on public.clients (tenant_id, contract_number)
  where contract_number is not null;

create index if not exists clients_tenant_project_code_idx
  on public.clients (tenant_id, project_code)
  where project_code is not null;
