import { z } from "zod";

/**
 * Zod schemas for the tenant AI admin surface (rules §17).
 *
 * The schema is a discriminated union keyed on `provider`:
 *   * GOOGLE / OPENAI / ANTHROPIC — require `api_key`, no `base_url`.
 *   * OPENAI_COMPATIBLE — requires `base_url` (Ollama/LM Studio/vLLM
 *                        endpoint), `api_key` optional (Ollama on a
 *                        private LAN typically runs without auth).
 *   * DISABLED — opt-out, no keys needed.
 *
 * `model_id` is provider-specific and free-text — the exact catalog
 * changes constantly (Gemini flash-latest, gpt-4o-mini, claude-sonnet-5,
 * llama3.1:70b, qwen2.5:32b, etc.) — so we validate shape (non-empty,
 * length cap) but not membership. The verify-before-save call will
 * catch a typo by rejecting at the provider API.
 */

const modelId = z
  .string()
  .trim()
  .min(1, "Model id is required.")
  .max(120, "Model id is too long.");

const apiKey = z
  .string()
  .trim()
  .max(1024, "API key is too long.");

const baseUrl = z
  .string()
  .trim()
  .max(500, "Base URL is too long.")
  .refine((v) => /^https?:\/\//i.test(v), {
    message:
      "Base URL must start with http:// or https:// (e.g. http://localhost:11434/v1 for Ollama).",
  });

const dailyTokenCap = z
  .number({ error: "Daily cap must be a number." })
  .int("Daily cap must be an integer.")
  .positive("Daily cap must be greater than zero.")
  .max(10_000_000, "Daily cap is unreasonably large.")
  .nullable()
  .optional();

// Legacy `FRESHNESS_WINDOW_MIN` (15) is now per-tenant. The lower bound
// is deliberately 5 min — anything smaller wastes tokens because the
// sidecar cron polls every 15 min anyway (so a 1-min freshness just
// forces regeneration on every sweep). Upper bound 1440 (24 h) — beyond
// that, tenants should just set provider=DISABLED.
const insightFreshnessMin = z
  .number({ error: "Freshness window must be a number." })
  .int("Freshness window must be an integer.")
  .min(5, "Minimum 5 minutes.")
  .max(1440, "Maximum 1440 minutes (24 hours).")
  .default(15);

const cloudProviderBase = z.object({
  model_id: modelId,
  // Cloud providers require a key — empty string is rejected.
  api_key: apiKey.min(1, "API key is required for this provider."),
  base_url: z.null().optional(),
  daily_token_cap: dailyTokenCap,
  pii_redaction_enabled: z.boolean().default(true),
  insight_freshness_min: insightFreshnessMin,
});

export const saveAiConfigSchema = z.discriminatedUnion("provider", [
  cloudProviderBase.extend({ provider: z.literal("GOOGLE") }),
  cloudProviderBase.extend({ provider: z.literal("OPENAI") }),
  cloudProviderBase.extend({ provider: z.literal("ANTHROPIC") }),
  z.object({
    provider: z.literal("OPENAI_COMPATIBLE"),
    model_id: modelId,
    // Auth is optional for on-prem endpoints. Empty string is
    // preserved as null (no auth).
    api_key: apiKey.nullable().optional(),
    base_url: baseUrl,
    daily_token_cap: dailyTokenCap,
    // On-prem models are the ONLY path where PII redaction may be
    // safely disabled — the data never leaves the tenant network.
    pii_redaction_enabled: z.boolean().default(true),
    insight_freshness_min: insightFreshnessMin,
  }),
  z.object({
    provider: z.literal("DISABLED"),
    // Placeholder model_id — the DB requires the column non-null; the
    // UI hides the field for this branch and injects "disabled".
    model_id: z.literal("disabled").default("disabled"),
    api_key: z.null().optional(),
    base_url: z.null().optional(),
    daily_token_cap: dailyTokenCap,
    pii_redaction_enabled: z.boolean().default(true),
    // Kept on the DISABLED branch too so switching provider back to
    // GOOGLE/OPENAI/etc doesn't reset the user's chosen freshness.
    insight_freshness_min: insightFreshnessMin,
  }),
]);
export type SaveAiConfigInput = z.infer<typeof saveAiConfigSchema>;

export const deactivateAiConfigSchema = z.object({});
export type DeactivateAiConfigInput = z.infer<typeof deactivateAiConfigSchema>;
