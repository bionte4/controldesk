"use server";

import { revalidatePath } from "next/cache";

import {
  deactivateTenantAi,
  loadTenantAiConfig,
  saveTenantAiConfig,
  verifyAiCredentials,
} from "@/lib/integrations/ai";
import { withSecureAction } from "@/lib/security/action-wrapper";
import {
  deactivateAiConfigSchema,
  saveAiConfigSchema,
} from "@/lib/validation/ai-admin";

/**
 * Server actions for the tenant AI admin surface (rules §17). Mirrors
 * the SMTP / WhatsApp admin modules — verify-before-save discipline,
 * consistent audit contract, password-preserve UX for API keys.
 *
 * DISABLED branch: no verify (nothing to talk to). Row still gets an
 * `is_active=true` row so the resolver sees the "explicit opt-out"
 * signal (see `resolver.ts::tenantToConfig`).
 */

const REVALIDATE_PATH = "/settings/integrations/ai";
const HUB_PATH = "/settings/integrations";

export const saveAiConfigAction = withSecureAction({
  schema: saveAiConfigSchema,
  resource: "ai_config",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "tenant_ai_configs",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const prev = await loadTenantAiConfig(ctx.actor.tenantId);

    // Discriminated payload → per-provider destructure.
    const apiKeyInput =
      input.provider === "DISABLED"
        ? null
        : input.provider === "OPENAI_COMPATIBLE"
          ? (input.api_key && input.api_key.length > 0 ? input.api_key : null)
          : input.api_key;

    const baseUrlInput =
      input.provider === "OPENAI_COMPATIBLE" ? input.base_url : null;

    // Password-preserve UX (matches SMTP): if the admin left the key
    // blank on a cloud provider AND a previous key exists AND the
    // provider didn't change, keep the old key. If the provider
    // changed, always require a fresh key on the new branch (Zod
    // enforces that already for GOOGLE/OPENAI/ANTHROPIC).
    let apiKeyToStore = apiKeyInput;
    if (
      prev &&
      prev.provider === input.provider &&
      prev.apiKey &&
      (apiKeyInput == null || apiKeyInput.length === 0)
    ) {
      apiKeyToStore = prev.apiKey;
    }

    // Verify against the provider (except DISABLED which has nothing
    // to talk to).
    if (input.provider !== "DISABLED") {
      const verify = await verifyAiCredentials({
        provider: input.provider,
        modelId: input.model_id,
        apiKey: apiKeyToStore,
        baseUrl: baseUrlInput,
      });
      if (!verify.ok) {
        throw new Error(`AI provider rejected the credentials: ${verify.error}`);
      }
    }

    await saveTenantAiConfig({
      tenantId: ctx.actor.tenantId,
      provider: input.provider,
      modelId: input.model_id,
      apiKey: apiKeyToStore,
      baseUrl: baseUrlInput,
      dailyTokenCap: input.daily_token_cap ?? null,
      piiRedactionEnabled: input.pii_redaction_enabled,
      insightFreshnessMin: input.insight_freshness_min,
    });

    revalidatePath(REVALIDATE_PATH);
    revalidatePath(HUB_PATH);

    return {
      result: {
        provider: input.provider,
        modelId: input.model_id,
      },
      auditResourceId: ctx.actor.tenantId,
      auditOldValues: prev
        ? {
            provider: prev.provider,
            model_id: prev.modelId,
            base_url: prev.baseUrl,
            insight_freshness_min: prev.insightFreshnessMin,
            is_active: prev.isActive,
            last_error: prev.lastError,
          }
        : null,
      auditNewValues: {
        provider: input.provider,
        model_id: input.model_id,
        base_url: baseUrlInput,
        insight_freshness_min: input.insight_freshness_min,
        is_active: true,
        last_error: null,
      },
    };
  },
});

export const deactivateAiConfigAction = withSecureAction({
  schema: deactivateAiConfigSchema,
  resource: "ai_config",
  action: "delete",
  auditAction: "DELETE",
  auditResourceName: "tenant_ai_configs",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (_input, ctx) => {
    const prev = await loadTenantAiConfig(ctx.actor.tenantId);
    if (!prev) {
      throw new Error("No AI provider registered for this tenant.");
    }

    await deactivateTenantAi(
      ctx.actor.tenantId,
      "Manually deactivated by admin",
    );

    revalidatePath(REVALIDATE_PATH);
    revalidatePath(HUB_PATH);

    return {
      result: { deactivated: true },
      auditResourceId: ctx.actor.tenantId,
      auditOldValues: {
        provider: prev.provider,
        model_id: prev.modelId,
        is_active: prev.isActive,
      },
      auditNewValues: {
        provider: prev.provider,
        model_id: prev.modelId,
        is_active: false,
        last_error: "Manually deactivated by admin",
      },
    };
  },
});
