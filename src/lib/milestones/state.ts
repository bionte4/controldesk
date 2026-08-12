/**
 * ControlDesk — GAS-aligned milestone helpers (rules §6 GAS align).
 *
 * The state machine is a simple 5-value enum without approval routing, so
 * the "state machine" here is just:
 *   1. Status labels + tones for the UI.
 *   2. Basis-point math helpers (weight_bps ↔ percent) so the app layer can
 *      display and validate without recomputing on every call site.
 *   3. Weight-budget guard — enforce Σ weight_bps ≤ 10_000 per project.
 *
 * The `projects.progress` rollup is done in Postgres via
 * `public.refresh_project_progress()` (migration 0022). This TS file is
 * strictly the UI + guard companion.
 */

import type { MilestoneStatus } from "@/types/database";

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  AT_RISK: "At risk",
  DONE: "Done",
  CANCELLED: "Cancelled",
};

export const MILESTONE_STATUS_TONE: Record<MilestoneStatus, string> = {
  PLANNED: "border-muted-foreground/30 text-muted-foreground",
  IN_PROGRESS: "border-sky-500/40 text-sky-600 dark:text-sky-400",
  AT_RISK: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  DONE: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  CANCELLED: "border-rose-500/40 text-rose-600 dark:text-rose-400",
};

/** Full-weight ceiling (100% = 10_000 basis points). */
export const WEIGHT_BPS_MAX = 10_000;

/**
 * Convert basis points to a human percent (e.g. 2550 → 25.5). Returns
 * `Number` for direct display; the caller is expected to `.toFixed(n)` if
 * they need fixed precision.
 */
export function bpsToPercent(bps: number): number {
  return bps / 100;
}

/**
 * Convert human percent (0-100) to basis points, rounding half-up. Guards
 * against out-of-range inputs by clamping.
 */
export function percentToBps(percent: number): number {
  const clamped = Math.max(0, Math.min(100, percent));
  return Math.round(clamped * 100);
}

/**
 * Sum a list of milestone weights (bps). Used by the app to gate
 * "sudah full 100%?" before locking the plan.
 */
export function sumWeightBps(
  rows: readonly { weight_bps: number }[],
): number {
  return rows.reduce((acc, r) => acc + r.weight_bps, 0);
}

/**
 * Sum of weight_bps where status = DONE, mirroring the Postgres rollup
 * formula in `public.refresh_project_progress()`. Useful for optimistic UI
 * calculations before the trigger has committed.
 */
export function sumDoneWeightBps(
  rows: readonly { weight_bps: number; status: MilestoneStatus }[],
): number {
  return rows
    .filter((r) => r.status === "DONE")
    .reduce((acc, r) => acc + r.weight_bps, 0);
}

/**
 * Guard: is `nextBps` a valid delta for `existingRows` (excluding the row
 * being edited)? Returns the remaining capacity in bps; negative means the
 * proposed weight would over-fill the plan.
 */
export function remainingWeightBps(
  existingRows: readonly { weight_bps: number }[],
  proposedBps: number,
): number {
  const used = sumWeightBps(existingRows);
  return WEIGHT_BPS_MAX - used - proposedBps;
}

/**
 * True if the proposed weight fits within the remaining 100% budget of a
 * project. Callers should surface `remainingWeightBps()` in the error
 * message to help the submitter dial the number down.
 */
export function weightFitsBudget(
  existingRows: readonly { weight_bps: number }[],
  proposedBps: number,
): boolean {
  return remainingWeightBps(existingRows, proposedBps) >= 0;
}

/**
 * Return the list of statuses a milestone may transition to from
 * `current`. Non-normative — GAS treats milestone status as free-form
 * within the enum — but we surface a sensible default for the UI:
 *   PLANNED → IN_PROGRESS | AT_RISK | CANCELLED
 *   IN_PROGRESS → AT_RISK | DONE | CANCELLED
 *   AT_RISK → IN_PROGRESS | DONE | CANCELLED
 *   DONE → (no forward transitions; reopen via update)
 *   CANCELLED → PLANNED (reopen)
 *
 * Callers can bypass this via a raw update if a supervisor needs to
 * correct a mis-typed status.
 */
export function nextAllowedMilestoneStatuses(
  current: MilestoneStatus,
): readonly MilestoneStatus[] {
  switch (current) {
    case "PLANNED":
      return ["IN_PROGRESS", "AT_RISK", "CANCELLED"];
    case "IN_PROGRESS":
      return ["AT_RISK", "DONE", "CANCELLED"];
    case "AT_RISK":
      return ["IN_PROGRESS", "DONE", "CANCELLED"];
    case "DONE":
      return [];
    case "CANCELLED":
      return ["PLANNED"];
  }
}
