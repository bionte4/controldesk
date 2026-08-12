/**
 * ControlDesk per-tenant SMTP integration surface.
 *
 * Public exports only. Internal helpers live in sibling files —
 * keeping this barrel narrow makes it obvious what the rest of the
 * codebase depends on and what is safe to change.
 */

export {
  loadTenantSmtpConfig,
  saveTenantSmtpConfig,
  deactivateTenantSmtp,
  recordSmtpError,
  type SmtpProvider,
  type TenantSmtpConfig,
} from "./repository";

export { verifySmtpCredentials } from "./verify";
