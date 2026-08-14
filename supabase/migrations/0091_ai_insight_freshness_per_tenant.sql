-- Migration: 0091_ai_insight_freshness_per_tenant.sql
-- Purpose : Move the "an insight is fresh for N minutes" window from a
--           hardcoded constant in `src/app/api/cron/ai-insights-sweep/
--           route.ts` (FRESHNESS_WINDOW_MIN = 15) into a per-tenant
--           setting on `tenant_ai_configs`. Different tenants care
--           about different freshness — a Finance-heavy tenant may
--           want 5 min (near real-time), while a light user may prefer
--           60 min to save tokens.
--
-- Contract:
--   * New column: `insight_freshness_min integer NOT NULL DEFAULT 15`.
--   * Range: 5 min (min useful — must be > cron poll interval which is
--     15 min; if set to 5 the very next sweep will regenerate) to 1440
--     min (24 h — anything longer effectively disables auto-refresh
--     and we'd rather users flip the provider to DISABLED).
--   * All existing rows backfilled to the previous hardcoded value (15)
--     so behaviour is unchanged for tenants that don't touch the UI.
--
-- Read-side:
--   The sweep route (rules §17 data access layer) reads this column via
--   `loadTenantAiConfig()` and falls back to 15 when no row exists.
--
-- Rollback:
--   ALTER TABLE public.tenant_ai_configs
--     DROP CONSTRAINT IF EXISTS tenant_ai_configs_freshness_range_ck,
--     DROP COLUMN IF EXISTS insight_freshness_min;

begin;

alter table public.tenant_ai_configs
  add column if not exists insight_freshness_min integer not null default 15;

-- Range guard. Kept as a named constraint so the app-level Zod schema
-- (`saveAiConfigSchema.insight_freshness_min`) and the DB agree on
-- allowed values — the app rejects 4/1441 first, but a service-role
-- caller can't sneak an out-of-range value past the DB either.
alter table public.tenant_ai_configs
  add constraint tenant_ai_configs_freshness_range_ck
  check (insight_freshness_min between 5 and 1440);

comment on column public.tenant_ai_configs.insight_freshness_min is
  'How stale (in minutes) an AI insight can be before the sweep regenerates it. '
  'Range 5-1440. Default 15 (matches the legacy hardcoded FRESHNESS_WINDOW_MIN). '
  'Lower values = fresher data at higher token cost; higher values = cheaper.';

commit;
