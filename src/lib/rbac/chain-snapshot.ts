import "server-only";

/**
 * ControlDesk — Approval chain snapshot builder (Option B, rules §9 / §22).
 *
 * At submit-time every approval-track item (Expense / Cash Advance /
 * Budget / Budget Request) freezes the resolved chain into
 * `<table>.chain_snapshot jsonb` so subsequent admin edits to
 * `approval_thresholds` cannot retroactively re-route in-flight items.
 *
 * This module is the SINGLE PLACE that serialises the snapshot payload —
 * every Server Action calls one of these helpers instead of assembling
 * JSON by hand. That way the schema (`{ slots, thresholds, snapshot_at,
 * kind }`) stays in one source of truth, and future schema changes are
 * one edit away from every persist site.
 */

import {
  budgetApprovalChain,
  budgetRequestApprovalChain,
  caFieldOpsApprovalChain,
  caGeneralApprovalChain,
  expenseApprovalChain,
  type BudgetChainThresholds,
  type BudgetRequestChainThresholds,
  type CaFieldOpsChainThresholds,
  type CaGeneralChainThresholds,
  type CanonicalApprovalSlot,
  type ExpenseChainThresholds,
} from "@/lib/rbac/roles";

/**
 * Union of every "kind" that has an approval chain. Mirrors the
 * `ThresholdKind` union in `thresholds.ts` but excludes `PETTY_CASH` —
 * that flow has no ordered chain to snapshot (the decision is a
 * scalar: auto-approve / finance-approval / above-ceiling).
 */
export type ChainSnapshotKind =
  | "EXPENSE"
  | "BUDGET"
  | "CASH_ADVANCE_GENERAL"
  | "CASH_ADVANCE_FIELD_OPS"
  | "BUDGET_REQUEST";

/**
 * Discriminated snapshot payload — kind-tagged so callers reading the
 * `chain_snapshot` column can narrow on `.kind` without ambiguity. All
 * variants share `slots`, `snapshot_at`, and `amount_idr`, plus the
 * kind-specific `thresholds` shape.
 */
// Slots are typed as a mutable array (not `readonly`) so the payload is
// directly assignable to Supabase's `Json` column type (which requires
// mutable arrays). The chain builders already return `CanonicalApprovalSlot[]`
// so no `[...slots]` copy is needed at the call site.
export type ChainSnapshot =
  | {
      kind: "EXPENSE";
      slots: CanonicalApprovalSlot[];
      thresholds: ExpenseChainThresholds;
      amount_idr: number;
      snapshot_at: string;
    }
  | {
      kind: "BUDGET";
      slots: CanonicalApprovalSlot[];
      thresholds: BudgetChainThresholds;
      amount_idr: number;
      snapshot_at: string;
    }
  | {
      kind: "CASH_ADVANCE_GENERAL";
      slots: CanonicalApprovalSlot[];
      thresholds: CaGeneralChainThresholds;
      amount_idr: number;
      snapshot_at: string;
    }
  | {
      kind: "CASH_ADVANCE_FIELD_OPS";
      slots: CanonicalApprovalSlot[];
      thresholds: CaFieldOpsChainThresholds;
      amount_idr: number;
      snapshot_at: string;
    }
  | {
      kind: "BUDGET_REQUEST";
      slots: CanonicalApprovalSlot[];
      thresholds: BudgetRequestChainThresholds;
      amount_idr: number;
      snapshot_at: string;
    };

const nowIso = (): string => new Date().toISOString();

/**
 * Snapshot the Expense chain. `thresholds` should be the resolved
 * per-tenant override (or `undefined` if the caller couldn't resolve one,
 * in which case we snapshot the `APPROVAL_CONFIG` defaults for a stable
 * audit trail — DO NOT persist `undefined`).
 */
export function snapshotExpenseChain(input: {
  amountIDR: number;
  thresholds: ExpenseChainThresholds;
}): ChainSnapshot & { kind: "EXPENSE" } {
  return {
    kind: "EXPENSE",
    amount_idr: input.amountIDR,
    thresholds: {
      PM_THRESHOLD: input.thresholds.PM_THRESHOLD,
      DIRECTOR_THRESHOLD: input.thresholds.DIRECTOR_THRESHOLD,
    },
    slots: expenseApprovalChain(input.amountIDR, input.thresholds),
    snapshot_at: nowIso(),
  };
}

export function snapshotBudgetChain(input: {
  totalPlannedIDR: number;
  thresholds: BudgetChainThresholds;
}): ChainSnapshot & { kind: "BUDGET" } {
  return {
    kind: "BUDGET",
    amount_idr: input.totalPlannedIDR,
    thresholds: {
      DIRECTOR_THRESHOLD: input.thresholds.DIRECTOR_THRESHOLD,
    },
    slots: budgetApprovalChain(input.totalPlannedIDR, input.thresholds),
    snapshot_at: nowIso(),
  };
}

export function snapshotCaGeneralChain(input: {
  amountIDR: number;
  thresholds: CaGeneralChainThresholds;
}): ChainSnapshot & { kind: "CASH_ADVANCE_GENERAL" } {
  return {
    kind: "CASH_ADVANCE_GENERAL",
    amount_idr: input.amountIDR,
    thresholds: {
      PM_THRESHOLD: input.thresholds.PM_THRESHOLD,
      DIRECTOR_THRESHOLD: input.thresholds.DIRECTOR_THRESHOLD,
    },
    slots: caGeneralApprovalChain(input.amountIDR, input.thresholds),
    snapshot_at: nowIso(),
  };
}

export function snapshotCaFieldOpsChain(input: {
  amountIDR: number;
  thresholds: CaFieldOpsChainThresholds;
}): ChainSnapshot & { kind: "CASH_ADVANCE_FIELD_OPS" } {
  return {
    kind: "CASH_ADVANCE_FIELD_OPS",
    amount_idr: input.amountIDR,
    thresholds: {
      PM_THRESHOLD: input.thresholds.PM_THRESHOLD,
      OM_THRESHOLD: input.thresholds.OM_THRESHOLD,
      DIRECTOR_THRESHOLD: input.thresholds.DIRECTOR_THRESHOLD,
    },
    slots: caFieldOpsApprovalChain(input.amountIDR, input.thresholds),
    snapshot_at: nowIso(),
  };
}

export function snapshotBudgetRequestChain(input: {
  amountIDR: number;
  thresholds: BudgetRequestChainThresholds;
}): ChainSnapshot & { kind: "BUDGET_REQUEST" } {
  return {
    kind: "BUDGET_REQUEST",
    amount_idr: input.amountIDR,
    thresholds: {
      PM_THRESHOLD: input.thresholds.PM_THRESHOLD,
      DIRECTOR_THRESHOLD: input.thresholds.DIRECTOR_THRESHOLD,
    },
    slots: budgetRequestApprovalChain(input.amountIDR, input.thresholds),
    snapshot_at: nowIso(),
  };
}

/**
 * Type-guard for row consumers reading `chain_snapshot` off a DB row.
 * The generated types type this column as `Json | null` — this narrows
 * to the discriminated union so consumers can access `.slots`, etc.
 * without a runtime cast at every read site.
 */
export function isChainSnapshot(value: unknown): value is ChainSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ChainSnapshot>;
  return (
    typeof v.kind === "string" &&
    Array.isArray(v.slots) &&
    typeof v.snapshot_at === "string" &&
    typeof v.amount_idr === "number"
  );
}

/**
 * Extract the thresholds from a row's `chain_snapshot`, validated against
 * an expected `kind`. Returns `null` when the snapshot is missing (legacy
 * pre-B row) or belongs to a different kind (data corruption / cross-table
 * mistake). Callers fall back to `resolveThresholds()` in that case.
 *
 * The narrow return type per-kind means chain builders and state machines
 * get the exact structural shape they expect without further casting.
 */
export function thresholdsFromSnapshot(
  snapshot: unknown,
  expectedKind: "EXPENSE",
): ExpenseChainThresholds | null;
export function thresholdsFromSnapshot(
  snapshot: unknown,
  expectedKind: "BUDGET",
): BudgetChainThresholds | null;
export function thresholdsFromSnapshot(
  snapshot: unknown,
  expectedKind: "CASH_ADVANCE_GENERAL",
): CaGeneralChainThresholds | null;
export function thresholdsFromSnapshot(
  snapshot: unknown,
  expectedKind: "CASH_ADVANCE_FIELD_OPS",
): CaFieldOpsChainThresholds | null;
export function thresholdsFromSnapshot(
  snapshot: unknown,
  expectedKind: "BUDGET_REQUEST",
): BudgetRequestChainThresholds | null;
export function thresholdsFromSnapshot(
  snapshot: unknown,
  expectedKind: ChainSnapshotKind,
):
  | ExpenseChainThresholds
  | BudgetChainThresholds
  | CaGeneralChainThresholds
  | CaFieldOpsChainThresholds
  | BudgetRequestChainThresholds
  | null {
  if (!isChainSnapshot(snapshot)) return null;
  if (snapshot.kind !== expectedKind) return null;
  return snapshot.thresholds;
}
