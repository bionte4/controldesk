/**
 * ControlDesk timesheet state machine (rules §14).
 *
 * Chain:
 *   DRAFT
 *     → SUBMIT       → SUBMITTED
 *     → APPROVE      → APPROVED     (Supervisor / PM / HR Admin)
 *     → REJECT       → REJECTED     (send back to DRAFT via reopen)
 *
 * Terminal statuses are APPROVED and REJECTED. Rejected sheets can be edited
 * and re-submitted (client-side flow) — from REJECTED the SUBMIT action
 * transitions back to SUBMITTED without going through DRAFT.
 */

import type { EmployeeRole } from "@/lib/rbac/roles";
import type { TimesheetStatus } from "@/types/database";

export const TS_PENDING_STATUSES: readonly TimesheetStatus[] = [
  "SUBMITTED",
] as const;

export const TS_STATUS_APPROVER_ROLES: readonly EmployeeRole[] = [
  "SUPERVISOR",
  "PROJECT_MANAGER",
  "OPERATIONS_MANAGER",
  "HR_ADMIN",
  "TENANT_ADMIN",
];

export function isTimesheetPending(status: TimesheetStatus): boolean {
  return status === "SUBMITTED";
}

export function isTimesheetTerminal(status: TimesheetStatus): boolean {
  return status === "APPROVED" || status === "REJECTED";
}

export type TimesheetAction = "SUBMIT" | "APPROVE" | "REJECT";

export function nextTimesheetStatus(input: {
  current: TimesheetStatus;
  action: TimesheetAction;
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

export function canApproveTimesheet(
  role: EmployeeRole,
  status: TimesheetStatus,
): boolean {
  if (!isTimesheetPending(status)) return false;
  return TS_STATUS_APPROVER_ROLES.includes(role);
}

export const TS_STATUS_LABEL: Record<TimesheetStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export const TS_STATUS_TONE: Record<TimesheetStatus, string> = {
  DRAFT: "border-white/10 bg-white/5 text-white/70",
  SUBMITTED: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  APPROVED: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  REJECTED: "border-rose-400/30 bg-rose-500/10 text-rose-300",
};
