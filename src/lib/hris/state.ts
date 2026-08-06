/**
 * ControlDesk HRIS request state machine (rules §12).
 *
 * Canonical TypeScript implementation. Mirrored in Postgres via
 * `public.next_hr_request_status(hr_request_kind, hr_request_status)` from
 * `supabase/migrations/0010_hris_requests.sql`. Keep both in sync.
 *
 * Chains:
 *   LEAVE / OVERTIME:  DRAFT → L1 Supervisor → L2 PM → L3 OM → HR Admin → APPROVED
 *   SICK:              DRAFT → L1 Supervisor → HR Admin → APPROVED
 */

import type { EmployeeRole } from "@/lib/rbac/roles";
import type {
  ApprovalAction,
  HrRequestKind,
  HrRequestStatus,
} from "@/types/database";

/**
 * Operational role expected to approve each state. Terminal states have null.
 */
export const HR_STATUS_APPROVER_ROLE: Record<
  HrRequestStatus,
  EmployeeRole | null
> = {
  DRAFT: null,
  PENDING_L1_SUPERVISOR: "SUPERVISOR",
  PENDING_L2_PROJECT_MANAGER: "PROJECT_MANAGER",
  PENDING_L3_OPERATIONS_MANAGER: "OPERATIONS_MANAGER",
  PENDING_HR_ADMIN: "HR_ADMIN",
  APPROVED: null,
  REJECTED: null,
  CANCELLED: null,
};

export const HR_PENDING_STATUSES: readonly HrRequestStatus[] = [
  "PENDING_L1_SUPERVISOR",
  "PENDING_L2_PROJECT_MANAGER",
  "PENDING_L3_OPERATIONS_MANAGER",
  "PENDING_HR_ADMIN",
] as const;

export function isHrPending(status: HrRequestStatus): boolean {
  return (HR_PENDING_STATUSES as readonly HrRequestStatus[]).includes(status);
}

export function isHrTerminal(status: HrRequestStatus): boolean {
  return status === "APPROVED" || status === "REJECTED" || status === "CANCELLED";
}

/**
 * Given a kind + current status + action, return the resulting status.
 * Throws on invalid transitions.
 */
export function nextHrRequestStatus(input: {
  kind: HrRequestKind;
  current: HrRequestStatus;
  action: ApprovalAction;
}): HrRequestStatus {
  const { kind, current, action } = input;

  if (action === "SUBMIT") {
    if (current !== "DRAFT") {
      throw new Error(`SUBMIT only valid from DRAFT (current=${current}).`);
    }
    return "PENDING_L1_SUPERVISOR";
  }

  if (action === "CANCEL") {
    if (isHrTerminal(current)) {
      throw new Error(`Cannot CANCEL a terminal request (current=${current}).`);
    }
    return "CANCELLED";
  }

  if (action === "REJECT" || action === "FINANCE_REJECT") {
    if (!isHrPending(current)) {
      throw new Error(
        `Cannot reject from non-pending status (current=${current}).`,
      );
    }
    return "REJECTED";
  }

  // APPROVE
  switch (current) {
    case "PENDING_L1_SUPERVISOR":
      if (action !== "APPROVE") throw new Error("Expected APPROVE at L1.");
      return kind === "SICK"
        ? "PENDING_HR_ADMIN"
        : "PENDING_L2_PROJECT_MANAGER";
    case "PENDING_L2_PROJECT_MANAGER":
      if (action !== "APPROVE") throw new Error("Expected APPROVE at L2.");
      return "PENDING_L3_OPERATIONS_MANAGER";
    case "PENDING_L3_OPERATIONS_MANAGER":
      if (action !== "APPROVE") throw new Error("Expected APPROVE at L3.");
      return "PENDING_HR_ADMIN";
    case "PENDING_HR_ADMIN":
      if (action !== "APPROVE") throw new Error("Expected APPROVE at HR final.");
      return "APPROVED";
    default:
      throw new Error(
        `Cannot approve from non-pending status (current=${current}).`,
      );
  }
}

export function expectedHrApproverRole(
  status: HrRequestStatus,
): EmployeeRole | null {
  return HR_STATUS_APPROVER_ROLE[status];
}

export function canApproveNextHr(
  role: EmployeeRole,
  status: HrRequestStatus,
): boolean {
  if (!isHrPending(status)) return false;
  if (role === "TENANT_ADMIN") return true;
  return expectedHrApproverRole(status) === role;
}

/** Human-friendly label for a status. */
export const HR_STATUS_LABEL: Record<HrRequestStatus, string> = {
  DRAFT: "Draft",
  PENDING_L1_SUPERVISOR: "Pending L1 · Supervisor",
  PENDING_L2_PROJECT_MANAGER: "Pending L2 · Project Manager",
  PENDING_L3_OPERATIONS_MANAGER: "Pending L3 · Operations Manager",
  PENDING_HR_ADMIN: "Pending · HR Admin",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

/** Tone hint for badges (Tailwind classes). */
export const HR_STATUS_TONE: Record<HrRequestStatus, string> = {
  DRAFT: "border-white/10 bg-white/5 text-white/70",
  PENDING_L1_SUPERVISOR: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  PENDING_L2_PROJECT_MANAGER: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  PENDING_L3_OPERATIONS_MANAGER:
    "border-amber-400/30 bg-amber-500/10 text-amber-300",
  PENDING_HR_ADMIN: "border-sky-400/30 bg-sky-500/10 text-sky-300",
  APPROVED: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  REJECTED: "border-rose-400/30 bg-rose-500/10 text-rose-300",
  CANCELLED: "border-white/10 bg-white/5 text-white/50",
};

export const HR_KIND_LABEL: Record<HrRequestKind, string> = {
  LEAVE: "Leave",
  OVERTIME: "Overtime",
  SICK: "Sick",
};

/**
 * Ordered list of `PENDING_*` statuses forming the approval chain for a
 * given `kind` — used by the HR request detail page to visualise progress
 * with the shared `ApprovalChainProgress` component. Mirrors §12.
 *   LEAVE / OVERTIME → L1 → L2 → L3 → HR
 *   SICK             → L1 → HR
 */
export function hrChainForKind(
  kind: HrRequestKind,
): readonly HrRequestStatus[] {
  if (kind === "SICK") {
    return ["PENDING_L1_SUPERVISOR", "PENDING_HR_ADMIN"] as const;
  }
  return [
    "PENDING_L1_SUPERVISOR",
    "PENDING_L2_PROJECT_MANAGER",
    "PENDING_L3_OPERATIONS_MANAGER",
    "PENDING_HR_ADMIN",
  ] as const;
}

/**
 * Compact 2–4 character label for each slot in the HR approval chain
 * (matches the style used by other modules in `ApprovalChainProgress`).
 */
export const HR_CHAIN_SLOT_LABEL: Record<HrRequestStatus, string> = {
  DRAFT: "Draft",
  PENDING_L1_SUPERVISOR: "L1",
  PENDING_L2_PROJECT_MANAGER: "L2 PM",
  PENDING_L3_OPERATIONS_MANAGER: "L3 OM",
  PENDING_HR_ADMIN: "HR",
  APPROVED: "Done",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};
