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
