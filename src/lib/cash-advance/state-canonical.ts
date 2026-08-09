/**
 * ControlDesk — Cash Advance canonical state machine (GAS-aligned).
 *
 * This is the forward-looking companion to the legacy `state.ts` module.
 * New cash advances submitted after Fase 1.5 use this state machine and its
 * 3-tier threshold matrix (rules §9.3 / §9.4). Legacy CAs currently in
 * flight continue to run through `state.ts` until they terminate.
 *
 * Chain shape (rules §9):
 *   type=GENERAL:
 *     DRAFT → [PENDING_PM]?
 *                → PENDING_FINANCE
 *                → [PENDING_DIRECTOR]?
 *                → APPROVED → DISBURSED → SETTLED
 *   type=FIELD_OPS:
 *     DRAFT → PENDING_SUPERVISOR
 *                → [PENDING_PM]?
 *                → [PENDING_OM]?
 *                → PENDING_FINANCE
 *                → [PENDING_DIRECTOR]?
 *                → APPROVED → DISBURSED → SETTLED
 *
 * Thresholds are read from `APPROVAL_CONFIG.CASH_ADVANCE_GENERAL` and
 * `APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS` in `src/lib/rbac/roles.ts`. The
 * chain builders (`caGeneralApprovalChain`, `caFieldOpsApprovalChain`) are
 * the single source of truth for which slots participate.
 *
 * Keep this file in sync with any DB-side helper that mirrors the machine.
 */

import {
  APPROVAL_CONFIG,
  caFieldOpsApprovalChain,
  caGeneralApprovalChain,
  canonicalCanApprove,
  toCanonicalRole,
  type AnyDbEmployeeRole,
  type CaFieldOpsChainThresholds,
  type CaGeneralChainThresholds,
  type CanonicalApprovalSlot,
  type CanonicalRole,
} from "@/lib/rbac/roles";

/**
 * Discriminated per-type CA thresholds. Callers know the CA `type` at the
 * point they call `caCanonicalChain()` / `nextCanonicalCaStatus()` so they
 * can pass the matching branch. Wrapping both variants under one type keeps
 * the state-machine entry-point signature tidy.
 */
export type CanonicalCaThresholds =
  | { type: "GENERAL"; thresholds?: CaGeneralChainThresholds }
  | { type: "FIELD_OPS"; thresholds?: CaFieldOpsChainThresholds };
import type {
  ApprovalAction,
  CashAdvanceStatus,
  CashAdvanceType,
} from "@/types/database";

// ---------------------------------------------------------------------------
// Canonical CA statuses — the subset of `cash_advance_status` this machine
// touches. Legacy `PENDING_L*` values are intentionally NOT included here.
// ---------------------------------------------------------------------------

export const CANONICAL_CA_STATUSES = [
  "DRAFT",
  "PENDING_SUPERVISOR",
  "PENDING_PM",
  "PENDING_OM",
  "PENDING_FINANCE",
  "PENDING_DIRECTOR",
  "APPROVED",
  "DISBURSED",
  "SETTLED",
  "REJECTED",
  "CANCELLED",
] as const satisfies readonly CashAdvanceStatus[];

export type CanonicalCaStatus = (typeof CANONICAL_CA_STATUSES)[number];

export const CANONICAL_CA_PENDING_STATUSES: readonly CanonicalCaStatus[] = [
  "PENDING_SUPERVISOR",
  "PENDING_PM",
  "PENDING_OM",
  "PENDING_FINANCE",
  "PENDING_DIRECTOR",
] as const;

export function isCanonicalCaStatus(
  status: CashAdvanceStatus,
): status is CanonicalCaStatus {
  return (CANONICAL_CA_STATUSES as readonly CashAdvanceStatus[]).includes(
    status,
  );
}

export function isCanonicalCaPending(status: CashAdvanceStatus): boolean {
  return (
    CANONICAL_CA_PENDING_STATUSES as readonly CashAdvanceStatus[]
  ).includes(status);
}

export function isCanonicalCaTerminal(status: CashAdvanceStatus): boolean {
  return (
    status === "SETTLED" || status === "REJECTED" || status === "CANCELLED"
  );
}

// ---------------------------------------------------------------------------
// Slot ↔ status mapping. `null` slot means the row is not in an actionable
// review state (draft / terminal / awaiting disbursement or settlement).
// ---------------------------------------------------------------------------

export const CANONICAL_CA_STATUS_SLOT: Record<
  CanonicalCaStatus,
  CanonicalApprovalSlot | null
> = {
  DRAFT: null,
  PENDING_SUPERVISOR: "SUPERVISOR",
  PENDING_PM: "PM",
  PENDING_OM: "OM",
  PENDING_FINANCE: "FINANCE",
  PENDING_DIRECTOR: "DIRECTOR",
  APPROVED: null,
  DISBURSED: null,
  SETTLED: null,
  REJECTED: null,
  CANCELLED: null,
};

export function canonicalCaStatusForSlot(
  slot: CanonicalApprovalSlot,
): CanonicalCaStatus {
  switch (slot) {
    case "SUPERVISOR":
      return "PENDING_SUPERVISOR";
    case "PM":
      return "PENDING_PM";
    case "OM":
      return "PENDING_OM";
    case "FINANCE":
      return "PENDING_FINANCE";
    case "DIRECTOR":
      return "PENDING_DIRECTOR";
  }
}

// ---------------------------------------------------------------------------
// Chain resolution — return the ordered list of slots for a given (type,
// amount). Callers use `firstSlotForType()` to compute the initial status
// on submit and `nextSlotAfter()` to advance after each approval.
// ---------------------------------------------------------------------------

export function caCanonicalChain(input: {
  type: CashAdvanceType;
  amountIDR: number;
  /**
   * Per-tenant override loaded via
   * `resolveThresholds(tenantId, "CASH_ADVANCE_GENERAL" | "CASH_ADVANCE_FIELD_OPS")`.
   * Optional — omit for `APPROVAL_CONFIG` defaults.
   */
  thresholds?: CaGeneralChainThresholds | CaFieldOpsChainThresholds;
}): CanonicalApprovalSlot[] {
  return input.type === "FIELD_OPS"
    ? caFieldOpsApprovalChain(
        input.amountIDR,
        input.thresholds as CaFieldOpsChainThresholds | undefined,
      )
    : caGeneralApprovalChain(
        input.amountIDR,
        input.thresholds as CaGeneralChainThresholds | undefined,
      );
}

export function firstSlotForType(input: {
  type: CashAdvanceType;
  amountIDR: number;
  thresholds?: CaGeneralChainThresholds | CaFieldOpsChainThresholds;
}): CanonicalApprovalSlot {
  const chain = caCanonicalChain(input);
  const first = chain[0];
  if (!first) {
    // The `caGeneralApprovalChain` always includes FINANCE, and FieldOps
    // always starts at SUPERVISOR, so the chain can never be empty. This
    // guard exists so future edits to `roles.ts` don't silently break the
    // state machine.
    throw new Error(
      `Empty approval chain for CA type=${input.type} amount=${input.amountIDR}`,
    );
  }
  return first;
}

function nextSlotAfter(
  chain: readonly CanonicalApprovalSlot[],
  current: CanonicalApprovalSlot,
): CanonicalApprovalSlot | null {
  const idx = chain.indexOf(current);
  if (idx === -1) return null;
  return chain[idx + 1] ?? null;
}

// ---------------------------------------------------------------------------
// State machine — pure. Callers pass the row's current status + ca_type +
// amount + action; we return the next status. Never mutates and never talks
// to the DB.
// ---------------------------------------------------------------------------

export type CanonicalCaTransition = {
  type: CashAdvanceType;
  amountIDR: number;
  current: CanonicalCaStatus;
  action: ApprovalAction;
  /**
   * Optional per-tenant threshold override. Must match the CA `type` —
   * pass `CaGeneralChainThresholds` for GENERAL, `CaFieldOpsChainThresholds`
   * for FIELD_OPS. Omitted → `APPROVAL_CONFIG` defaults (backward compat).
   */
  thresholds?: CaGeneralChainThresholds | CaFieldOpsChainThresholds;
};

export function nextCanonicalCaStatus(
  input: CanonicalCaTransition,
): CanonicalCaStatus {
  const { type, amountIDR, current, action, thresholds } = input;

  if (action === "SUBMIT") {
    if (current !== "DRAFT") {
      throw new Error(`SUBMIT only valid from DRAFT (current=${current}).`);
    }
    return canonicalCaStatusForSlot(
      firstSlotForType({ type, amountIDR, thresholds }),
    );
  }

  if (action === "CANCEL") {
    if (isCanonicalCaTerminal(current)) {
      throw new Error(
        `Cannot CANCEL terminal cash advance (current=${current}).`,
      );
    }
    return "CANCELLED";
  }

  if (action === "REJECT" || action === "FINANCE_REJECT") {
    if (!isCanonicalCaPending(current)) {
      throw new Error(
        `Cannot reject from non-pending status (current=${current}).`,
      );
    }
    return "REJECTED";
  }

  // APPROVE / FINANCE_APPROVE — advance one slot in the chain, or fall
  // through to APPROVED when the chain is exhausted. FINANCE_APPROVE is the
  // canonical action for the Finance slot; other slots use APPROVE. We keep
  // both actions accepted symmetrically so the wrapper needn't discriminate.
  const chain = caCanonicalChain({ type, amountIDR, thresholds });
  const currentSlot = CANONICAL_CA_STATUS_SLOT[current];
  if (!currentSlot) {
    throw new Error(
      `Cannot approve from non-pending status (current=${current}).`,
    );
  }

  const expectedActionAtFinance = action === "FINANCE_APPROVE";
  if (currentSlot === "FINANCE" && !expectedActionAtFinance) {
    throw new Error("Expected FINANCE_APPROVE at the FINANCE slot.");
  }
  if (currentSlot !== "FINANCE" && expectedActionAtFinance) {
    throw new Error(
      `FINANCE_APPROVE only valid at FINANCE slot (current slot=${currentSlot}).`,
    );
  }

  const nextSlot = nextSlotAfter(chain, currentSlot);
  return nextSlot ? canonicalCaStatusForSlot(nextSlot) : "APPROVED";
}

// ---------------------------------------------------------------------------
// Role-side decision — whether a given actor can approve at the current
// canonical status. Uses `canonicalCanApprove()` so higher-rank actors
// (Director acting for PM, etc.) short-circuit correctly.
// ---------------------------------------------------------------------------

export function canonicalCaCanApprove(input: {
  actorRole: AnyDbEmployeeRole | CanonicalRole;
  current: CashAdvanceStatus;
}): boolean {
  if (!isCanonicalCaStatus(input.current)) return false;
  const slot = CANONICAL_CA_STATUS_SLOT[input.current];
  if (!slot) return false;
  const canonical = toCanonicalRole(input.actorRole);
  return canonicalCanApprove(canonical, slot);
}

// ---------------------------------------------------------------------------
// Which pending statuses does a given actor have to work on? Used by the
// Approvals Inbox to build its "for you" filter.
// ---------------------------------------------------------------------------

export function canonicalCaPendingForRole(
  role: AnyDbEmployeeRole | CanonicalRole,
): readonly CanonicalCaStatus[] {
  const canonical = toCanonicalRole(role);
  return CANONICAL_CA_PENDING_STATUSES.filter((s) => {
    const slot = CANONICAL_CA_STATUS_SLOT[s];
    return slot ? canonicalCanApprove(canonical, slot) : false;
  });
}

// ---------------------------------------------------------------------------
// UI helpers — labels + badge tones. Consumers should prefer the
// translation keys in `messages/{id,en}.json` (`cashAdvances.status.*`)
// where possible; the constants below exist for compatibility with the
// legacy state-machine consumers that still read from these Records.
// ---------------------------------------------------------------------------

export const CANONICAL_CA_STATUS_LABEL: Record<CanonicalCaStatus, string> = {
  DRAFT: "Draft",
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

export const CANONICAL_CA_STATUS_TONE: Record<CanonicalCaStatus, string> = {
  DRAFT: "border-white/10 bg-white/5 text-white/70",
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

// ---------------------------------------------------------------------------
// Threshold snapshot — expose the config values a UI hint or the PDP layer
// might want to display alongside a chain preview. Callers should not
// mutate the returned object.
// ---------------------------------------------------------------------------

export function caCanonicalThresholds(type: CashAdvanceType): {
  PM_THRESHOLD: number;
  OM_THRESHOLD?: number;
  DIRECTOR_THRESHOLD: number;
} {
  if (type === "FIELD_OPS") {
    const cfg = APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS;
    return {
      PM_THRESHOLD: cfg.PM_THRESHOLD,
      OM_THRESHOLD: cfg.OM_THRESHOLD,
      DIRECTOR_THRESHOLD: cfg.DIRECTOR_THRESHOLD,
    };
  }
  const cfg = APPROVAL_CONFIG.CASH_ADVANCE_GENERAL;
  return {
    PM_THRESHOLD: cfg.PM_THRESHOLD,
    DIRECTOR_THRESHOLD: cfg.DIRECTOR_THRESHOLD,
  };
}
