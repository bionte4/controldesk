/**
 * ControlDesk expense state machine (rules §9 threshold matrix).
 *
 * Canonical TypeScript implementation. Mirrored in Postgres via
 * `public.next_expense_status(numeric, expense_status)` from
 * `supabase/migrations/0009_expenses_and_approvals.sql`. Keep both in sync.
 */

import type { EmployeeRole } from "@/lib/rbac/roles";
import { APPROVAL_THRESHOLDS_IDR } from "@/lib/rbac/roles";
import type { ApprovalAction, ExpenseStatus } from "@/types/database";

/**
 * Operational role expected to approve each state. Finance gate is separate.
 * DRAFT / APPROVED / REJECTED / CANCELLED have no approver (null).
 */
export const STATUS_APPROVER_ROLE: Record<ExpenseStatus, EmployeeRole | null> = {
  DRAFT: null,
  PENDING_L1_SUPERVISOR: "SUPERVISOR",
  PENDING_L2_PROJECT_MANAGER: "PROJECT_MANAGER",
  PENDING_L2_5_FINANCE: "LEAD_FINANCE",
  PENDING_L3_OPERATIONS_MANAGER: "OPERATIONS_MANAGER",
  PENDING_L4_HEAD_MANAGER: "HEAD_MANAGER",
  PENDING_L5_GENERAL_MANAGER: "GENERAL_MANAGER",
  APPROVED: null,
  REJECTED: null,
  CANCELLED: null,
};

/** Statuses that indicate the expense is still in-flight for an approver. */
export const PENDING_STATUSES: readonly ExpenseStatus[] = [
  "PENDING_L1_SUPERVISOR",
  "PENDING_L2_PROJECT_MANAGER",
  "PENDING_L2_5_FINANCE",
  "PENDING_L3_OPERATIONS_MANAGER",
  "PENDING_L4_HEAD_MANAGER",
  "PENDING_L5_GENERAL_MANAGER",
] as const;

export function isPending(status: ExpenseStatus): boolean {
  return (PENDING_STATUSES as readonly ExpenseStatus[]).includes(status);
}

export function isTerminal(status: ExpenseStatus): boolean {
  return status === "APPROVED" || status === "REJECTED" || status === "CANCELLED";
}

/**
 * Given an approval action + current status + amount, return the resulting
 * status. Throws on invalid transitions to make callers fail loudly during
 * tests and in server actions.
 */
export function nextExpenseStatus(input: {
  amountIDR: number;
  current: ExpenseStatus;
  action: ApprovalAction;
}): ExpenseStatus {
  const { amountIDR, current, action } = input;

  if (action === "SUBMIT") {
    if (current !== "DRAFT") {
      throw new Error(
        `SUBMIT is only valid from DRAFT (current=${current}).`,
      );
    }
    return "PENDING_L1_SUPERVISOR";
  }

  if (action === "CANCEL") {
    if (isTerminal(current)) {
      throw new Error(
        `Cannot CANCEL a terminal expense (current=${current}).`,
      );
    }
    return "CANCELLED";
  }

  if (action === "REJECT" || action === "FINANCE_REJECT") {
    if (!isPending(current)) {
      throw new Error(
        `Cannot reject from non-pending status (current=${current}).`,
      );
    }
    return "REJECTED";
  }

  // APPROVE / FINANCE_APPROVE advance forward.
  const requiresL3 = amountIDR > APPROVAL_THRESHOLDS_IDR.L2_PROJECT_MANAGER;
  const requiresL4 = amountIDR > APPROVAL_THRESHOLDS_IDR.L3_OPERATIONS_MANAGER;
  const requiresL5 = amountIDR > APPROVAL_THRESHOLDS_IDR.L4_HEAD_MANAGER;

  switch (current) {
    case "PENDING_L1_SUPERVISOR":
      if (action !== "APPROVE") {
        throw new Error("Expected APPROVE at L1.");
      }
      return "PENDING_L2_PROJECT_MANAGER";
    case "PENDING_L2_PROJECT_MANAGER":
      if (action !== "APPROVE") {
        throw new Error("Expected APPROVE at L2.");
      }
      return "PENDING_L2_5_FINANCE";
    case "PENDING_L2_5_FINANCE":
      if (action !== "FINANCE_APPROVE") {
        throw new Error("Expected FINANCE_APPROVE at L2.5.");
      }
      return requiresL3 ? "PENDING_L3_OPERATIONS_MANAGER" : "APPROVED";
    case "PENDING_L3_OPERATIONS_MANAGER":
      if (action !== "APPROVE") {
        throw new Error("Expected APPROVE at L3.");
      }
      return requiresL4 ? "PENDING_L4_HEAD_MANAGER" : "APPROVED";
    case "PENDING_L4_HEAD_MANAGER":
      if (action !== "APPROVE") {
        throw new Error("Expected APPROVE at L4.");
      }
      return requiresL5 ? "PENDING_L5_GENERAL_MANAGER" : "APPROVED";
    case "PENDING_L5_GENERAL_MANAGER":
      if (action !== "APPROVE") {
        throw new Error("Expected APPROVE at L5.");
      }
      return "APPROVED";
    default:
      throw new Error(
        `Cannot approve from non-pending status (current=${current}).`,
      );
  }
}

/**
 * Returns the operational role expected to take the next action on a
 * pending expense. Used by the approvals inbox to filter rows for the
 * signed-in user.
 *
 * Returns null for terminal / draft states.
 */
export function expectedApproverRole(status: ExpenseStatus): EmployeeRole | null {
  return STATUS_APPROVER_ROLE[status];
}

/**
 * Whether the signed-in role may take the "next" action on `status`.
 * TENANT_ADMIN can always approve pending items in their tenant.
 */
export function canApproveNext(
  role: EmployeeRole,
  status: ExpenseStatus,
): boolean {
  if (!isPending(status)) return false;
  if (role === "TENANT_ADMIN") return true;
  return expectedApproverRole(status) === role;
}

/**
 * Compact human label for a status — used by the timeline UI. i18n later.
 */
export const STATUS_LABEL: Record<ExpenseStatus, string> = {
  DRAFT: "Draft",
  PENDING_L1_SUPERVISOR: "Pending L1 · Supervisor",
  PENDING_L2_PROJECT_MANAGER: "Pending L2 · Project Manager",
  PENDING_L2_5_FINANCE: "Pending L2.5 · Lead Finance",
  PENDING_L3_OPERATIONS_MANAGER: "Pending L3 · Operations Manager",
  PENDING_L4_HEAD_MANAGER: "Pending L4 · Head Manager",
  PENDING_L5_GENERAL_MANAGER: "Pending L5 · General Manager",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

/**
 * Tone hint for badges. Keys map to Tailwind text classes used across the app.
 */
export const STATUS_TONE: Record<ExpenseStatus, string> = {
  DRAFT: "border-white/10 bg-white/5 text-white/70",
  PENDING_L1_SUPERVISOR: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  PENDING_L2_PROJECT_MANAGER: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  PENDING_L2_5_FINANCE: "border-purple-400/30 bg-purple-500/10 text-purple-200",
  PENDING_L3_OPERATIONS_MANAGER: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  PENDING_L4_HEAD_MANAGER: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  PENDING_L5_GENERAL_MANAGER: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  APPROVED: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  REJECTED: "border-rose-400/30 bg-rose-500/10 text-rose-300",
  CANCELLED: "border-white/10 bg-white/5 text-white/50",
};
