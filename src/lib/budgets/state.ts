/**
 * ControlDesk GAS-aligned budget state machine (rules §9.2).
 *
 * Lifecycle: DRAFT → PENDING_FINANCE → [PENDING_DIRECTOR] → APPROVED
 *            (also: → REVISED / CANCELLED / REJECTED-alias-CANCELLED)
 *
 * The `PENDING_DIRECTOR` step only appears when `total_planned_amount ≥
 * APPROVAL_CONFIG.BUDGET.DIRECTOR_THRESHOLD` (rules §9.2). Below the
 * threshold the flow short-circuits to APPROVED directly from FINANCE.
 *
 * Mirror in Postgres has not landed yet — this TS logic is the source of
 * truth for the app layer. A future migration may materialize a
 * `next_budget_status()` function to make it reproducible from SQL scripts.
 */

import {
  APPROVAL_CONFIG,
  budgetApprovalChain,
  canonicalCanApprove,
  type BudgetChainThresholds,
  type CanonicalApprovalSlot,
  type CanonicalRole,
} from "@/lib/rbac/roles";
import type { BudgetStatus } from "@/types/database";

export type BudgetTransition = "SUBMIT" | "APPROVE" | "REJECT" | "CANCEL";

export const PENDING_BUDGET_STATUSES: readonly BudgetStatus[] = [
  "PENDING_FINANCE",
  "PENDING_DIRECTOR",
] as const;

export const TERMINAL_BUDGET_STATUSES: readonly BudgetStatus[] = [
  "APPROVED",
  "CANCELLED",
] as const;

export function isPendingBudget(status: BudgetStatus): boolean {
  return (PENDING_BUDGET_STATUSES as readonly BudgetStatus[]).includes(status);
}

export function isTerminalBudget(status: BudgetStatus): boolean {
  return (TERMINAL_BUDGET_STATUSES as readonly BudgetStatus[]).includes(status);
}

/**
 * The canonical slot expected to act on a given `status`. Returned `null`
 * means the status is terminal or DRAFT — no approver is waiting.
 */
export function budgetSlotForStatus(status: BudgetStatus): CanonicalApprovalSlot | null {
  switch (status) {
    case "PENDING_FINANCE":
      return "FINANCE";
    case "PENDING_DIRECTOR":
      return "DIRECTOR";
    default:
      return null;
  }
}

/**
 * Given `total_planned_amount + current status + transition`, return the
 * next status. Throws on invalid transitions so callers fail loudly during
 * tests and in server actions.
 *
 * `thresholds` — optional per-tenant override loaded via
 * `resolveThresholds(tenantId, "BUDGET")`. Omitted → uses `APPROVAL_CONFIG`
 * defaults (backward compat for legacy call sites + tests).
 */
export function nextBudgetStatus(input: {
  totalPlannedIDR: number;
  current: BudgetStatus;
  action: BudgetTransition;
  thresholds?: BudgetChainThresholds;
}): BudgetStatus {
  const { totalPlannedIDR, current, action, thresholds } = input;

  if (action === "SUBMIT") {
    if (current !== "DRAFT" && current !== "REVISED") {
      throw new Error(
        `SUBMIT only valid from DRAFT / REVISED (current=${current}).`,
      );
    }
    return "PENDING_FINANCE";
  }

  if (action === "CANCEL") {
    if (isTerminalBudget(current) && current !== "APPROVED") {
      // Already CANCELLED — idempotent no-op is fine but we surface it as an
      // error so the caller doesn't accidentally re-run.
      throw new Error("Cannot CANCEL an already-terminal budget.");
    }
    if (current === "APPROVED") {
      throw new Error("Cannot CANCEL an APPROVED budget.");
    }
    return "CANCELLED";
  }

  if (action === "REJECT") {
    if (!isPendingBudget(current)) {
      throw new Error(
        `REJECT only valid from a pending status (current=${current}).`,
      );
    }
    // In this MVP we route REJECT into CANCELLED with a rejection reason
    // stamped in the audit trail. A separate REVISED loop can land later.
    return "CANCELLED";
  }

  // action === "APPROVE"
  if (!isPendingBudget(current)) {
    throw new Error(
      `APPROVE only valid from a pending status (current=${current}).`,
    );
  }

  const chain = budgetApprovalChain(totalPlannedIDR, thresholds);

  if (current === "PENDING_FINANCE") {
    // If director threshold applies, advance to PENDING_DIRECTOR; otherwise
    // finalize.
    return chain.includes("DIRECTOR") ? "PENDING_DIRECTOR" : "APPROVED";
  }

  if (current === "PENDING_DIRECTOR") {
    return "APPROVED";
  }

  throw new Error(`Unreachable transition: ${current} + APPROVE`);
}

/**
 * True if the given canonical role can approve at the current pending
 * status. Compose with `authorizeCanonical()` — this is only the *role vs.
 * slot* check, not the tenant / attribute check.
 */
export function canBudgetAdvance(
  actorRole: CanonicalRole,
  current: BudgetStatus,
): boolean {
  const slot = budgetSlotForStatus(current);
  if (!slot) return false;
  return canonicalCanApprove(actorRole, slot);
}

// ---------------------------------------------------------------------------
// UI helpers — status label + colour tone. Kept alongside the state machine
// so any status added here has to be assigned a label as well.
// ---------------------------------------------------------------------------

export const BUDGET_STATUS_LABEL: Record<BudgetStatus, string> = {
  DRAFT: "Draft",
  PENDING_FINANCE: "Pending Finance",
  PENDING_DIRECTOR: "Pending Director",
  APPROVED: "Approved",
  REVISED: "Revised",
  CANCELLED: "Cancelled",
};

/**
 * Tailwind class-string per status. Uses the workspace design tokens (rules
 * §4) so tone stays consistent with expenses / cash-advances tables.
 */
export const BUDGET_STATUS_TONE: Record<BudgetStatus, string> = {
  DRAFT: "border-muted-foreground/30 text-muted-foreground",
  PENDING_FINANCE: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  PENDING_DIRECTOR: "border-indigo-500/40 text-indigo-600 dark:text-indigo-400",
  APPROVED: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  REVISED: "border-sky-500/40 text-sky-600 dark:text-sky-400",
  CANCELLED: "border-rose-500/40 text-rose-600 dark:text-rose-400",
};

/** Convenience — the director threshold in IDR (rules §9.2). */
export const BUDGET_DIRECTOR_THRESHOLD = APPROVAL_CONFIG.BUDGET.DIRECTOR_THRESHOLD;

// ---------------------------------------------------------------------------
// Inbox helpers — used by the unified approvals page to filter the queue by
// the current viewer's canonical role.
// ---------------------------------------------------------------------------

/**
 * Return the list of PENDING budget statuses this canonical role can act
 * on. ADMIN sees everything (short-circuit); everyone else only sees rows
 * where they're the slot owner.
 */
export function budgetPendingForRole(role: CanonicalRole): BudgetStatus[] {
  if (role === "ADMIN") {
    return [...PENDING_BUDGET_STATUSES];
  }
  const out: BudgetStatus[] = [];
  for (const status of PENDING_BUDGET_STATUSES) {
    const slot = budgetSlotForStatus(status);
    if (slot && canonicalCanApprove(role, slot)) out.push(status);
  }
  return out;
}
