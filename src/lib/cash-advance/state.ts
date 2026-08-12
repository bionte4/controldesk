/**
 * ControlDesk Cash Advance state machine (rules §11).
 *
 * Canonical TypeScript implementation. Mirrored in Postgres via
 * `public.next_cash_advance_status(numeric, cash_advance_status)` from
 * `supabase/migrations/0011_cash_advance.sql`. Keep both in sync.
 *
 * Chain:
 *   DRAFT
 *     → threshold matrix like expenses (§9)
 *     → APPROVED
 *     → DISBURSED   (Lead Finance action)
 *     → SETTLED     (owner submits nota/struk + Finance accepts settlement)
 */

import type { EmployeeRole } from "@/lib/rbac/roles";
import { APPROVAL_THRESHOLDS_IDR } from "@/lib/rbac/roles";
import type { ApprovalAction, CashAdvanceStatus } from "@/types/database";

export const CA_STATUS_APPROVER_ROLE: Record<
  CashAdvanceStatus,
  EmployeeRole | null
> = {
  DRAFT: null,
  PENDING_L1_SUPERVISOR: "SUPERVISOR",
  PENDING_L2_PROJECT_MANAGER: "PROJECT_MANAGER",
  PENDING_L2_5_FINANCE: "LEAD_FINANCE",
  PENDING_L3_OPERATIONS_MANAGER: "OPERATIONS_MANAGER",
  PENDING_L4_HEAD_MANAGER: "HEAD_MANAGER",
  PENDING_L5_GENERAL_MANAGER: "GENERAL_MANAGER",
  // Canonical (GAS-aligned) statuses — routed through the canonical state
  // machine in `state-canonical.ts`. Legacy chain leaves these unused.
  PENDING_SUPERVISOR: "SUPERVISOR",
  PENDING_PM: "PROJECT_MANAGER",
  PENDING_OM: "OPERATIONS_MANAGER",
  PENDING_FINANCE: "LEAD_FINANCE",
  PENDING_DIRECTOR: "GENERAL_MANAGER",
  APPROVED: "LEAD_FINANCE", // waiting for disbursement
  DISBURSED: null, // waiting for settlement (owner initiates)
  SETTLED: null,
  REJECTED: null,
  CANCELLED: null,
};

export const CA_PENDING_APPROVAL_STATUSES: readonly CashAdvanceStatus[] = [
  "PENDING_L1_SUPERVISOR",
  "PENDING_L2_PROJECT_MANAGER",
  "PENDING_L2_5_FINANCE",
  "PENDING_L3_OPERATIONS_MANAGER",
  "PENDING_L4_HEAD_MANAGER",
  "PENDING_L5_GENERAL_MANAGER",
] as const;

export function isCaPendingApproval(status: CashAdvanceStatus): boolean {
  return (CA_PENDING_APPROVAL_STATUSES as readonly CashAdvanceStatus[]).includes(
    status,
  );
}

export function isCaTerminal(status: CashAdvanceStatus): boolean {
  return (
    status === "SETTLED" || status === "REJECTED" || status === "CANCELLED"
  );
}

export function nextCashAdvanceStatus(input: {
  amountIDR: number;
  current: CashAdvanceStatus;
  action: ApprovalAction;
}): CashAdvanceStatus {
  const { amountIDR, current, action } = input;

  if (action === "SUBMIT") {
    if (current !== "DRAFT") {
      throw new Error(`SUBMIT only valid from DRAFT (current=${current}).`);
    }
    return "PENDING_L1_SUPERVISOR";
  }

  if (action === "CANCEL") {
    if (isCaTerminal(current)) {
      throw new Error(`Cannot CANCEL terminal cash advance (current=${current}).`);
    }
    return "CANCELLED";
  }

  if (action === "REJECT" || action === "FINANCE_REJECT") {
    if (!isCaPendingApproval(current)) {
      throw new Error(
        `Cannot reject from non-pending status (current=${current}).`,
      );
    }
    return "REJECTED";
  }

  const requiresL3 = amountIDR > APPROVAL_THRESHOLDS_IDR.L2_PROJECT_MANAGER;
  const requiresL4 = amountIDR > APPROVAL_THRESHOLDS_IDR.L3_OPERATIONS_MANAGER;
  const requiresL5 = amountIDR > APPROVAL_THRESHOLDS_IDR.L4_HEAD_MANAGER;

  switch (current) {
    case "PENDING_L1_SUPERVISOR":
      if (action !== "APPROVE") throw new Error("Expected APPROVE at L1.");
      return "PENDING_L2_PROJECT_MANAGER";
    case "PENDING_L2_PROJECT_MANAGER":
      if (action !== "APPROVE") throw new Error("Expected APPROVE at L2.");
      return "PENDING_L2_5_FINANCE";
    case "PENDING_L2_5_FINANCE":
      if (action !== "FINANCE_APPROVE") {
        throw new Error("Expected FINANCE_APPROVE at L2.5.");
      }
      return requiresL3 ? "PENDING_L3_OPERATIONS_MANAGER" : "APPROVED";
    case "PENDING_L3_OPERATIONS_MANAGER":
      if (action !== "APPROVE") throw new Error("Expected APPROVE at L3.");
      return requiresL4 ? "PENDING_L4_HEAD_MANAGER" : "APPROVED";
    case "PENDING_L4_HEAD_MANAGER":
      if (action !== "APPROVE") throw new Error("Expected APPROVE at L4.");
      return requiresL5 ? "PENDING_L5_GENERAL_MANAGER" : "APPROVED";
    case "PENDING_L5_GENERAL_MANAGER":
      if (action !== "APPROVE") throw new Error("Expected APPROVE at L5.");
      return "APPROVED";
    default:
      throw new Error(
        `Cannot approve from non-pending status (current=${current}).`,
      );
  }
}

export function expectedCaApproverRole(
  status: CashAdvanceStatus,
): EmployeeRole | null {
  return CA_STATUS_APPROVER_ROLE[status];
}

export function canApproveNextCa(
  role: EmployeeRole,
  status: CashAdvanceStatus,
): boolean {
  if (!isCaPendingApproval(status)) return false;
  if (role === "TENANT_ADMIN") return true;
  return expectedCaApproverRole(status) === role;
}

export const CA_STATUS_LABEL: Record<CashAdvanceStatus, string> = {
  DRAFT: "Draft",
  PENDING_L1_SUPERVISOR: "Pending L1 · Supervisor",
  PENDING_L2_PROJECT_MANAGER: "Pending L2 · Project Manager",
  PENDING_L2_5_FINANCE: "Pending L2.5 · Lead Finance",
  PENDING_L3_OPERATIONS_MANAGER: "Pending L3 · Operations Manager",
  PENDING_L4_HEAD_MANAGER: "Pending L4 · Head Manager",
  PENDING_L5_GENERAL_MANAGER: "Pending L5 · General Manager",
  PENDING_SUPERVISOR: "Pending · Supervisor",
  PENDING_PM: "Pending · Project Manager",
  PENDING_OM: "Pending · Operations Manager",
  PENDING_FINANCE: "Pending · Finance",
  PENDING_DIRECTOR: "Pending · Director",
  APPROVED: "Awaiting disbursement",
  DISBURSED: "Disbursed · awaiting settlement",
  SETTLED: "Settled",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export const CA_STATUS_TONE: Record<CashAdvanceStatus, string> = {
  DRAFT: "border-white/10 bg-white/5 text-white/70",
  PENDING_L1_SUPERVISOR: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  PENDING_L2_PROJECT_MANAGER: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  PENDING_L2_5_FINANCE: "border-purple-400/30 bg-purple-500/10 text-purple-200",
  PENDING_L3_OPERATIONS_MANAGER: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  PENDING_L4_HEAD_MANAGER: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  PENDING_L5_GENERAL_MANAGER: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  PENDING_SUPERVISOR: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  PENDING_PM: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  PENDING_OM: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  PENDING_FINANCE: "border-purple-400/30 bg-purple-500/10 text-purple-200",
  PENDING_DIRECTOR: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  APPROVED: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  DISBURSED: "border-sky-400/30 bg-sky-500/10 text-sky-300",
  SETTLED: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  REJECTED: "border-rose-400/30 bg-rose-500/10 text-rose-300",
  CANCELLED: "border-white/10 bg-white/5 text-white/50",
};
