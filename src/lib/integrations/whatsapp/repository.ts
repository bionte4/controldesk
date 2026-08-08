import "server-only";

import { decryptToken, encryptToken } from "@/lib/security/token-crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Repository for tenant WhatsApp config + per-user phone links.
 *
 * Same pattern as `google_calendar_credentials` and
 * `tenant_telegram_bots`: rows are gated by "no direct access" RLS,
 * so everything here goes through the service-role client which
 * bypasses RLS. Every function still filters by `tenantId` in its
 * WHERE clause — we never rely on the RLS layer alone.
 */

export type WhatsAppProvider = "TWILIO" | "META_CLOUD" | "FONNTE";

export type TenantWhatsAppConfig = {
  tenantId: string;
  provider: WhatsAppProvider;
  /** Business phone identifier. Provider-specific format. */
  phoneNumberId: string;
  /** Decrypted API token. */
  apiToken: string;
  /** Decrypted account SID (Twilio only). */
  accountSid: string | null;
  webhookVerifyToken: string | null;
  isActive: boolean;
  lastError: string | null;
};

export async function loadTenantWhatsAppConfig(
  tenantId: string,
): Promise<TenantWhatsAppConfig | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("tenant_whatsapp_configs")
    .select(
      "tenant_id, provider, phone_number_id, encrypted_api_token, encrypted_account_sid, webhook_verify_token, is_active, last_error",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return {
      tenantId: data.tenant_id,
      provider: data.provider as WhatsAppProvider,
      phoneNumberId: data.phone_number_id,
      apiToken: decryptToken(data.encrypted_api_token),
      accountSid: data.encrypted_account_sid
        ? decryptToken(data.encrypted_account_sid)
        : null,
      webhookVerifyToken: data.webhook_verify_token,
      isActive: data.is_active,
      lastError: data.last_error,
    };
  } catch (err) {
    return {
      tenantId: data.tenant_id,
      provider: data.provider as WhatsAppProvider,
      phoneNumberId: data.phone_number_id,
      apiToken: "",
      accountSid: null,
      webhookVerifyToken: data.webhook_verify_token,
      isActive: false,
      lastError:
        err instanceof Error
          ? `Credentials unreadable: ${err.message}`
          : "Credentials unreadable.",
    };
  }
}

export async function saveTenantWhatsAppConfig(input: {
  tenantId: string;
  provider: WhatsAppProvider;
  phoneNumberId: string;
  apiToken: string;
  accountSid?: string | null;
  webhookVerifyToken?: string | null;
}): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("tenant_whatsapp_configs").upsert(
    {
      tenant_id: input.tenantId,
      provider: input.provider,
      phone_number_id: input.phoneNumberId,
      encrypted_api_token: encryptToken(input.apiToken),
      encrypted_account_sid: input.accountSid
        ? encryptToken(input.accountSid)
        : null,
      webhook_verify_token: input.webhookVerifyToken ?? null,
      is_active: true,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) {
    throw new Error(
      `Failed to save WhatsApp config for tenant ${input.tenantId}: ${error.message}`,
    );
  }
}

export async function deactivateTenantWhatsApp(
  tenantId: string,
  reason?: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase
    .from("tenant_whatsapp_configs")
    .update({
      is_active: false,
      last_error: reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);
}

export type UserWhatsAppLink = {
  tenantId: string;
  userId: string;
  /** Decrypted E.164 phone number (`+62812xxxxxxx`). */
  waId: string;
  displayName: string | null;
  profileName: string | null;
  linkedAt: string;
  optedInAt: string;
  lastInboundAt: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
};

export async function loadUserWhatsAppLink(input: {
  tenantId: string;
  userId: string;
}): Promise<UserWhatsAppLink | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("user_whatsapp_links")
    .select(
      "tenant_id, user_id, encrypted_wa_id, display_name, profile_name, linked_at, opted_in_at, last_inbound_at, last_used_at, last_error",
    )
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return {
      tenantId: data.tenant_id,
      userId: data.user_id,
      waId: decryptToken(data.encrypted_wa_id),
      displayName: data.display_name,
      profileName: data.profile_name,
      linkedAt: data.linked_at,
      optedInAt: data.opted_in_at,
      lastInboundAt: data.last_inbound_at,
      lastUsedAt: data.last_used_at,
      lastError: data.last_error,
    };
  } catch {
    return null;
  }
}

export async function saveUserWhatsAppLink(input: {
  tenantId: string;
  userId: string;
  waId: string;
  displayName?: string | null;
  profileName?: string | null;
}): Promise<void> {
  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("user_whatsapp_links").upsert(
    {
      tenant_id: input.tenantId,
      user_id: input.userId,
      encrypted_wa_id: encryptToken(input.waId),
      display_name: input.displayName ?? null,
      profile_name: input.profileName ?? null,
      linked_at: now,
      opted_in_at: now,
      last_inbound_at: now,
      last_error: null,
    },
    { onConflict: "tenant_id,user_id" },
  );
  if (error) {
    throw new Error(
      `Failed to save WhatsApp link for user ${input.userId}: ${error.message}`,
    );
  }
}

export async function removeUserWhatsAppLink(input: {
  tenantId: string;
  userId: string;
}): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase
    .from("user_whatsapp_links")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId);
}

/**
 * Refresh the `last_inbound_at` timestamp — called from the webhook
 * whenever the user replies. WhatsApp opens a 24-hour free-form
 * messaging window per inbound message; Phase B will consult this
 * timestamp to decide between free-form and template messages.
 */
export async function touchInboundTimestamp(input: {
  tenantId: string;
  userId: string;
}): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase
    .from("user_whatsapp_links")
    .update({ last_inbound_at: new Date().toISOString() })
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId);
}
