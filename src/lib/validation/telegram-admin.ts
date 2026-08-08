import { z } from "zod";

/**
 * Zod schemas for the tenant Telegram bot admin surface
 * (rules §17). One schema per server action so tests can validate
 * the contract independently of the wrapper machinery.
 *
 * Format notes:
 *   * `bot_token` from @BotFather looks like `123456789:ABC-DEF...`.
 *     The colon separator + non-empty halves are the minimum we can
 *     usefully validate without duplicating the Telegram API. The
 *     verify helper (`verifyTelegramBotToken`) is the real gate.
 *   * `bot_username` from Telegram is 5–32 chars, ASCII letters,
 *     digits, underscore, must end with `bot` (case-insensitive).
 *     The verify helper is authoritative here too — we accept a
 *     forgiving character set so a typo in the leading `@` doesn't
 *     block a valid submission before the API call happens.
 */

const BOT_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]{20,}$/;

export const saveTelegramBotSchema = z.object({
  bot_username: z
    .string()
    .trim()
    .min(3, "Bot username too short.")
    .max(64, "Bot username too long.")
    // Strip a leading `@` so admins can copy-paste either shape.
    .transform((v) => (v.startsWith("@") ? v.slice(1) : v))
    .refine((v) => /^[A-Za-z0-9_]+$/.test(v), {
      message: "Only letters, digits, and underscores are allowed.",
    })
    .refine((v) => /bot$/i.test(v), {
      message: 'Telegram bot usernames must end with "bot".',
    }),
  bot_token: z
    .string()
    .trim()
    .min(20, "Bot token is too short.")
    .max(200, "Bot token is too long.")
    .refine((v) => BOT_TOKEN_PATTERN.test(v), {
      message:
        'Bot token format is "<numeric-id>:<secret>" — check @BotFather output.',
    }),
});
export type SaveTelegramBotInput = z.infer<typeof saveTelegramBotSchema>;

/**
 * Deactivation carries no input from the client (tenant is scoped
 * from the actor). Kept as an empty object so `withSecureAction`
 * treats it uniformly.
 */
export const deactivateTelegramBotSchema = z.object({});
export type DeactivateTelegramBotInput = z.infer<
  typeof deactivateTelegramBotSchema
>;
