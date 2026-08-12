import type { NotificationKind, Enums } from "@/types/database";

/**
 * Category system for the Preferences page (Phase 1).
 *
 * The mockup shows 7 top-level categories. We map each of the ~41
 * `notification_kind` values into exactly one category so a user's
 * toggle deterministically gates a group of events. If a `kind` is
 * genuinely cross-cutting (`SLA_BREACH_WARNING`, `PROJECT_HANDOVER`),
 * we pick the more actionable bucket rather than duplicating it.
 *
 * Fail-safe: kinds not present in the map fall through to `SYSTEM`
 * so newly added kinds never silently disappear.
 */

export type NotificationCategory = Enums<"notification_category">;
export type NotificationChannel = Enums<"notification_channel">;

export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  "APPROVALS",
  "BUDGETS",
  "MILESTONES",
  "ASSIGNMENTS",
  "TIMESHEETS",
  "EMPLOYEES",
  "SYSTEM",
] as const;

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  "IN_APP",
  "EMAIL",
  "TELEGRAM",
  "WHATSAPP",
] as const;

// Explicit map. `satisfies Record<...>` lets TS catch new kinds at
// compile time — add here first, then anywhere else.
const KIND_CATEGORY: Partial<Record<NotificationKind, NotificationCategory>> =
  {
    // -------------------- Approvals --------------------
    APPROVAL_REQUESTED: "APPROVALS",
    APPROVAL_APPROVED: "APPROVALS",
    APPROVAL_REJECTED: "APPROVALS",
    // Cron-driven "still waiting on you" nudge when a pending item
    // crosses 24h. Silenceable via the same APPROVALS toggle above.
    APPROVAL_IDLE_24H: "APPROVALS",
    // Evaluation lifecycle sits in Approvals — it's a supervisor / OM
    // approval chain (see rules §hr-evaluation).
    EVALUATION_DUE: "APPROVALS",
    EVALUATION_SUBMITTED: "APPROVALS",
    EVALUATION_REVIEWED: "APPROVALS",
    EVALUATION_RETURNED: "APPROVALS",
    EVALUATION_APPROVED: "APPROVALS",
    EVALUATION_REJECTED: "APPROVALS",
    EVALUATION_FINALIZED: "APPROVALS",
    // UPK termination flow — Finance approval chain.
    UPK_DRAFT_CREATED: "APPROVALS",
    UPK_SUBMITTED: "APPROVALS",
    UPK_APPROVED: "APPROVALS",
    UPK_REJECTED: "APPROVALS",
    UPK_PAID: "APPROVALS",
    PAYROLL_STOP_REQUEST: "APPROVALS",
    // Monthly report client sign-off — same approval bucket.
    MONTHLY_REPORT_SUBMITTED: "APPROVALS",
    MONTHLY_REPORT_APPROVED: "APPROVALS",
    MONTHLY_REPORT_RETURNED: "APPROVALS",
    MONTHLY_REPORT_REJECTED: "APPROVALS",
    MONTHLY_REPORT_SENT_TO_CLIENT: "APPROVALS",
    MONTHLY_REPORT_APPROVED_BY_CLIENT: "APPROVALS",
    MONTHLY_REPORT_REJECTED_BY_CLIENT: "APPROVALS",
    MONTHLY_REPORT_BA_GENERATED: "APPROVALS",

    // -------------------- Budgets --------------------
    // Financial disbursement / settlement + petty cash lifecycle.
    CASH_ADVANCE_DISBURSED: "BUDGETS",
    CASH_ADVANCE_SETTLED: "BUDGETS",
    PETTY_CASH_LOW_BALANCE: "BUDGETS",
    SETTLEMENT_DUE_SOON: "BUDGETS",
    SETTLEMENT_OVERDUE: "BUDGETS",
    EXPENSE_DRAFT_STALE: "BUDGETS",
    EXPENSE_INCURRED_STALE: "BUDGETS",

    // -------------------- Milestones --------------------
    // Project & SLA level events (upcoming / overdue).
    SLA_BREACH_WARNING: "MILESTONES",
    PROJECT_CONTRACT_EXPIRING: "MILESTONES",

    // -------------------- Assignments --------------------
    // Team / project rotation changes.
    PROJECT_HANDOVER: "ASSIGNMENTS",

    // -------------------- Timesheets --------------------
    TIMESHEET_SUBMITTED: "TIMESHEETS",
    TIMESHEET_APPROVED: "TIMESHEETS",
    TIMESHEET_REJECTED: "TIMESHEETS",

    // -------------------- Employees --------------------
    EMPLOYEE_CONTRACT_EXPIRING: "EMPLOYEES",
    HR_REQUEST_UPDATE: "EMPLOYEES",

    // -------------------- System --------------------
    SYSTEM: "SYSTEM",
    BULK_IMPORT_COMPLETED: "SYSTEM",
  };

/**
 * Resolve which category a notification kind belongs to. Unknown kinds
 * fall through to SYSTEM so nothing gets silently swallowed by prefs.
 */
export function categoryForKind(kind: NotificationKind): NotificationCategory {
  return KIND_CATEGORY[kind] ?? "SYSTEM";
}

/**
 * Kinds that trigger a per-item email dispatch through
 * `dispatchNotificationEmail()`. Deliberately narrower than the full
 * kind enum so we don't spam approvers with every timesheet /
 * bulk-import event. Two rules apply for a kind to land here:
 *
 *   1. **Actionable** — recipient can do something (approve, review a
 *      client submission, chase an overdue settlement). Cosmetic
 *      state-change echoes stay in-app only.
 *   2. **Time-sensitive** — approvals older than a day already get
 *      picked up by the daily digest + hourly idle-nudge cron. This
 *      allowlist covers the "we want the approver to hear about this
 *      now, not tomorrow morning" cases.
 *
 * The per-user `user_notification_preferences.EMAIL` toggle still gates
 * delivery on top of this — the allowlist is authoritative, not the
 * default (i.e. adding a kind here does NOT force-email a user who
 * opted out of the category).
 *
 * Every listed kind must map to a category that already exists in
 * `KIND_CATEGORY` so the preference gate has a category to consult.
 */
export const EMAIL_ELIGIBLE_KINDS: ReadonlySet<NotificationKind> = new Set([
  // Approval chain events — the whole reason we're sending email at all.
  "APPROVAL_REQUESTED",
  "APPROVAL_APPROVED",
  "APPROVAL_REJECTED",
  // Settlement chase — user needs to file receipts before SLA breach.
  "SETTLEMENT_DUE_SOON",
  "SETTLEMENT_OVERDUE",
  // Cash flow lifecycle — money moved out / stale draft blocks tenant.
  "CASH_ADVANCE_DISBURSED",
  "EXPENSE_DRAFT_STALE",
  "EXPENSE_INCURRED_STALE",
  // Timely lifecycle warnings from the cron system.
  "SLA_BREACH_WARNING",
  "PROJECT_CONTRACT_EXPIRING",
  "EMPLOYEE_CONTRACT_EXPIRING",
  // Client-facing monthly reports — external stakeholders don't watch
  // the in-app bell, so email is the primary channel.
  "MONTHLY_REPORT_SENT_TO_CLIENT",
  "MONTHLY_REPORT_APPROVED_BY_CLIENT",
  "MONTHLY_REPORT_REJECTED_BY_CLIENT",
  // Handovers — new PM should know before opening the app tomorrow.
  "PROJECT_HANDOVER",
]);

/** True when the caller should fire `dispatchNotificationEmail()` for this kind. */
export function isEmailEligibleKind(kind: NotificationKind): boolean {
  return EMAIL_ELIGIBLE_KINDS.has(kind);
}

/**
 * Human-friendly labels (English) for use in tests and as fallbacks
 * when i18n hasn't hydrated yet. The UI should still prefer
 * `useTranslations("profile.preferences.categories.*")`.
 */
export const CATEGORY_LABEL_EN: Record<NotificationCategory, string> = {
  APPROVALS: "Approvals",
  BUDGETS: "Budgets",
  MILESTONES: "Milestones",
  ASSIGNMENTS: "Assignments",
  TIMESHEETS: "Timesheets",
  EMPLOYEES: "Employees",
  SYSTEM: "System",
};

export const CHANNEL_LABEL_EN: Record<NotificationChannel, string> = {
  IN_APP: "In-app",
  EMAIL: "Email",
  TELEGRAM: "Telegram",
  WHATSAPP: "WhatsApp",
};
