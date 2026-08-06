/**
 * ControlDesk — Project Issues SLA escalation logic (Fase 2, rules §26).
 *
 * Pure decision layer that decides — given a snapshot of an issue's state —
 * whether the cron sweeper should escalate it, and to which level. Keeps the
 * DB-facing route thin and lets us unit-test the branching without a
 * database.
 *
 * Ladder (see `ISSUE_ESCALATION_ROLE`):
 *
 *   0 → SUPERVISOR   (default assignee tier)
 *   1 → PM
 *   2 → OM
 *   3 → DIRECTOR     (top; no further climb)
 *
 * Cooldown: after each escalation we stamp `last_escalated_at`. The sweeper
 * only advances further when `now - last_escalated_at ≥ ESCALATION_COOLDOWN_MINUTES`.
 * This means:
 *   - First breach → immediate escalate + emit SLA_BREACHED + ESCALATED
 *     events (single sweep).
 *   - Still breached 15 min later → advance one more level (until 3).
 *   - Once at level 3, sweeper stops making noise (no repeat notifications).
 */

import {
  ISSUE_ESCALATION_ROLE,
  nextIssueEscalationLevel,
  type IssueEscalationLevel,
} from "./state";
import { issueSlaSnapshot } from "./sla";

/** Minimum wall-clock minutes between climbs on the same issue. */
export const ESCALATION_COOLDOWN_MINUTES = 15;

export type IssueEscalationRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  reporter_employee_id: string;
  assignee_employee_id: string | null;
  status: "OPEN" | "IN_PROGRESS" | "REOPENED" | "RESOLVED" | "CLOSED";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  sla_due_at: string;
  escalation_level: number;
  last_escalated_at: string | null;
  title: string;
};

export type EscalationDecision =
  | {
      kind: "SKIP";
      reason:
        | "not-active"
        | "not-breached"
        | "cooldown"
        | "max-level"
        | "invalid-level";
    }
  | {
      kind: "ESCALATE";
      /** Level after climbing (1..3). */
      nextLevel: IssueEscalationLevel;
      /** Canonical role that should receive the ticket next. */
      nextRole: "PM" | "OM" | "DIRECTOR";
      /** Whether this is the first time we've detected the breach. */
      firstBreach: boolean;
    }
  | {
      kind: "BREACH_ONLY";
      /**
       * Emit only SLA_BREACHED — the issue is at max escalation level so we
       * can't climb further. Fires exactly once (subsequent sweeps → SKIP).
       */
      reason: "max-level-first-breach";
    };

const ACTIVE_STATUSES: readonly IssueEscalationRow["status"][] = [
  "OPEN",
  "IN_PROGRESS",
  "REOPENED",
];

/**
 * Decide what to do with a single issue on this sweep.
 *
 * `now` is injectable so tests aren't clock-dependent. Production passes
 * `new Date()` (via the route handler).
 */
export function decideIssueEscalation(input: {
  row: IssueEscalationRow;
  now: Date;
  cooldownMinutes?: number;
}): EscalationDecision {
  const { row } = input;
  const cooldownMs =
    (input.cooldownMinutes ?? ESCALATION_COOLDOWN_MINUTES) * 60_000;

  if (!(ACTIVE_STATUSES as readonly string[]).includes(row.status)) {
    return { kind: "SKIP", reason: "not-active" };
  }

  const snapshot = issueSlaSnapshot(new Date(row.sla_due_at), input.now);
  if (!snapshot.breached) {
    return { kind: "SKIP", reason: "not-breached" };
  }

  const currentLevel = Math.max(0, Math.min(3, Math.floor(row.escalation_level)));
  const lastEscalatedAt = row.last_escalated_at
    ? new Date(row.last_escalated_at)
    : null;
  const firstBreach = lastEscalatedAt === null;

  // Cooldown check — only relevant if we've escalated at least once.
  if (lastEscalatedAt) {
    const sinceMs = input.now.getTime() - lastEscalatedAt.getTime();
    if (sinceMs < cooldownMs) {
      return { kind: "SKIP", reason: "cooldown" };
    }
  }

  const next = nextIssueEscalationLevel(currentLevel);
  if (next === null) {
    // Already at level 3. If we've never stamped an escalation, emit a
    // single SLA_BREACHED note; otherwise silence.
    if (firstBreach) {
      return { kind: "BREACH_ONLY", reason: "max-level-first-breach" };
    }
    return { kind: "SKIP", reason: "max-level" };
  }

  const nextRoleCanonical = ISSUE_ESCALATION_ROLE[next];
  if (
    nextRoleCanonical === "PM" ||
    nextRoleCanonical === "OM" ||
    nextRoleCanonical === "DIRECTOR"
  ) {
    return {
      kind: "ESCALATE",
      nextLevel: next,
      nextRole: nextRoleCanonical,
      firstBreach,
    };
  }
  return { kind: "SKIP", reason: "invalid-level" };
}

/**
 * Aggregate-friendly result reported back by the cron route. Shape kept
 * flat so it JSON-serialises cleanly for the status endpoint payload.
 */
export type SweepOutcome = {
  processed: number;
  escalated: number;
  breachEventsOnly: number;
  skipped: number;
  skippedByReason: Record<
    NonNullable<Extract<EscalationDecision, { kind: "SKIP" }>["reason"]>,
    number
  >;
};

export function newEmptyOutcome(): SweepOutcome {
  return {
    processed: 0,
    escalated: 0,
    breachEventsOnly: 0,
    skipped: 0,
    skippedByReason: {
      "not-active": 0,
      "not-breached": 0,
      "cooldown": 0,
      "max-level": 0,
      "invalid-level": 0,
    },
  };
}
