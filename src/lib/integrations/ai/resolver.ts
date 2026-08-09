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
  const dyn = new Function(
    "spec",
    "return import(spec);",
  ) as (spec: string) => Promise<unknown>;

  try {
    if (cfg.provider === "GOOGLE") {
      const mod = (await dyn("@ai-sdk/google").catch(() => null)) as
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
      const mod = (await dyn("@ai-sdk/openai").catch(() => null)) as
        | { openai: (id: string) => unknown; createOpenAI?: (o: { apiKey: string; baseURL?: string }) => (id: string) => unknown }
        | null;
      if (!mod) return null;
      if (cfg.source === "tenant" && cfg.apiKey && mod.createOpenAI) {
        return mod.createOpenAI({ apiKey: cfg.apiKey })(cfg.modelId);
      }
      return mod.openai(cfg.modelId);
    }
    if (cfg.provider === "ANTHROPIC") {
      const mod = (await dyn("@ai-sdk/anthropic").catch(() => null)) as
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
      const mod = (await dyn("@ai-sdk/openai").catch(() => null)) as
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
