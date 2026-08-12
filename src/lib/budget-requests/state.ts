/**
 * ControlDesk — Budget Request state machine (Fase 2, rules §9.6 / §29).
 *
 * Chain shape (from `budgetRequestApprovalChain`):
 *
 *   DRAFT ─► [PENDING_PM]? ─► PENDING_FINANCE ─► [PENDING_DIRECTOR]?
 *                                                 └─► APPROVED ─► APPLIED
 *
 * Thresholds (APPROVAL_CONFIG.BUDGET_REQUEST):
 *   amount ≥ PM_THRESHOLD       → include PENDING_PM
 *   FINANCE                      → always
 *   amount ≥ DIRECTOR_THRESHOLD → include PENDING_DIRECTOR
 *
 * REJECTED and CANCELLED are terminal alternatives reachable from any pending
 * state. APPLIED is the *final* terminal state — reachable only from APPROVED
 * once the app-layer has patched `budget_details`.
 */

import {
  APPROVAL_CONFIG,
  budgetRequestApprovalChain,
  canonicalCanApprove,
  toCanonicalRole,
  type AnyDbEmployeeRole,
  type BudgetRequestChainThresholds,
  type CanonicalApprovalSlot,
  type CanonicalRole,
} from "@/lib/rbac/roles";
import type {
  ApprovalAction,
  BudgetRequestStatus,
} from "@/types/database";

// ---------------------------------------------------------------------------
// Enum constants + type guards.
// ---------------------------------------------------------------------------

export const BR_STATUSES: readonly BudgetRequestStatus[] = [
  "DRAFT",
  "PENDING_PM",
  "PENDING_FINANCE",
  "PENDING_DIRECTOR",
  "APPROVED",
  "APPLIED",
  "REJECTED",
  "CANCELLED",
] as const;

export const BR_PENDING_STATUSES: readonly BudgetRequestStatus[] = [
  "PENDING_PM",
  "PENDING_FINANCE",
  "PENDING_DIRECTOR",
] as const;

export function isBrPending(s: BudgetRequestStatus): boolean {
  return (BR_PENDING_STATUSES as readonly string[]).includes(s);
}

export function isBrTerminal(s: BudgetRequestStatus): boolean {
  return s === "APPLIED" || s === "REJECTED" || s === "CANCELLED";
}

// ---------------------------------------------------------------------------
// Slot ↔ status.
// ---------------------------------------------------------------------------

export const BR_STATUS_SLOT: Record<
  BudgetRequestStatus,
  CanonicalApprovalSlot | null
> = {
  DRAFT: null,
  PENDING_PM: "PM",
  PENDING_FINANCE: "FINANCE",
  PENDING_DIRECTOR: "DIRECTOR",
  APPROVED: null,
  APPLIED: null,
  REJECTED: null,
  CANCELLED: null,
};

export function statusForSlot(slot: CanonicalApprovalSlot): BudgetRequestStatus {
  switch (slot) {
    case "PM":
      return "PENDING_PM";
    case "FINANCE":
      return "PENDING_FINANCE";
    case "DIRECTOR":
      return "PENDING_DIRECTOR";
    case "SUPERVISOR":
    case "OM":
      // Budget-request chain never uses Supervisor / OM slots (§9.6).
      throw new Error(
        `Slot ${slot} is not part of the budget-request approval chain.`,
      );
  }
}

// ---------------------------------------------------------------------------
// Chain resolution.
// ---------------------------------------------------------------------------

export function brApprovalChain(
  amountIDR: number,
  thresholds?: BudgetRequestChainThresholds,
): CanonicalApprovalSlot[] {
  return budgetRequestApprovalChain(amountIDR, thresholds);
}

export function brFirstSlot(
  amountIDR: number,
  thresholds?: BudgetRequestChainThresholds,
): CanonicalApprovalSlot {
  const chain = brApprovalChain(amountIDR, thresholds);
  const first = chain[0];
  if (!first) {
    // `budgetRequestApprovalChain` always includes FINANCE so this is
    // defensive against future edits.
    throw new Error(
      `Empty budget-request approval chain (amount=${amountIDR}).`,
    );
  }
  return first;
}

export function brFirstStatus(
  amountIDR: number,
  thresholds?: BudgetRequestChainThresholds,
): BudgetRequestStatus {
  return statusForSlot(brFirstSlot(amountIDR, thresholds));
}

// ---------------------------------------------------------------------------
// State machine — pure. Given the current status + amount + action, return
// the next status. Never mutates and never talks to the DB.
// ---------------------------------------------------------------------------

export type BrTransition = {
  amountIDR: number;
  current: BudgetRequestStatus;
  action: ApprovalAction;
  /** Per-tenant override; optional. */
  thresholds?: BudgetRequestChainThresholds;
};

export function nextBrStatus(input: BrTransition): BudgetRequestStatus {
  const { amountIDR, current, action, thresholds } = input;

  if (action === "SUBMIT") {
    if (current !== "DRAFT") {
      throw new Error(`SUBMIT only valid from DRAFT (current=${current}).`);
    }
    return brFirstStatus(amountIDR, thresholds);
  }

  if (action === "CANCEL") {
    if (isBrTerminal(current)) {
      throw new Error(
        `Cannot CANCEL terminal budget request (current=${current}).`,
      );
    }
    return "CANCELLED";
  }

  if (action === "REJECT" || action === "FINANCE_REJECT") {
    if (!isBrPending(current)) {
      throw new Error(
        `Cannot reject from non-pending status (current=${current}).`,
      );
    }
    return "REJECTED";
  }

  // APPROVE / FINANCE_APPROVE — advance one slot.
  const chain = brApprovalChain(amountIDR, thresholds);
  const currentSlot = BR_STATUS_SLOT[current];
  if (!currentSlot) {
    throw new Error(
      `Cannot approve from non-pending status (current=${current}).`,
    );
  }
  const expectedFinance = action === "FINANCE_APPROVE";
  if (currentSlot === "FINANCE" && !expectedFinance) {
    throw new Error("Expected FINANCE_APPROVE at the FINANCE slot.");
  }
  if (currentSlot !== "FINANCE" && expectedFinance) {
    throw new Error(
      `FINANCE_APPROVE only valid at FINANCE slot (current slot=${currentSlot}).`,
    );
  }

  const idx = chain.indexOf(currentSlot);
  const nextSlot = idx === -1 ? null : (chain[idx + 1] ?? null);
  return nextSlot ? statusForSlot(nextSlot) : "APPROVED";
}

// ---------------------------------------------------------------------------
// Approver-side gate — whether a given actor can approve at the current
// status.
// ---------------------------------------------------------------------------

export function brCanApprove(input: {
  actorRole: AnyDbEmployeeRole | CanonicalRole;
  current: BudgetRequestStatus;
}): boolean {
  const slot = BR_STATUS_SLOT[input.current];
  if (!slot) return false;
  const canonical = toCanonicalRole(input.actorRole);
  return canonicalCanApprove(canonical, slot);
}

/**
 * The role responsible for the current pending slot. Used by
 * `notifyRoles()` and by the inbox filter to derive which employees to
 * ping when a new budget request lands.
 */
export function brApproverSlot(
  s: BudgetRequestStatus,
): CanonicalApprovalSlot | null {
  return BR_STATUS_SLOT[s];
}

// ---------------------------------------------------------------------------
// Inbox helper — statuses a given actor should see in the unified approvals
// inbox. Includes APPROVED so PM+ / FINANCE can trigger APPLY.
// ---------------------------------------------------------------------------

/**
 * Budget-request statuses that need action from the given role. A row is
 * included when:
 *   - Its pending slot matches (via `canonicalCanApprove`), OR
 *   - Status is APPROVED and the actor is PM/FINANCE/OM/DIRECTOR/ADMIN
 *     (they trigger the APPLY step).
 */
export function brPendingForRole(
  role: CanonicalRole,
): BudgetRequestStatus[] {
  if (role === "ADMIN") {
    return [...BR_PENDING_STATUSES, "APPROVED"];
  }
  const out: BudgetRequestStatus[] = [];
  for (const s of BR_PENDING_STATUSES) {
    const slot = BR_STATUS_SLOT[s];
    if (slot && canonicalCanApprove(role, slot)) out.push(s);
  }
  const canApply =
    role === "PM" ||
    role === "OM" ||
    role === "DIRECTOR" ||
    role === "FINANCE";
  if (canApply) out.push("APPROVED");
  return out;
}

// ---------------------------------------------------------------------------
// Convenience re-exports for callers that want the raw thresholds without
// re-importing APPROVAL_CONFIG themselves.
// ---------------------------------------------------------------------------

export const BR_THRESHOLDS = APPROVAL_CONFIG.BUDGET_REQUEST;
