/**
 * ControlDesk WhatsApp integration surface.
 *
 * Public exports only. Internal helpers live in sibling files —
 * keeping this barrel narrow makes it obvious what the rest of the
 * codebase depends on and what is safe to change.
 */

export {
  loadTenantWhatsAppConfig,
  saveTenantWhatsAppConfig,
  deactivateTenantWhatsApp,
  loadUserWhatsAppLink,
  saveUserWhatsAppLink,
  removeUserWhatsAppLink,
  touchInboundTimestamp,
  type WhatsAppProvider,
  type TenantWhatsAppConfig,
  type UserWhatsAppLink,
} from "./repository";

export {
  sendWhatsAppMessage,
  sendWhatsAppTest,
  verifyWhatsAppCredentials,
  WhatsAppApiError,
} from "./client";

export {
  encodeWhatsAppLinkToken,
  decodeWhatsAppLinkToken,
} from "./link-token";
