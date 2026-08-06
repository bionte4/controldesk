/**
 * ControlDesk — Project Issues state machine (Fase 2, rules §26).
 *
 * Simple ticket lifecycle:
 *
 *   OPEN ───► IN_PROGRESS ───► RESOLVED ───► CLOSED
 *     ▲            │              │             │
 *     │            └────► REOPENED│             │
 *     └───────────────────────────┴────REOPENED─┘
 *
 * REOPENED behaves like OPEN for SLA + assignment purposes (server-side we
 * recompute `sla_due_at` from `now` on reopen). CLOSED is terminal.
 *
 * Assignment ladder — climbed by the SLA sweeper (planned) when an issue
 * remains OPEN/IN_PROGRESS/REOPENED past `sla_due_at`:
 *   level 0 → Supervisor (default assignee tier)
 *   level 1 → PM
 *   level 2 → OM
 *   level 3 → Director   (top of the ladder)
 */

import type {
  ProjectIssueSeverity,
  ProjectIssueStatus,
} from "@/types/database";

// ---------------------------------------------------------------------------
// Terminals & pending-like sets.
// ---------------------------------------------------------------------------

export const ISSUE_STATUSES: readonly ProjectIssueStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
] as const;

/** Statuses that still count against SLA and can be triaged/assigned. */
export const ISSUE_ACTIVE_STATUSES: readonly ProjectIssueStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "REOPENED",
] as const;

export function isActiveIssueStatus(s: ProjectIssueStatus): boolean {
  return (ISSUE_ACTIVE_STATUSES as readonly string[]).includes(s);
}

export function isTerminalIssueStatus(s: ProjectIssueStatus): boolean {
  return s === "CLOSED";
}

// ---------------------------------------------------------------------------
// Transitions.
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Readonly<
  Record<ProjectIssueStatus, readonly ProjectIssueStatus[]>
> = {
  OPEN: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["RESOLVED", "OPEN", "CLOSED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  CLOSED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
};

export function canTransitionIssue(
  from: ProjectIssueStatus,
  to: ProjectIssueStatus,
): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function allowedNextIssueStatuses(
  from: ProjectIssueStatus,
): readonly ProjectIssueStatus[] {
  return ALLOWED_TRANSITIONS[from] ?? [];
}

// ---------------------------------------------------------------------------
// Severity metadata — SLA hours + ordering for KPI weighting.
// ---------------------------------------------------------------------------

export const ISSUE_SEVERITIES: readonly ProjectIssueSeverity[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
] as const;

/**
 * Business-hours SLA target per severity (rules §26).
 * These are BUSINESS hours — the pure `hoursToDueDate(...)` calculator in
 * `sla.ts` maps them to wall-clock hours by expanding across the working
 * calendar (default 09:00–17:00 Mon–Fri).
 */
export const ISSUE_SLA_HOURS_BUSINESS: Readonly<
  Record<ProjectIssueSeverity, number>
> = {
  CRITICAL: 1,
  HIGH: 4,
  MEDIUM: 8,
  LOW: 24,
};

/** Higher number = more urgent. Useful for ORDER BY / KPI weighting. */
export const ISSUE_SEVERITY_RANK: Readonly<
  Record<ProjectIssueSeverity, number>
> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

// ---------------------------------------------------------------------------
// Escalation ladder — climbed by the SLA sweeper on breach.
// ---------------------------------------------------------------------------

export const ISSUE_ESCALATION_LEVELS = [0, 1, 2, 3] as const;
export type IssueEscalationLevel = (typeof ISSUE_ESCALATION_LEVELS)[number];

/** Canonical role responsible for each escalation level. */
export const ISSUE_ESCALATION_ROLE: Readonly<
  Record<IssueEscalationLevel, "SUPERVISOR" | "PM" | "OM" | "DIRECTOR">
> = {
  0: "SUPERVISOR",
  1: "PM",
  2: "OM",
  3: "DIRECTOR",
};

export function nextIssueEscalationLevel(
  current: number,
): IssueEscalationLevel | null {
  const clamped = Math.max(0, Math.min(3, Math.floor(current)));
  if (clamped >= 3) return null;
  return (clamped + 1) as IssueEscalationLevel;
}
