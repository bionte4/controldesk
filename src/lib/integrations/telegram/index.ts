/**
 * ControlDesk Telegram integration surface.
 *
 * Public exports only — internal helpers (repository, HTTP client)
 * live in sibling files and are re-exported when they are safe to
 * touch from server actions. Keeping the barrel narrow makes it
 * obvious what the rest of the codebase depends on.
 */

export {
  loadTenantBotConfig,
  saveTenantBotConfig,
  deactivateTenantBot,
  loadUserLink,
  saveUserLink,
  removeUserLink,
} from "./repository";

export {
  sendTelegramMessage,
  sendTelegramTest,
  verifyTelegramBotToken,
  TelegramApiError,
} from "./client";

export { encodeLinkToken, decodeLinkToken } from "./link-token";
