/**
 * Project contract-expiry reminder configuration (rules §7 + §20).
 *
 * These thresholds drive the `/api/cron/project-contract-reminders` sweep.
 * Kept as a `readonly` tuple so downstream callers can iterate deterministically
 * and TypeScript can narrow the element type at each usage.
 *
 * Rationale for the specific choices:
 *   - 30 days: gives Finance + PM enough runway to prepare a renewal SOW,
 *     re-negotiate rates, or hand over to a replacement vendor.
 *   - 14 days: escalates to Head Manager / GM if the renewal is still open.
 *   - 7 days:  final internal escalation; unblocks the "extend vs sunset"
 *     decision before the client-facing communication window.
 *   - 3 days:  last-minute nudge — surfaces contracts that slipped past
 *     the earlier windows (e.g. because the project was DRAFT until now).
 *
 * We intentionally do NOT alert on day-of-expiry — by then the project
 * status should already be updated (COMPLETED / ON_HOLD) or the contract
 * extended.
 */
export const PROJECT_CONTRACT_EXPIRY_THRESHOLDS_DAYS = [30, 14, 7, 3] as const;
export type ProjectContractExpiryThreshold =
  (typeof PROJECT_CONTRACT_EXPIRY_THRESHOLDS_DAYS)[number];

/**
 * Statuses that are still "in-flight" enough to warrant a reminder. Skipping
 * COMPLETED / ARCHIVED / CANCELLED avoids noisy notifications on projects the
 * team already wound down.
 */
export const PROJECT_STATUSES_ELIGIBLE_FOR_EXPIRY_REMINDER = [
  "DRAFT",
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
] as const;

/**
 * Deterministic reminder body for a given threshold. Indonesian-first per
 * rules §18 locale hygiene.
 */
export function formatProjectExpiryReminder(args: {
  projectName: string;
  projectCode: string;
  daysUntilExpiry: number;
  endDateIso: string;
}): { title: string; body: string } {
  const { projectName, projectCode, daysUntilExpiry, endDateIso } = args;
  const suffix =
    daysUntilExpiry === 1
      ? "berakhir besok"
      : `berakhir dalam ${daysUntilExpiry} hari`;
  return {
    title: `Kontrak proyek ${projectCode} ${suffix}`,
    body: `${projectName} · berakhir ${endDateIso}`,
  };
}
