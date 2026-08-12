-- Migration 0074: Per-tenant AI provider config.
--
-- Enables each tenant to plug in their own LLM provider (Google
-- Gemini, OpenAI, Anthropic, or any OpenAI-compatible endpoint —
-- Ollama, LM Studio, vLLM, Groq, Together AI, etc.) with their own
-- API key + model choice + daily-token cap. Currently
-- `src/lib/ai/generators.ts::resolveModel()` reads `AI_PROVIDER` /
-- `AI_MODEL_ID` / provider-specific env keys — one provider for the
-- whole deployment. That means every tenant either pays for the
-- same Google Gemini bill or runs on the mock fallback; there's no
-- way for a security-sensitive tenant to point at their own
-- on-premise Llama 3.1 instance running under Ollama.
--
-- This migration adds `tenant_ai_configs` (one row per tenant). When
-- a row is present and `is_active = true`, the resolver uses it;
-- otherwise it falls back to the env-global config so the refactor
-- is backward-compatible for the existing deployment.
--
-- Local-LLM support is done via the `OPENAI_COMPATIBLE` provider
-- value, which tells the resolver to call `createOpenAI({ baseURL,
-- apiKey })` from `@ai-sdk/openai`. Any endpoint that speaks the
-- OpenAI Chat Completions API (Ollama's `/v1`, LM Studio, vLLM,
-- Groq, Together AI, Cerebras) works with that adapter, so tenants
-- can point at a private VPC or on-prem GPU without new adapter
-- code every time.
--
-- Security posture:
--   * `encrypted_api_key` stored AES-256-GCM app-side via
--     `src/lib/security/token-crypto.ts` (rules §3). Never touches
--     the DB as cleartext.
--   * `base_url` cleartext — it's the endpoint address, not a
--     secret. Rare when set (only for OPENAI_COMPATIBLE providers).
--   * RLS `no_direct` (deny-all to `authenticated`) + `service`
--     (allow to `service_role`) — mirrors `tenant_smtp_configs`
--     (0073) and `tenant_whatsapp_configs` (0070).
--
-- Rollback:
--   drop policy if exists tenant_ai_configs_service on public.tenant_ai_configs;
--   drop policy if exists tenant_ai_configs_no_direct on public.tenant_ai_configs;
--   drop table if exists public.tenant_ai_configs;

begin;

create table public.tenant_ai_configs (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,

  -- Provider selector.
  --   * GOOGLE            — Vercel AI SDK `@ai-sdk/google` (Gemini family).
  --   * OPENAI            — `@ai-sdk/openai` with official endpoints.
  --   * ANTHROPIC         — `@ai-sdk/anthropic` (Claude family).
  --   * OPENAI_COMPATIBLE — Any endpoint that speaks OpenAI Chat
  --                         Completions API: Ollama, LM Studio, vLLM,
  --                         Groq, Together AI, Cerebras, etc.
  --                         Requires `base_url`.
  --   * DISABLED          — Explicit opt-out. Insights fall back to
  --                         the deterministic mock. Useful for
  --                         tenants without an AI budget who don't
  --                         want to inherit the env default.
  provider text not null,

  -- Model identifier. Provider-specific.
  --   * GOOGLE      — `gemini-2.5-flash`, `gemini-2.5-pro`, ...
  --   * OPENAI      — `gpt-4o`, `gpt-4o-mini`, `o1-mini`, ...
  --   * ANTHROPIC   — `claude-sonnet-5-*`, `claude-opus-5-*`, ...
  --   * OPENAI_COMPATIBLE — the model name on the target endpoint,
  --                         e.g. `llama3.1:70b`, `qwen2.5:32b`,
  --                         `mixtral:8x7b` for Ollama.
  --   * DISABLED    — ignored (nullable would work but simpler to
  --                   require a placeholder like `disabled`).
  model_id text not null,

  -- Encrypted API key. Optional because:
  --   * `OPENAI_COMPATIBLE` on a private LAN Ollama instance often
  --     runs without auth.
  --   * `DISABLED` never needs one.
  encrypted_api_key text null,

  -- Base URL for `OPENAI_COMPATIBLE`. Required when provider is
  -- OPENAI_COMPATIBLE; ignored (should be null) for others. The
  -- application layer enforces this constraint via Zod, not the DB —
  -- so admins can flip provider without a two-step migration.
  base_url text null,

  -- Optional daily output-token cap override per tenant. When null,
  -- the mailer falls back to `AI_DAILY_TOKEN_CAP` env (default
  -- 10 000 tokens/day). See `src/lib/ai/cost-cap.ts`.
  daily_token_cap integer null,

  -- When true, PII redaction stays enabled (default). When explicitly
  -- false, the resolver forwards raw prompts to the model. Only makes
  -- sense for tenants running a fully-owned on-prem model where the
  -- data never leaves their network — the flag reads as informed
  -- consent, and the AI runner logs it into `ai_insights.payload`
  -- metadata for audit.
  pii_redaction_enabled boolean not null default true,

  is_active boolean not null default true,
  last_error text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint tenant_ai_configs_provider_ck
    check (provider in ('GOOGLE', 'OPENAI', 'ANTHROPIC', 'OPENAI_COMPATIBLE', 'DISABLED')),

  constraint tenant_ai_configs_daily_cap_ck
    check (daily_token_cap is null or daily_token_cap > 0),

  -- OPENAI_COMPATIBLE MUST carry a base_url. Others must not.
  constraint tenant_ai_configs_base_url_ck check (
    (provider = 'OPENAI_COMPATIBLE' and base_url is not null and length(base_url) > 0)
    or (provider <> 'OPENAI_COMPATIBLE' and base_url is null)
  )
);

comment on table public.tenant_ai_configs is
  'Per-tenant AI provider config. API key AES-256-GCM encrypted app-side (see token-crypto.ts). OPENAI_COMPATIBLE covers Ollama / LM Studio / vLLM / Groq / Together AI. Fallback to env-global AI_* vars when no row is present.';

create index tenant_ai_configs_active_idx
  on public.tenant_ai_configs (is_active) where is_active = true;

alter table public.tenant_ai_configs enable row level security;

create policy tenant_ai_configs_no_direct
  on public.tenant_ai_configs
  as permissive
  for all
  to authenticated
  using (false)
  with check (false);

create policy tenant_ai_configs_service
  on public.tenant_ai_configs
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

commit;
