-- ControlDesk — 0014_ai_insights.sql
-- Isolated AI Analytics Engine (rules §15).
--
-- Storage for tenant-scoped, PII-redacted AI insight runs. Auditability
-- (rules §3 + §15) requires we persist:
--   - the AI kind (one of four sanctioned analytics),
--   - the prompt version + model id used to generate it (reproducibility),
--   - the structured output (jsonb, Zod-validated at write time by the app),
--   - the tokens/latency spent (for cost cap & observability).
--
-- Read scope is tenant-only via RLS. Writes are performed with service_role
-- from the Server Action (bypasses RLS for the elevated write, but the
-- Server Action enforces tenant scope + PDP first).
--
-- Rollback:
--   drop table if exists public.ai_insights;
--   drop type if exists public.ai_insight_kind;
--   drop type if exists public.ai_insight_severity;

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ai_insight_kind') then
    create type public.ai_insight_kind as enum (
      'PREDICT_EXPENSE_IMPACT',
      'ANALYZE_RESOURCE_UTILIZATION',
      'ANALYZE_CLIENT_HEALTH',
      'ANALYZE_SLA_BREACH'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'ai_insight_severity') then
    create type public.ai_insight_severity as enum (
      'INFO', 'WARNING', 'CRITICAL'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. ai_insights
-- ---------------------------------------------------------------------------
create table if not exists public.ai_insights (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  kind              public.ai_insight_kind not null,
  severity          public.ai_insight_severity not null default 'INFO',
  headline          text not null,
  summary           text not null,
  -- Structured output (Zod-validated at write time in Server Action). Shape
  -- depends on `kind` — see `src/lib/ai/schemas.ts`.
  payload           jsonb not null default '{}'::jsonb,
  -- Reproducibility metadata (rules §15).
  prompt_version    text not null default 'v1',
  model_id          text not null default 'mock',
  tokens_input      integer not null default 0,
  tokens_output     integer not null default 0,
  latency_ms        integer not null default 0,
  -- Optional link to the primary resource this insight is about, so the UI
  -- can deep-link (e.g., project_id for SLA breach).
  resource_type     text,
  resource_id       uuid,
  requested_by      uuid references public.employees(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint ai_insights_headline_not_blank check (length(trim(headline)) > 0),
  constraint ai_insights_summary_not_blank  check (length(trim(summary))  > 0)
);

comment on table public.ai_insights is
  'AI-generated insights, tenant-scoped, PII-redacted before inference (rules §15).';

create index if not exists ai_insights_tenant_kind_idx
  on public.ai_insights (tenant_id, kind, created_at desc);

create index if not exists ai_insights_tenant_severity_idx
  on public.ai_insights (tenant_id, severity, created_at desc);

alter table public.ai_insights enable row level security;

drop policy if exists ai_insights_tenant_read on public.ai_insights;
create policy ai_insights_tenant_read
  on public.ai_insights
  for select
  to authenticated
  using (tenant_id = public.current_tenant_id());

-- Writes only allowed via elevated Server Actions (service_role) which
-- perform PDP + tenant scope checks themselves. We still allow tenant-scoped
-- INSERT so a fallback (e.g. from a Vercel Cron job with a session context)
-- can persist under RLS, provided the caller stamps tenant_id correctly.
drop policy if exists ai_insights_tenant_insert on public.ai_insights;
create policy ai_insights_tenant_insert
  on public.ai_insights
  for insert
  to authenticated
  with check (tenant_id = public.current_tenant_id());

-- Retention (rules §22): AI insights are lower priority than audit logs.
-- We keep 2 years of history; a nightly job can prune older rows. The
-- retention config lives in `src/lib/retention/config.ts`.
comment on column public.ai_insights.created_at is
  'Retention window: 2 years. See src/lib/retention/config.ts.';
