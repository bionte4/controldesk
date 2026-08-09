"use server";

import { revalidatePath } from "next/cache";

import {
  deactivateTenantSmtp,
  loadTenantSmtpConfig,
  saveTenantSmtpConfig,
  verifySmtpCredentials,
} from "@/lib/integrations/smtp";
import { withSecureAction } from "@/lib/security/action-wrapper";
import {
  deactivateSmtpConfigSchema,
  saveSmtpConfigSchema,
} from "@/lib/validation/smtp-admin";

/**
 * Server actions for the tenant SMTP admin surface (rules §17).
 * Mirrors the WhatsApp / Telegram admin modules — same verify-before-
 * save discipline, same audit contract.
 *
 * Behavior:
 *   * Verify SMTP creds via `verifySmtpCredentials()` (nodemailer's
 *     `verify()` handshake). Failure surfaces via the wrapper toast
 *     so the admin sees the relay's actual error string.
 *   * On save, always resets `is_active=true` and clears `last_error`
 *     — a fresh save is implicitly "operator says this works now".
 *   * On deactivate, sets `is_active=false` with a stamped reason.
 *
 * Password rotation UX:
 *   * If the admin submits an empty `password`, we preserve the
 *     existing encrypted value (retype-guard). Same convention as
 *     the Telegram / WhatsApp forms so admins can update host/from
 *     without re-pasting the secret every time.
 */

const REVALIDATE_PATH = "/settings/integrations/smtp";
const HUB_PATH = "/settings/integrations";

export const saveSmtpConfigAction = withSecureAction({
  schema: saveSmtpConfigSchema,
  resource: "smtp_config",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "tenant_smtp_configs",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const prev = await loadTenantSmtpConfig(ctx.actor.tenantId);

    // Preserve the existing password when the admin leaves the field
    // blank — otherwise a "just update the From address" flow wipes
    // creds. Password rotation is done by pasting a non-empty value.
    const usernameToStore =
      input.username && input.username.length > 0
        ? input.username
        : prev?.username ?? null;
    const passwordToStore =
      input.password && input.password.length > 0
        ? input.password
        : prev?.password ?? null;

    // Verify against the relay BEFORE persisting so the admin can't
    // save a broken config and only discover it hours later when the
    // digest cron logs a swarm of `email_outbox` failures.
    const verify = await verifySmtpCredentials({
      host: input.host,
      port: input.port,
      secure: input.secure ?? null,
      username: usernameToStore,
      password: passwordToStore,
    });
    if (!verify.ok) {
      throw new Error(`SMTP relay rejected the credentials: ${verify.error}`);
    }

    await saveTenantSmtpConfig({
      tenantId: ctx.actor.tenantId,
      provider: input.provider,
      host: input.host,
      port: input.port,
      secure: input.secure ?? null,
      username: usernameToStore,
      password: passwordToStore,
      fromAddress: input.from_address,
      fromName: input.from_name ?? null,
      replyTo: input.reply_to ?? null,
    });

    revalidatePath(REVALIDATE_PATH);
    revalidatePath(HUB_PATH);

    return {
      result: {
        host: input.host,
        port: input.port,
        fromAddress: input.from_address,
      },
      auditResourceId: ctx.actor.tenantId,
      auditOldValues: prev
        ? {
            provider: prev.provider,
            host: prev.host,
            port: prev.port,
            from_address: prev.fromAddress,
            is_active: prev.isActive,
            last_error: prev.lastError,
          }
        : null,
      auditNewValues: {
        provider: input.provider,
        host: input.host,
        port: input.port,
        from_address: input.from_address,
        is_active: true,
        last_error: null,
      },
    };
  },
});

export const deactivateSmtpConfigAction = withSecureAction({
  schema: deactivateSmtpConfigSchema,
  resource: "smtp_config",
  action: "delete",
  auditAction: "DELETE",
  auditResourceName: "tenant_smtp_configs",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (_input, ctx) => {
    const prev = await loadTenantSmtpConfig(ctx.actor.tenantId);
    if (!prev) {
      throw new Error("No SMTP sender registered for this tenant.");
    }

    await deactivateTenantSmtp(
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
        host: prev.host,
        port: prev.port,
        from_address: prev.fromAddress,
        is_active: prev.isActive,
      },
      auditNewValues: {
        provider: prev.provider,
        host: prev.host,
        port: prev.port,
        from_address: prev.fromAddress,
        is_active: false,
        last_error: "Manually deactivated by admin",
      },
    };
  },
});
