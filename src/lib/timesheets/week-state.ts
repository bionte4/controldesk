/**
 * ControlDesk — Weekly Timesheet state machine + ISO-week helpers (GAS §27).
 *
 * A "week" is the ISO-8601 Monday-to-Sunday span. `weekStartFromDate(d)`
 * returns the Monday of the ISO week containing `d`; `weekDatesFromStart(m)`
 * expands the seven date strings the UI needs.
 *
 * The status machine reuses `TimesheetStatus` (from migration 0015) so a
 * weekly packet shares vocabulary with its daily rows:
 *
 *   DRAFT
 *     └ SUBMIT ─► SUBMITTED
 *                 ├─ APPROVE ─► APPROVED   (terminal)
 *                 └─ REJECT  ─► REJECTED
 *   REJECTED
 *     └ SUBMIT ─► SUBMITTED               (resubmit after edit)
 */

import type { EmployeeRole } from "@/lib/rbac/roles";
import type { ApprovalAction, TimesheetStatus } from "@/types/database";

// ---------------------------------------------------------------------------
// Status constants + guards.
// ---------------------------------------------------------------------------

export const TW_STATUSES: readonly TimesheetStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
] as const;

export const TW_PENDING_STATUSES: readonly TimesheetStatus[] = ["SUBMITTED"];

export function isTwPending(status: TimesheetStatus): boolean {
  return status === "SUBMITTED";
}

export function isTwTerminal(status: TimesheetStatus): boolean {
  return status === "APPROVED";
}

export function isTwEditable(status: TimesheetStatus): boolean {
  return status === "DRAFT" || status === "REJECTED";
}

// ---------------------------------------------------------------------------
// Role-based approval matrix (matches per-day flow in `state.ts`).
// ---------------------------------------------------------------------------

const TW_APPROVER_ROLES: readonly EmployeeRole[] = [
  "SUPERVISOR",
  "PROJECT_MANAGER",
  "OPERATIONS_MANAGER",
  "HEAD_MANAGER",
  "GENERAL_MANAGER",
  "HR_ADMIN",
  "TENANT_ADMIN",
];

export function canApproveWeek(
  role: EmployeeRole,
  status: TimesheetStatus,
): boolean {
  if (!isTwPending(status)) return false;
  return TW_APPROVER_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// State transitions.
// ---------------------------------------------------------------------------

export type WeeklyTimesheetAction = "SUBMIT" | "APPROVE" | "REJECT";

export function nextWeekStatus(input: {
  current: TimesheetStatus;
  action: WeeklyTimesheetAction;
}): TimesheetStatus {
  const { current, action } = input;
  if (action === "SUBMIT") {
    if (current !== "DRAFT" && current !== "REJECTED") {
      throw new Error(
        `SUBMIT only valid from DRAFT or REJECTED (current=${current}).`,
      );
    }
    return "SUBMITTED";
  }
  if (action === "APPROVE") {
    if (current !== "SUBMITTED") {
      throw new Error(
        `APPROVE only valid from SUBMITTED (current=${current}).`,
      );
    }
    return "APPROVED";
  }
  if (action === "REJECT") {
    if (current !== "SUBMITTED") {
      throw new Error(`REJECT only valid from SUBMITTED (current=${current}).`);
    }
    return "REJECTED";
  }
  throw new Error(`Unsupported action: ${action satisfies never}`);
}

/**
 * Map a weekly action to the `approval_action` audit enum used by
 * `timesheet_week_approval_logs`.
 */
export function toApprovalAction(
  action: WeeklyTimesheetAction,
): ApprovalAction {
  return action === "SUBMIT"
    ? "SUBMIT"
    : action === "APPROVE"
      ? "APPROVE"
      : "REJECT";
}

// ---------------------------------------------------------------------------
// ISO-week date helpers — pure, UTC-safe, no `date-fns` dependency to keep
// the surface tiny and testable.
// ---------------------------------------------------------------------------

/**
 * Return the ISO-8601 Monday of the week containing `date`, as a "YYYY-MM-DD"
 * string. Input may be a Date or a "YYYY-MM-DD" string.
 */
export function weekStartFromDate(input: Date | string): string {
  const date = typeof input === "string" ? parseYmd(input) : new Date(input);
  // JS: Sunday = 0, Monday = 1 … Saturday = 6.
  const dow = date.getUTCDay();
  // Distance back to Monday: for Sunday (0) → 6, else dow - 1.
  const daysBack = dow === 0 ? 6 : dow - 1;
  const monday = new Date(date.getTime());
  monday.setUTCDate(date.getUTCDate() - daysBack);
  return toYmd(monday);
}

/** Return the 7 ISO date strings (Mon..Sun) starting at `weekStart`. */
export function weekDatesFromStart(weekStart: string): string[] {
  const start = parseYmd(weekStart);
  const out: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start.getTime());
    d.setUTCDate(start.getUTCDate() + i);
    out.push(toYmd(d));
  }
  return out;
}

/** ISO Sunday (end date) for a Monday `weekStart`. */
export function weekEndFromStart(weekStart: string): string {
  const dates = weekDatesFromStart(weekStart);
  return dates[6];
}

/** True if `s` is a "YYYY-MM-DD" string that is an ISO Monday. */
export function isIsoMonday(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseYmd(s);
  if (Number.isNaN(d.getTime())) return false;
  return d.getUTCDay() === 1;
}

/** True if `s` falls between (inclusive) `weekStart` and its Sunday. */
export function isWithinWeek(weekStart: string, s: string): boolean {
  const start = parseYmd(weekStart);
  const end = parseYmd(weekEndFromStart(weekStart));
  const d = parseYmd(s);
  return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
}

// ---------------------------------------------------------------------------
// Internal date helpers.
// ---------------------------------------------------------------------------

function parseYmd(s: string): Date {
  // Force UTC so timezone drifts don't move us to Sunday/Monday boundaries.
  return new Date(`${s}T00:00:00.000Z`);
}

function toYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Tone tokens for badges (matches existing state.ts convention).
// ---------------------------------------------------------------------------

export const TW_STATUS_TONE: Record<TimesheetStatus, string> = {
  DRAFT: "border-white/10 bg-white/5 text-white/70",
  SUBMITTED: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  APPROVED: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  REJECTED: "border-rose-400/30 bg-rose-500/10 text-rose-300",
};
