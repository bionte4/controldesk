import "server-only";

import { log } from "@/lib/observability/log";

import {
  loadTenantAiConfig,
  type AiProvider,
  type TenantAiConfig,
} from "./repository";

/**
 * Provider resolution for the AI insight runner (rules §15).
 *
 * Resolution order for a given call:
 *   1. If `tenantId` is provided AND `tenant_ai_configs` has an active
 *      row for that tenant → use it (per-tenant provider + model +
 *      key + optional base_url for OPENAI_COMPATIBLE).
 *   2. Otherwise, env-global `AI_PROVIDER` / `AI_MODEL_ID` / provider-
 *      specific env keys. Preserved for backward compatibility.
 *   3. Otherwise, `null` → the runner falls back to its deterministic
 *      mock (see `generators.ts::run<T>()`).
 *
 * The returned handle is a `{ model, source, modelId, piiRedaction,
 * dailyCap }` bundle so downstream code has enough context to log
 * audit fields (`ai_insights.model_id`) and honour per-tenant policy
 * (PII redaction toggle, daily token cap override).
 *
 * Provider SDKs are dynamically imported so the app builds without
 * them installed (edge / CI). Matches the pattern in mailer.ts.
 */

export type ResolvedAiModel = {
  /** Opaque model handle for `generateObject({ model })`. */
  model: unknown;
  /** Where the config came from. Persisted in audit metadata. */
  source: "tenant" | "env";
  /** Fully-qualified model id string ("gemini-2.5-flash"), for audit. */
  modelId: string;
  /** Whether to run PII redaction on the outbound prompt. */
  piiRedaction: boolean;
  /**
   * Optional per-tenant daily token cap override. `null` means "use
   * the env default" (`AI_DAILY_TOKEN_CAP`).
   */
  dailyCap: number | null;
};

type EnvConfig = {
  source: "env";
  provider: Exclude<AiProvider, "OPENAI_COMPATIBLE">;
  modelId: string;
  apiKey: string | null;
  baseUrl: null;
  piiRedaction: true;
  dailyCap: null;
};

type TenantConfig = {
  source: "tenant";
  provider: AiProvider;
  modelId: string;
  apiKey: string | null;
  baseUrl: string | null;
  piiRedaction: boolean;
  dailyCap: number | null;
};

function readEnvConfig(): EnvConfig | null {
  const raw = (process.env.AI_PROVIDER ?? "mock").toLowerCase();
  // Accept the legacy lowercase env values ("openai", "google",
  // "anthropic", "mock") for backward-compat; DISABLED / OPENAI_
  // COMPATIBLE are only accessible via the per-tenant row.
  let provider: EnvConfig["provider"];
  switch (raw) {
    case "openai":
      provider = "OPENAI";
      break;
    case "anthropic":
      provider = "ANTHROPIC";
      break;
    case "google":
      provider = "GOOGLE";
      break;
    default:
      // "mock" (or unknown) — signal to the caller that no real
      // provider is configured.
      return null;
  }

  const modelId =
    process.env.AI_MODEL_ID && process.env.AI_MODEL_ID.trim().length > 0
      ? process.env.AI_MODEL_ID
      : "unknown";

  const apiKey =
    provider === "OPENAI"
      ? process.env.OPENAI_API_KEY ?? null
      : provider === "ANTHROPIC"
        ? process.env.ANTHROPIC_API_KEY ?? null
        : process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? null;

  return {
    source: "env",
    provider,
    modelId,
    apiKey,
    baseUrl: null,
    piiRedaction: true,
    dailyCap: null,
  };
}

function tenantToConfig(row: TenantAiConfig): TenantConfig | null {
  if (!row.isActive) return null;
  if (row.provider === "DISABLED") {
    // Explicit opt-out — return a shape that later triggers `null`
    // model resolution (deterministic fallback).
    return null;
  }
  return {
    source: "tenant",
    provider: row.provider,
    modelId: row.modelId,
    apiKey: row.apiKey,
    baseUrl: row.baseUrl,
    piiRedaction: row.piiRedactionEnabled,
    dailyCap: row.dailyTokenCap,
  };
}

async function resolveConfig(
  tenantId: string | undefined,
): Promise<TenantConfig | EnvConfig | null> {
  if (tenantId) {
    try {
      const row = await loadTenantAiConfig(tenantId);
      if (row) {
        const cfg = tenantToConfig(row);
        if (cfg) return cfg;
        log.info("ai: tenant AI row present but not usable", {
          tenant_id: tenantId,
          provider: row.provider,
          is_active: row.isActive,
          last_error: row.lastError,
        });
        // Row exists but is either DISABLED or inactive. Respect the
        // tenant's explicit signal and do NOT fall through to env —
        // otherwise DISABLED becomes a no-op. Return null → mock.
        return null;
      }
    } catch (err) {
      log.warn("ai: tenant config load failed, falling back to env", {
        tenant_id: tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return readEnvConfig();
}

/**
 * Materialise the model handle from a resolved config. Dynamic
 * import per provider so unused SDKs aren't a bundling requirement.
 */
async function buildModel(
  cfg: TenantConfig | EnvConfig,
): Promise<unknown | null> {
  // All AI SDKs (google/openai/anthropic) are direct dependencies in
  // `package.json`, so we import them with static `await import(...)`
  // module specifiers. That lets Next.js's file tracer copy the SDK
  // + its transitive `@ai-sdk/provider-utils` / `@ai-sdk/provider`
  // deps into `.next/standalone/node_modules/` during
  // `next build`. Any dynamic-Function bypass would hide the imports
  // from the tracer and cause "SDK not installed on the server"
  // failures in the Docker `runner` stage — which is what used to
  // happen before OPENAI + ANTHROPIC were promoted from optional
  // peers to hard deps.
  try {
    if (cfg.provider === "GOOGLE") {
      const mod = (await import("@ai-sdk/google").catch(() => null)) as
        | { google: (id: string) => unknown; createGoogleGenerativeAI?: (o: { apiKey: string }) => (id: string) => unknown }
        | null;
      if (!mod) return null;
      // Per-tenant key uses createGoogleGenerativeAI({apiKey}); env
      // path uses the top-level `google()` which reads the env var
      // itself, so we don't have to pass it explicitly.
      if (cfg.source === "tenant" && cfg.apiKey && mod.createGoogleGenerativeAI) {
        return mod.createGoogleGenerativeAI({ apiKey: cfg.apiKey })(cfg.modelId);
      }
      return mod.google(cfg.modelId);
    }
    if (cfg.provider === "OPENAI") {
      const mod = (await import("@ai-sdk/openai").catch(() => null)) as
        | { openai: (id: string) => unknown; createOpenAI?: (o: { apiKey: string; baseURL?: string }) => (id: string) => unknown }
        | null;
      if (!mod) return null;
      if (cfg.source === "tenant" && cfg.apiKey && mod.createOpenAI) {
        return mod.createOpenAI({ apiKey: cfg.apiKey })(cfg.modelId);
      }
      return mod.openai(cfg.modelId);
    }
    if (cfg.provider === "ANTHROPIC") {
      const mod = (await import("@ai-sdk/anthropic").catch(() => null)) as
        | { anthropic: (id: string) => unknown; createAnthropic?: (o: { apiKey: string }) => (id: string) => unknown }
        | null;
      if (!mod) return null;
      if (cfg.source === "tenant" && cfg.apiKey && mod.createAnthropic) {
        return mod.createAnthropic({ apiKey: cfg.apiKey })(cfg.modelId);
      }
      return mod.anthropic(cfg.modelId);
    }
    if (cfg.provider === "OPENAI_COMPATIBLE") {
      // Ollama, LM Studio, vLLM, Groq, Together AI, Cerebras, and
      // anything else that speaks the OpenAI Chat Completions API.
      // We reuse `@ai-sdk/openai::createOpenAI` which supports a
      // custom `baseURL`. `apiKey` is optional — Ollama and LM Studio
      // typically run without auth on a private network.
      if (!cfg.baseUrl) return null;
      const mod = (await import("@ai-sdk/openai").catch(() => null)) as
        | { createOpenAI?: (o: { apiKey: string; baseURL: string }) => (id: string) => unknown }
        | null;
      if (!mod?.createOpenAI) return null;
      return mod.createOpenAI({
        // Provide a placeholder key when the endpoint has no auth —
        // most OpenAI-compatible servers accept anything or ignore it.
        apiKey: cfg.apiKey ?? "not-needed",
        baseURL: cfg.baseUrl,
      })(cfg.modelId);
    }
  } catch (err) {
    log.warn("ai: provider SDK failed to load", {
      provider: cfg.provider,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

export async function resolveAiModel(
  tenantId: string | undefined,
): Promise<ResolvedAiModel | null> {
  const cfg = await resolveConfig(tenantId);
  if (!cfg) return null;
  const model = await buildModel(cfg);
  if (!model) return null;
  return {
    model,
    source: cfg.source,
    modelId: cfg.modelId,
    piiRedaction: cfg.source === "tenant" ? cfg.piiRedaction : true,
    dailyCap: cfg.source === "tenant" ? cfg.dailyCap : null,
  };
}

/**
 * Read an env-driven **fallback** provider config. Meant as a
 * platform-wide safety net for the help chatbot: when the primary
 * provider (per-tenant row OR env-global `AI_*`) fails at the SDK
 * construction step — missing key, invalid model, connection refused
 * — the chat route can try one more provider before giving up.
 *
 * Read env vars:
 *   • `AI_FALLBACK_PROVIDER`  — one of `openai|anthropic|google|ollama`.
 *     `ollama` maps to `OPENAI_COMPATIBLE` under the hood, and pairs
 *     with `AI_FALLBACK_BASE_URL` (default `http://localhost:11434/v1`).
 *   • `AI_FALLBACK_MODEL_ID`  — e.g. `gpt-4o-mini`, `llama3.1`.
 *   • `AI_FALLBACK_API_KEY`   — optional (Ollama and other on-prem
 *     endpoints run without auth).
 *   • `AI_FALLBACK_BASE_URL`  — only used when provider is Ollama /
 *     OpenAI-compatible. Ignored for cloud providers whose base URL
 *     is fixed.
 *
 * Returns `null` when no fallback env is set — the caller then does
 * nothing (no fallback provider chain, current behaviour). The
 * fallback exists **in addition to** the RAG-only fallback (which
 * runs client-side when the LLM path returns empty). Provider chain
 * catches SYNC failures ("no primary key"); RAG fallback catches
 * ASYNC failures ("provider streamed 0 tokens").
 *
 * We deliberately never read the tenant `tenant_ai_configs` row for
 * the fallback — the design intent is a *platform admin* configured
 * safety net that no tenant can accidentally break. Making the
 * fallback per-tenant is a Phase 2 (would need migration + UI).
 */
function readEnvFallbackConfig(): EnvConfig | TenantConfig | null {
  const raw = (process.env.AI_FALLBACK_PROVIDER ?? "").trim().toLowerCase();
  if (raw.length === 0) return null;

  const modelId = process.env.AI_FALLBACK_MODEL_ID?.trim();
  if (!modelId) {
    log.warn("ai: AI_FALLBACK_PROVIDER set without AI_FALLBACK_MODEL_ID", {
      provider: raw,
    });
    return null;
  }

  const apiKey = process.env.AI_FALLBACK_API_KEY?.trim() ?? null;
  const baseUrl = process.env.AI_FALLBACK_BASE_URL?.trim();

  // `ollama` is a friendlier alias for `openai_compatible` pointed at
  // the default Ollama endpoint. Anyone already running Ollama can
  // enable it with a single env var: `AI_FALLBACK_PROVIDER=ollama`.
  if (raw === "ollama" || raw === "openai_compatible") {
    // We use the `TenantConfig` shape (not `EnvConfig`) so `buildModel`
    // takes the `createOpenAI({ apiKey, baseURL })` branch for the
    // OPENAI_COMPATIBLE case — that's the only path that honours the
    // custom endpoint. `source: "tenant"` is a bit of a lie
    // (semantically this IS an env fallback), but downstream code
    // only reads `source` for audit logging and the caller
    // (`resolveAiFallbackModel`) overrides `source` to `"env"` on
    // the returned `ResolvedAiModel`, so the audit trail stays honest.
    return {
      source: "tenant",
      provider: "OPENAI_COMPATIBLE",
      modelId,
      apiKey,
      baseUrl:
        baseUrl && baseUrl.length > 0
          ? baseUrl
          : "http://localhost:11434/v1",
      piiRedaction: true,
      dailyCap: null,
    } satisfies TenantConfig;
  }

  let provider: EnvConfig["provider"];
  switch (raw) {
    case "openai":
      provider = "OPENAI";
      break;
    case "anthropic":
      provider = "ANTHROPIC";
      break;
    case "google":
      provider = "GOOGLE";
      break;
    default:
      log.warn("ai: unknown AI_FALLBACK_PROVIDER value", { provider: raw });
      return null;
  }

  return {
    source: "env",
    provider,
    modelId,
    apiKey,
    baseUrl: null,
    piiRedaction: true,
    dailyCap: null,
  };
}

/**
 * Materialise the platform-wide fallback model handle, if configured.
 * Returns `null` when no `AI_FALLBACK_*` env is set OR the SDK for
 * the configured provider isn't loadable at runtime.
 *
 * Callers should try their primary via `resolveAiModel(...)` first
 * and only reach for this on a synchronous construction failure —
 * e.g. streamText immediately threw, or the model object returned
 * `null`. Mid-stream provider errors (rate limit body arriving after
 * 200 OK headers) are caught by the client-side empty-stream guard,
 * not this path.
 */
export async function resolveAiFallbackModel(): Promise<ResolvedAiModel | null> {
  const cfg = readEnvFallbackConfig();
  if (!cfg) return null;
  const model = await buildModel(cfg);
  if (!model) return null;
  return {
    model,
    source: "env",
    modelId: cfg.modelId,
    piiRedaction: cfg.source === "tenant" ? cfg.piiRedaction : true,
    dailyCap: null,
  };
}

/**
 * Fast helper for callers that only need the tenant's daily token cap
 * override (not the model itself). Used at the top of the insight
 * action so `reserve()` can enforce the per-tenant quota BEFORE we
 * pay to spin up the full provider client.
 *
 * Returns `null` when no override is set — caller falls back to
 * `DEFAULT_DAILY_TOKEN_CAP` from `cost-cap.ts`.
 */
export async function resolveDailyTokenCap(
  tenantId: string | undefined,
): Promise<number | null> {
  if (!tenantId) return null;
  try {
    const row = await loadTenantAiConfig(tenantId);
    if (!row || !row.isActive) return null;
    return row.dailyTokenCap;
  } catch {
    return null;
  }
}

/**
 * Extended cap-resolution helper that ALSO decides whether the daily
 * token cap should be enforced for this tenant.
 *
 * Rationale: the cap exists as a cost-control safety net for cloud
 * providers where every output token costs real money (Gemini, GPT-4o,
 * Claude, …). For an `OPENAI_COMPATIBLE` provider — i.e. an on-prem
 * LLM like Ollama, LM Studio, or vLLM served from a private LAN — the
 * marginal cost of a request is $0. Enforcing the same 10k daily cap
 * on those tenants creates artificial friction (users hitting cap on a
 * free local model, having to raise the number manually, or reset the
 * Redis counter). We bypass the cap for on-prem providers instead.
 *
 * Cloud providers still use the cap (or the tenant's override) as
 * before — no change in behaviour for GOOGLE / OPENAI / ANTHROPIC.
 *
 * `DISABLED` and "no config" tenants keep the cap because they fall
 * back to the env-level provider (see `envConfig()` above), which is
 * almost always a cloud provider in practice.
 *
 * Returns `{ cap: null, bypass: false }` when tenantId is missing —
 * caller decides what to do (typically fall back to
 * `DEFAULT_DAILY_TOKEN_CAP`).
 */
export async function resolveAiCapContext(
  tenantId: string | undefined,
): Promise<{ cap: number | null; bypass: boolean }> {
  if (!tenantId) return { cap: null, bypass: false };
  try {
    const row = await loadTenantAiConfig(tenantId);
    if (!row || !row.isActive) return { cap: null, bypass: false };
    return {
      cap: row.dailyTokenCap,
      bypass: row.provider === "OPENAI_COMPATIBLE",
    };
  } catch {
    return { cap: null, bypass: false };
  }
}
