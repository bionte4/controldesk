/**
 * ControlDesk — Budget Request application logic (Fase 2, rules §9.6).
 *
 * When a budget request reaches APPROVED, an authorised actor triggers
 * `applyBudgetRequestAction` which:
 *   1. Loads the request + line rows (RLS-checked).
 *   2. Computes the deltas per `budget_detail_id`.
 *   3. Applies them atomically to `budget_details.planned_amount` and
 *      the parent `budgets.total_planned_amount`.
 *   4. Marks the request APPLIED and appends an approval log.
 *
 * This module holds the **pure calculator** so it can be unit-tested without
 * a database. The Server Action wraps it and does the DB writes.
 */

import type {
  BudgetRequestKind,
  BudgetRequestLineDirection,
} from "@/types/database";

export type PlannedAmountDelta = {
  budget_detail_id: string;
  delta: bigint;
};

/**
 * Compute planned_amount deltas per detail line for a request. Returns
 * absolute deltas in IDR base units (rupiah, no cents) as `bigint` to keep
 * arithmetic precise. TypeScript-side callers can then round-trip via
 * `moneyToDbString(delta)` for numeric(18,2) storage.
 *
 * INCREASE: single TO line → +delta on target.
 * DECREASE: single FROM line → -delta on source.
 * TRANSFER: two lines (FROM/TO) with the same absolute delta → -delta on
 *           FROM, +delta on TO. Net-zero to the budget total.
 */
export function computePlannedDeltas(input: {
  kind: BudgetRequestKind;
  lines: readonly {
    budget_detail_id: string;
    direction: BudgetRequestLineDirection;
    delta_amount: bigint;
  }[];
}): PlannedAmountDelta[] {
  const { kind, lines } = input;

  if (lines.length === 0) {
    throw new Error("Budget request has no lines to apply.");
  }
  for (const l of lines) {
    if (l.delta_amount <= 0n) {
      throw new Error("Line delta_amount must be positive.");
    }
  }

  if (kind === "INCREASE") {
    if (lines.length !== 1 || lines[0].direction !== "TO") {
      throw new Error("INCREASE request must have exactly one TO line.");
    }
    return [
      {
        budget_detail_id: lines[0].budget_detail_id,
        delta: lines[0].delta_amount,
      },
    ];
  }

  if (kind === "DECREASE") {
    if (lines.length !== 1 || lines[0].direction !== "FROM") {
      throw new Error("DECREASE request must have exactly one FROM line.");
    }
    return [
      {
        budget_detail_id: lines[0].budget_detail_id,
        delta: -lines[0].delta_amount,
      },
    ];
  }

  // TRANSFER — one FROM + one TO, equal absolute deltas.
  if (lines.length !== 2) {
    throw new Error("TRANSFER request must have exactly two lines.");
  }
  const from = lines.find((l) => l.direction === "FROM");
  const to = lines.find((l) => l.direction === "TO");
  if (!from || !to) {
    throw new Error("TRANSFER request must have one FROM and one TO line.");
  }
  if (from.delta_amount !== to.delta_amount) {
    throw new Error(
      `TRANSFER FROM (${from.delta_amount}) and TO (${to.delta_amount}) deltas must match.`,
    );
  }
  if (from.budget_detail_id === to.budget_detail_id) {
    throw new Error("TRANSFER FROM and TO must reference different lines.");
  }
  return [
    { budget_detail_id: from.budget_detail_id, delta: -from.delta_amount },
    { budget_detail_id: to.budget_detail_id, delta: to.delta_amount },
  ];
}

/**
 * Sum of all deltas — INCREASE = +, DECREASE = −, TRANSFER = 0. Used to
 * roll up `budgets.total_planned_amount` after applying line deltas.
 */
export function sumDeltas(deltas: readonly PlannedAmountDelta[]): bigint {
  let total = 0n;
  for (const d of deltas) total += d.delta;
  return total;
}
