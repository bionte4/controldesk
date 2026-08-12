import "server-only";

import { decryptToken, encryptToken } from "@/lib/security/token-crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Repository for per-tenant AI provider config (`tenant_ai_configs`).
 *
 * Same pattern as `tenant_smtp_configs` and `tenant_whatsapp_configs`:
 * rows gated by "no direct access" RLS, so everything here goes
 * through the service-role client. Every function still filters by
 * `tenantId` in the WHERE clause — we never rely on RLS alone.
 *
 * `encrypted_api_key` is AES-256-GCM encrypted at rest via
 * `token-crypto.ts`. `base_url` stays cleartext (endpoint address,
 * not a secret) — the `OPENAI_COMPATIBLE` branch reads it directly
 * when building the SDK client.
 */

export type AiProvider =
  | "GOOGLE"
  | "OPENAI"
  | "ANTHROPIC"
  | "OPENAI_COMPATIBLE"
  | "DISABLED";

export type TenantAiConfig = {
  tenantId: string;
  provider: AiProvider;
  modelId: string;
  /** Decrypted API key. `null` for OPENAI_COMPATIBLE without auth. */
  apiKey: string | null;
  /** Endpoint URL for OPENAI_COMPATIBLE. `null` for other providers. */
  baseUrl: string | null;
  /** Override daily token cap. `null` → env default. */
  dailyTokenCap: number | null;
  /** When false, resolver skips PII redaction (on-prem models only). */
  piiRedactionEnabled: boolean;
  isActive: boolean;
  lastError: string | null;
};

/**
 * Load the tenant's AI config. Returns `null` when no row exists
 * (resolver falls back to env-global AI_* in that case).
 *
 * If a row exists but the encrypted API key fails to decrypt (e.g.
 * `APP_ENCRYPTION_KEY` rotated without re-encrypt), returns the row
 * with `isActive=false` + `lastError` marker. Mirrors the graceful
 * degradation pattern from `loadTenantSmtpConfig` /
 * `loadTenantWhatsAppConfig`.
 */
export async function loadTenantAiConfig(
  tenantId: string,
): Promise<TenantAiConfig | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("tenant_ai_configs")
    .select(
      "tenant_id, provider, model_id, encrypted_api_key, base_url, daily_token_cap, pii_redaction_enabled, is_active, last_error",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return {
      tenantId: data.tenant_id,
      provider: data.provider as AiProvider,
      modelId: data.model_id,
      apiKey: data.encrypted_api_key
        ? decryptToken(data.encrypted_api_key)
        : null,
      baseUrl: data.base_url,
      dailyTokenCap: data.daily_token_cap,
      piiRedactionEnabled: data.pii_redaction_enabled,
      isActive: data.is_active,
      lastError: data.last_error,
    };
  } catch (err) {
    return {
      tenantId: data.tenant_id,
      provider: data.provider as AiProvider,
      modelId: data.model_id,
      apiKey: null,
      baseUrl: data.base_url,
      dailyTokenCap: data.daily_token_cap,
      piiRedactionEnabled: data.pii_redaction_enabled,
      isActive: false,
      lastError:
        err instanceof Error
          ? `Credentials unreadable: ${err.message}`
          : "Credentials unreadable.",
    };
  }
}

export async function saveTenantAiConfig(input: {
  tenantId: string;
  provider: AiProvider;
  modelId: string;
  apiKey: string | null;
  baseUrl: string | null;
  dailyTokenCap: number | null;
  piiRedactionEnabled: boolean;
}): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("tenant_ai_configs").upsert(
    {
      tenant_id: input.tenantId,
      provider: input.provider,
      model_id: input.modelId,
      encrypted_api_key: input.apiKey ? encryptToken(input.apiKey) : null,
      base_url: input.baseUrl,
      daily_token_cap: input.dailyTokenCap,
      pii_redaction_enabled: input.piiRedactionEnabled,
      is_active: true,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) {
    throw new Error(
      `Failed to save AI config for tenant ${input.tenantId}: ${error.message}`,
    );
  }
}

export async function deactivateTenantAi(
  tenantId: string,
  reason?: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase
    .from("tenant_ai_configs")
    .update({
      is_active: false,
      last_error: reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);
}
