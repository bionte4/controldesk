import "server-only";

import { loadTenantBotConfig, loadUserLink } from "./repository";

/**
 * Thin wrapper over the Telegram Bot API `sendMessage` endpoint.
 *
 * Contract:
 *   * Always resolves — never throws. On failure returns { ok: false }
 *     with a machine-readable code. Callers surface these to the UI /
 *     retry queue as they see fit.
 *   * HTML parse mode for basic formatting (bold links / newlines).
 *     Callers must pre-escape user-supplied strings — do NOT pass raw
 *     employee names or PII without escaping (rules §15 AI Safety
 *     principle extends here: HTML injection risk).
 *   * 5-second timeout so a slow API can't wedge a Server Action.
 */

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NO_BOT"
      | "NO_LINK"
      | "HTTP"
      | "TIMEOUT"
      | "TELEGRAM_ERROR",
  ) {
    super(message);
    this.name = "TelegramApiError";
  }
}

const TELEGRAM_TIMEOUT_MS = 5000;

async function callTelegram(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; description?: string; result?: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    const parsed = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: unknown;
    };
    return {
      ok: !!parsed.ok,
      description: parsed.description,
      result: parsed.result,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, description: "Timeout after 5s." };
    }
    return {
      ok: false,
      description: err instanceof Error ? err.message : "Unknown error.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a Telegram message to a specific chat, using the tenant's
 * bot token. Returns {ok:true} on success, {ok:false, code} otherwise.
 */
export async function sendTelegramMessage(input: {
  tenantId: string;
  chatId: string;
  text: string;
  disableNotification?: boolean;
}): Promise<
  | { ok: true; providerMessageId: number | null }
  | { ok: false; code: TelegramApiError["code"]; error: string }
> {
  const bot = await loadTenantBotConfig(input.tenantId);
  if (!bot || !bot.isActive || !bot.botToken) {
    return {
      ok: false,
      code: "NO_BOT",
      error: "Tenant has not configured a Telegram bot.",
    };
  }

  const res = await callTelegram(bot.botToken, "sendMessage", {
    chat_id: input.chatId,
    text: input.text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    disable_notification: input.disableNotification ?? false,
  });

  if (!res.ok) {
    return {
      ok: false,
      code: res.description?.startsWith("Timeout") ? "TIMEOUT" : "TELEGRAM_ERROR",
      error: res.description ?? "Unknown Telegram error.",
    };
  }
  const providerMessageId =
    (res.result as { message_id?: number } | undefined)?.message_id ?? null;
  return { ok: true, providerMessageId };
}

/**
 * Verify a plaintext bot token by calling Telegram's `getMe`. Cheap
 * (single round-trip, no side effects) and confirms:
 *   1. token is well-formed
 *   2. token belongs to a real bot (Telegram accepts it)
 *   3. we can reach `api.telegram.org` from this server
 *
 * Also returns the canonical bot username Telegram has on file —
 * admins sometimes typo the `@handle_bot` in the form, so we surface
 * the server-authoritative value so the client can display it.
 *
 * This helper deliberately takes a **plaintext token** (never reads
 * the DB) because it is called by the admin registration flow BEFORE
 * anything is written. Callers should never persist the plaintext
 * token beyond the encrypted-column write in `saveTenantBotConfig`.
 */
export async function verifyTelegramBotToken(
  botToken: string,
): Promise<
  | { ok: true; botUsername: string; botId: number }
  | { ok: false; code: TelegramApiError["code"]; error: string }
> {
  const res = await callTelegram(botToken, "getMe", {});
  if (!res.ok) {
    return {
      ok: false,
      code: res.description?.startsWith("Timeout") ? "TIMEOUT" : "TELEGRAM_ERROR",
      error: res.description ?? "Unknown Telegram error.",
    };
  }
  const info = res.result as
    | { id?: number; username?: string; is_bot?: boolean }
    | undefined;
  if (!info?.username || !info.is_bot || typeof info.id !== "number") {
    return {
      ok: false,
      code: "TELEGRAM_ERROR",
      error: "Telegram getMe returned an unexpected payload.",
    };
  }
  return { ok: true, botUsername: info.username, botId: info.id };
}

/**
 * Send the canonical "test" message to the user's linked chat, used
 * by the "Send test" button in Preferences. Returns a rich failure
 * object so the toast can be precise.
 */
export async function sendTelegramTest(input: {
  tenantId: string;
  userId: string;
  locale: "id" | "en";
}): Promise<
  | { ok: true; providerMessageId: number | null }
  | { ok: false; code: TelegramApiError["code"]; error: string }
> {
  const link = await loadUserLink({
    tenantId: input.tenantId,
    userId: input.userId,
  });
  if (!link) {
    return {
      ok: false,
      code: "NO_LINK",
      error: "User has not linked their Telegram chat.",
    };
  }

  const text =
    input.locale === "id"
      ? "<b>ControlDesk Telegram terhubung ✅</b>\nNotifikasi ControlDesk akan dikirim ke chat ini."
      : "<b>ControlDesk Telegram is linked ✅</b>\nControlDesk notifications will land in this chat.";

  return sendTelegramMessage({
    tenantId: input.tenantId,
    chatId: link.chatId,
    text,
  });
}
