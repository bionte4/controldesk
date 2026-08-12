"use server";

import { revalidatePath } from "next/cache";

import {
  deactivateTenantBot,
  loadTenantBotConfig,
  saveTenantBotConfig,
  verifyTelegramBotToken,
} from "@/lib/integrations/telegram";
import { withSecureAction } from "@/lib/security/action-wrapper";
import {
  deactivateTelegramBotSchema,
  saveTelegramBotSchema,
} from "@/lib/validation/telegram-admin";

/**
 * Server actions for the tenant Telegram bot admin surface
 * (rules §17). Both actions are gated by PDP `telegram_bot_config`
 * — only TENANT_ADMIN + GENERAL_MANAGER can invoke them. Every
 * mutation writes an audit row via `withSecureAction`.
 *
 * The save action verifies the bot token against Telegram's
 * `getMe` BEFORE persisting, so a mistyped token can never land in
 * the encrypted store. The verified `botUsername` returned by
 * Telegram is authoritative — we prefer it over the free-text
 * `bot_username` the admin typed, so any casing / prefix drift is
 * normalised at write time.
 *
 * Errors from the verify call are surfaced as thrown `Error`s. The
 * wrapper folds them into `ActionResult { ok: false, code: "INTERNAL" }`
 * with the underlying `error` string as `reason`, so the client toast
 * shows the exact Telegram description (e.g. "Unauthorized" for a
 * revoked token).
 */

const REVALIDATE_PATH = "/settings/integrations/telegram-bot";
const HUB_PATH = "/settings/integrations";

/**
 * Register or update the tenant's Telegram bot. Verifies the token
 * against Telegram's `getMe` first; on success stores the encrypted
 * token + verified username and (re)activates the row.
 *
 * The action returns the verified `botUsername` so the client can
 * confirm what actually landed (may differ in case from what the
 * admin typed if BotFather has a canonical form).
 */
export const saveTelegramBotAction = withSecureAction({
  schema: saveTelegramBotSchema,
  resource: "telegram_bot_config",
  action: "update",
  auditAction: "UPDATE",
  auditResourceName: "tenant_telegram_bots",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (input, ctx) => {
    const verify = await verifyTelegramBotToken(input.bot_token);
    if (!verify.ok) {
      throw new Error(`Telegram rejected the token: ${verify.error}`);
    }

    // If the admin typed a different username than BotFather's canonical
    // form, treat Telegram's answer as source of truth. This prevents a
    // subtle mismatch where the DB stores `MyERPbot` but Telegram deep
    // links only work with `my_erp_bot`.
    const canonicalUsername = verify.botUsername;

    const prev = await loadTenantBotConfig(ctx.actor.tenantId);

    await saveTenantBotConfig({
      tenantId: ctx.actor.tenantId,
      botUsername: canonicalUsername,
      botToken: input.bot_token,
    });

    revalidatePath(REVALIDATE_PATH);
    revalidatePath(HUB_PATH);

    return {
      result: {
        botUsername: canonicalUsername,
        botId: verify.botId,
      },
      auditResourceId: ctx.actor.tenantId,
      auditOldValues: prev
        ? {
            bot_username: prev.botUsername,
            is_active: prev.isActive,
            last_error: prev.lastError,
          }
        : null,
      auditNewValues: {
        bot_username: canonicalUsername,
        is_active: true,
        last_error: null,
      },
      // Never audit the plaintext token itself — the audit row is
      // readable to too many roles for that. `bot_id` is a public
      // identifier so it's safe.
      auditMetadata: { bot_id: verify.botId },
    };
  },
});

/**
 * Soft-deactivate the tenant's Telegram bot. Row stays in the DB
 * (retains `last_error` history and audit trail) but outbound
 * dispatch stops and the personal-linking button in Preferences
 * disappears again.
 *
 * To fully re-enable, admin submits the save form again with a valid
 * token — `saveTenantBotConfig` sets `is_active=true` unconditionally.
 */
export const deactivateTelegramBotAction = withSecureAction({
  schema: deactivateTelegramBotSchema,
  resource: "telegram_bot_config",
  action: "delete",
  auditAction: "DELETE",
  auditResourceName: "tenant_telegram_bots",
  resolveAttributes: async (_input, ctx) => ({
    tenantId: ctx.actor.tenantId,
  }),
  handler: async (_input, ctx) => {
    const prev = await loadTenantBotConfig(ctx.actor.tenantId);
    if (!prev) {
      throw new Error("No Telegram bot registered for this tenant.");
    }

    await deactivateTenantBot(
      ctx.actor.tenantId,
      "Manually deactivated by admin",
    );

    revalidatePath(REVALIDATE_PATH);
    revalidatePath(HUB_PATH);

    return {
      result: { deactivated: true },
      auditResourceId: ctx.actor.tenantId,
      auditOldValues: {
        bot_username: prev.botUsername,
        is_active: prev.isActive,
      },
      auditNewValues: {
        bot_username: prev.botUsername,
        is_active: false,
        last_error: "Manually deactivated by admin",
      },
    };
  },
});
