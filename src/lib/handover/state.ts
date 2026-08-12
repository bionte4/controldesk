/**
 * ControlDesk PM Handover state machine (rules §13).
 *
 * Chain:
 *   DRAFT
 *     → SUBMIT       → PENDING_OM
 *     → APPROVE (OM) → PENDING_HM
 *     → APPROVE (HM) → APPROVED
 *     → EXECUTE      → EXECUTED     (finalise_pm_handover SQL fn)
 *   Any pending state can go to REJECTED (REJECT) or CANCELLED (CANCEL).
 */

import type { EmployeeRole } from "@/lib/rbac/roles";
import type { ApprovalAction, PmHandoverStatus } from "@/types/database";

export const PMH_STATUS_APPROVER_ROLE: Record<
  PmHandoverStatus,
  EmployeeRole | null
> = {
  DRAFT: null,
  PENDING_OM: "OPERATIONS_MANAGER",
  PENDING_HM: "HEAD_MANAGER",
  APPROVED: null, // waits for EXECUTE action
  EXECUTED: null,
  REJECTED: null,
  CANCELLED: null,
};

export const PMH_PENDING_STATUSES: readonly PmHandoverStatus[] = [
  "PENDING_OM",
  "PENDING_HM",
] as const;

export function isPmhPending(status: PmHandoverStatus): boolean {
  return (PMH_PENDING_STATUSES as readonly PmHandoverStatus[]).includes(status);
}

export function isPmhTerminal(status: PmHandoverStatus): boolean {
  return (
    status === "EXECUTED" || status === "REJECTED" || status === "CANCELLED"
  );
}

export type PmhAction = Extract<
  ApprovalAction,
  "SUBMIT" | "APPROVE" | "REJECT" | "CANCEL"
>;

export function nextPmHandoverStatus(input: {
  current: PmHandoverStatus;
  action: PmhAction;
}): PmHandoverStatus {
  const { current, action } = input;

  if (action === "SUBMIT") {
    if (current !== "DRAFT") {
      throw new Error(`SUBMIT only valid from DRAFT (current=${current}).`);
    }
    return "PENDING_OM";
  }

  if (action === "CANCEL") {
    if (isPmhTerminal(current)) {
      throw new Error(`Cannot CANCEL terminal handover (current=${current}).`);
    }
    return "CANCELLED";
  }

  if (action === "REJECT") {
    if (!isPmhPending(current)) {
      throw new Error(
        `Cannot reject from non-pending status (current=${current}).`,
      );
    }
    return "REJECTED";
  }

  switch (current) {
    case "PENDING_OM":
      return "PENDING_HM";
    case "PENDING_HM":
      return "APPROVED";
    default:
      throw new Error(
        `Cannot approve from status ${current} — expected PENDING_OM or PENDING_HM.`,
      );
  }
}

export function expectedPmhApproverRole(
  status: PmHandoverStatus,
): EmployeeRole | null {
  return PMH_STATUS_APPROVER_ROLE[status];
}

export function canApproveNextPmh(
  role: EmployeeRole,
  status: PmHandoverStatus,
): boolean {
  if (!isPmhPending(status)) return false;
  if (role === "TENANT_ADMIN") return true;
  return expectedPmhApproverRole(status) === role;
}

export const PMH_STATUS_LABEL: Record<PmHandoverStatus, string> = {
  DRAFT: "Draft",
  PENDING_OM: "Pending · Operations Manager",
  PENDING_HM: "Pending · Head Manager",
  APPROVED: "Approved · awaiting execution",
  EXECUTED: "Executed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export const PMH_STATUS_TONE: Record<PmHandoverStatus, string> = {
  DRAFT: "border-white/10 bg-white/5 text-white/70",
  PENDING_OM: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  PENDING_HM: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  APPROVED: "border-sky-400/30 bg-sky-500/10 text-sky-300",
  EXECUTED: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  REJECTED: "border-rose-400/30 bg-rose-500/10 text-rose-300",
  CANCELLED: "border-white/10 bg-white/5 text-white/50",
};
