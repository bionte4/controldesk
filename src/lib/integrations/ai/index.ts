/**
 * ControlDesk per-tenant AI integration surface.
 *
 * Public exports only. Internal helpers live in sibling files —
 * keeping this barrel narrow makes it obvious what the rest of the
 * codebase depends on and what is safe to change.
 */

export {
  loadTenantAiConfig,
  saveTenantAiConfig,
  deactivateTenantAi,
  type AiProvider,
  type TenantAiConfig,
} from "./repository";

export {
  resolveAiModel,
  resolveDailyTokenCap,
  type ResolvedAiModel,
} from "./resolver";

export { verifyAiCredentials } from "./verify";
