"use server";

import { revalidatePath } from "next/cache";

import {
  deactivateTenantWhatsApp,
  loadTenantWhatsAppConfig,
  saveTenantWhatsAppConfig,
  verifyWhatsAppCredentials,
} from "@/lib/integrations/whatsapp";
import { withSecureAction } from "@/lib/security/action-wrapper";
import {
  deactivateWhatsAppConfigSchema,
  saveWhatsAppConfigSchema,
} from "@/lib/validation/whatsapp-admin";

/**
 * Server actions for the tenant WhatsApp Business admin surface
 * (rules §17). Mirrors the Telegram bot actions module — same
 * verify-before-save discipline, same audit contract.
 *
 * Provider-specific verification is delegated to
 * `verifyWhatsAppCredentials` which dispatches on
 * `input.provider` internally. If the provider rejects the
 * credentials, we throw and the wrapper surfaces the provider's
 * error message as the toast copy (helps admins spot typos in
 * SID, phone number, or scopes).
 */

const REVALIDATE_PATH = "/settings/integrations/whatsapp-business";
const HUB_PATH = "/settings/integrations";

export const saveWhatsAppConfigAction = withSecureAction({
  schema: saveWhatsAppConfigSchema,
  resource: "whatsapp_config",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "tenant_whatsapp_configs",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    // Schema is FONNTE-only; provider literal narrows to "FONNTE"
    // for the callee's sake. When we bring TWILIO / META_CLOUD
    // back into the UI we'll re-introduce the discriminated union
    // and the corresponding branches here.
    const verify = await verifyWhatsAppCredentials({
      provider: input.provider,
      phoneNumberId: input.phone_number_id,
      apiToken: input.api_token,
      accountSid: null,
    });
    if (!verify.ok) {
      throw new Error(
        `Fonnte rejected the device token: ${verify.error}`,
      );
    }

    const prev = await loadTenantWhatsAppConfig(ctx.actor.tenantId);

    await saveTenantWhatsAppConfig({
      tenantId: ctx.actor.tenantId,
      provider: input.provider,
      phoneNumberId: input.phone_number_id,
      apiToken: input.api_token,
      accountSid: null,
      webhookVerifyToken: null,
    });

    revalidatePath(REVALIDATE_PATH);
    revalidatePath(HUB_PATH);

    return {
      result: {
        provider: input.provider,
        phoneNumberId: input.phone_number_id,
        providerAccountName: verify.providerAccountName,
      },
      auditResourceId: ctx.actor.tenantId,
      auditOldValues: prev
        ? {
            provider: prev.provider,
            phone_number_id: prev.phoneNumberId,
            is_active: prev.isActive,
            last_error: prev.lastError,
          }
        : null,
      auditNewValues: {
        provider: input.provider,
        phone_number_id: input.phone_number_id,
        is_active: true,
        last_error: null,
      },
      auditMetadata: {
        provider_account_name: verify.providerAccountName,
      },
    };
  },
});

export const deactivateWhatsAppConfigAction = withSecureAction({
  schema: deactivateWhatsAppConfigSchema,
  resource: "whatsapp_config",
  action: "delete",
  auditAction: "DELETE",
  auditResourceName: "tenant_whatsapp_configs",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (_input, ctx) => {
    const prev = await loadTenantWhatsAppConfig(ctx.actor.tenantId);
    if (!prev) {
      throw new Error("No WhatsApp sender registered for this tenant.");
    }

    await deactivateTenantWhatsApp(
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
        phone_number_id: prev.phoneNumberId,
        is_active: prev.isActive,
      },
      auditNewValues: {
        provider: prev.provider,
        phone_number_id: prev.phoneNumberId,
        is_active: false,
        last_error: "Manually deactivated by admin",
      },
    };
  },
});
