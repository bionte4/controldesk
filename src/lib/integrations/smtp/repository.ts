import "server-only";

import { decryptToken, encryptToken } from "@/lib/security/token-crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Repository for per-tenant SMTP config (`tenant_smtp_configs`).
 *
 * Same pattern as `tenant_whatsapp_configs` and `tenant_telegram_bots`:
 * rows are gated by "no direct access" RLS, so everything here goes
 * through the service-role client which bypasses RLS. Every function
 * still filters by `tenantId` in the WHERE clause — we never rely on
 * the RLS layer alone.
 *
 * Credentials (username + password) are AES-256-GCM encrypted at
 * rest via `token-crypto.ts`. Host + port + sender identity stay
 * cleartext because they are not secrets and the `email_outbox`
 * audit trail routinely inspects them.
 */

export type SmtpProvider =
  | "SMTP"
  | "RESEND"
  | "POSTMARK"
  | "SES"
  | "SENDGRID";

export type TenantSmtpConfig = {
  tenantId: string;
  provider: SmtpProvider;
  host: string;
  port: number;
  /** Nullable → mailer auto-detects: 465 → true, else STARTTLS. */
  secure: boolean | null;
  /** Decrypted SMTP username. */
  username: string | null;
  /** Decrypted SMTP password / API token. */
  password: string | null;
  fromAddress: string;
  fromName: string | null;
  replyTo: string | null;
  webhookSecret: string | null;
  isActive: boolean;
  lastError: string | null;
};

/**
 * Load the tenant's SMTP config. Returns `null` when no row exists
 * (mailer falls back to env-global SMTP_* in that case).
 *
 * If a row exists but the encrypted credentials fail to decrypt (e.g.
 * `APP_ENCRYPTION_KEY` rotated without re-encrypt), the record is
 * returned with `isActive=false` and a `lastError` marker — this
 * mirrors `loadTenantWhatsAppConfig` and keeps the send path from
 * throwing on a bad crypto key.
 */
export async function loadTenantSmtpConfig(
  tenantId: string,
): Promise<TenantSmtpConfig | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("tenant_smtp_configs")
    .select(
      "tenant_id, provider, host, port, secure, encrypted_username, encrypted_password, from_address, from_name, reply_to, webhook_secret, is_active, last_error",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return {
      tenantId: data.tenant_id,
      provider: data.provider as SmtpProvider,
      host: data.host,
      port: data.port,
      secure: data.secure,
      username: data.encrypted_username
        ? decryptToken(data.encrypted_username)
        : null,
      password: data.encrypted_password
        ? decryptToken(data.encrypted_password)
        : null,
      fromAddress: data.from_address,
      fromName: data.from_name,
      replyTo: data.reply_to,
      webhookSecret: data.webhook_secret,
      isActive: data.is_active,
      lastError: data.last_error,
    };
  } catch (err) {
    return {
      tenantId: data.tenant_id,
      provider: data.provider as SmtpProvider,
      host: data.host,
      port: data.port,
      secure: data.secure,
      username: null,
      password: null,
      fromAddress: data.from_address,
      fromName: data.from_name,
      replyTo: data.reply_to,
      webhookSecret: data.webhook_secret,
      isActive: false,
      lastError:
        err instanceof Error
          ? `Credentials unreadable: ${err.message}`
          : "Credentials unreadable.",
    };
  }
}

/**
 * Upsert the tenant's SMTP config. Encrypts username + password
 * before persist. Always resets `is_active=true` and clears
 * `last_error` — a fresh save is implicitly "the operator says this
 * works now", so downstream error surfaces get a clean slate.
 */
export async function saveTenantSmtpConfig(input: {
  tenantId: string;
  provider: SmtpProvider;
  host: string;
  port: number;
  secure: boolean | null;
  username: string | null;
  password: string | null;
  fromAddress: string;
  fromName: string | null;
  replyTo: string | null;
}): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("tenant_smtp_configs").upsert(
    {
      tenant_id: input.tenantId,
      provider: input.provider,
      host: input.host,
      port: input.port,
      secure: input.secure,
      encrypted_username: input.username
        ? encryptToken(input.username)
        : null,
      encrypted_password: input.password
        ? encryptToken(input.password)
        : null,
      from_address: input.fromAddress,
      from_name: input.fromName,
      reply_to: input.replyTo,
      is_active: true,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) {
    throw new Error(
      `Failed to save SMTP config for tenant ${input.tenantId}: ${error.message}`,
    );
  }
}

export async function deactivateTenantSmtp(
  tenantId: string,
  reason?: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase
    .from("tenant_smtp_configs")
    .update({
      is_active: false,
      last_error: reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);
}

/**
 * Mark the tenant's SMTP config as broken (side-effect on send
 * failure). Kept separate from `deactivateTenantSmtp` so we can log
 * transient errors without flipping `is_active` — Phase A does the
 * conservative thing and only records the message; the admin sees
 * it on the integrations hub.
 */
export async function recordSmtpError(
  tenantId: string,
  error: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase
    .from("tenant_smtp_configs")
    .update({
      last_error: error,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);
}
