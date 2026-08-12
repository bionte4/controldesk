import { describe, expect, it } from "vitest";

import {
  ESCALATION_COOLDOWN_MINUTES,
  decideIssueEscalation,
  newEmptyOutcome,
  type IssueEscalationRow,
} from "./escalation";

const NOW = new Date("2026-08-06T10:00:00Z");

function row(overrides: Partial<IssueEscalationRow>): IssueEscalationRow {
  return {
    id: "issue-1",
    tenant_id: "tenant-1",
    project_id: "proj-1",
    reporter_employee_id: "emp-r",
    assignee_employee_id: "emp-sup",
    status: "OPEN",
    severity: "MEDIUM",
    // sla_due_at 5h ago → breached by default in most tests
    sla_due_at: new Date(NOW.getTime() - 5 * 60 * 60_000).toISOString(),
    escalation_level: 0,
    last_escalated_at: null,
    title: "Something is on fire",
    ...overrides,
  };
}

describe("decideIssueEscalation — skip conditions", () => {
  it("skips terminal statuses", () => {
    for (const status of ["RESOLVED", "CLOSED"] as const) {
      const decision = decideIssueEscalation({ row: row({ status }), now: NOW });
      expect(decision).toEqual({ kind: "SKIP", reason: "not-active" });
    }
  });

  it("skips issues still within their SLA window", () => {
    const decision = decideIssueEscalation({
      row: row({
        sla_due_at: new Date(NOW.getTime() + 60 * 60_000).toISOString(),
      }),
      now: NOW,
    });
    expect(decision).toEqual({ kind: "SKIP", reason: "not-breached" });
  });

  it("skips inside cooldown window", () => {
    const decision = decideIssueEscalation({
      row: row({
        escalation_level: 1,
        last_escalated_at: new Date(
          NOW.getTime() - 5 * 60_000, // 5 min ago — under 15-min cooldown
        ).toISOString(),
      }),
      now: NOW,
    });
    expect(decision).toEqual({ kind: "SKIP", reason: "cooldown" });
  });
});

describe("decideIssueEscalation — first breach", () => {
  it("escalates from level 0 → 1 (PM), flag firstBreach=true", () => {
    const decision = decideIssueEscalation({ row: row({}), now: NOW });
    expect(decision).toEqual({
      kind: "ESCALATE",
      nextLevel: 1,
      nextRole: "PM",
      firstBreach: true,
    });
  });
});

describe("decideIssueEscalation — ladder progression", () => {
  it("level 1 → 2 (OM) once cooldown has elapsed", () => {
    const decision = decideIssueEscalation({
      row: row({
        escalation_level: 1,
        last_escalated_at: new Date(
          NOW.getTime() - (ESCALATION_COOLDOWN_MINUTES + 1) * 60_000,
        ).toISOString(),
      }),
      now: NOW,
    });
    expect(decision).toEqual({
      kind: "ESCALATE",
      nextLevel: 2,
      nextRole: "OM",
      firstBreach: false,
    });
  });

  it("level 2 → 3 (DIRECTOR)", () => {
    const decision = decideIssueEscalation({
      row: row({
        escalation_level: 2,
        last_escalated_at: new Date(
          NOW.getTime() - 20 * 60_000,
        ).toISOString(),
      }),
      now: NOW,
    });
    expect(decision).toEqual({
      kind: "ESCALATE",
      nextLevel: 3,
      nextRole: "DIRECTOR",
      firstBreach: false,
    });
  });
});

describe("decideIssueEscalation — max-level guard", () => {
  it("first breach at level 3 emits BREACH_ONLY once", () => {
    const decision = decideIssueEscalation({
      row: row({ escalation_level: 3, last_escalated_at: null }),
      now: NOW,
    });
    expect(decision).toEqual({
      kind: "BREACH_ONLY",
      reason: "max-level-first-breach",
    });
  });

  it("level 3 after cooldown → SKIP (no notification spam)", () => {
    const decision = decideIssueEscalation({
      row: row({
        escalation_level: 3,
        last_escalated_at: new Date(
          NOW.getTime() - 60 * 60_000,
        ).toISOString(),
      }),
      now: NOW,
    });
    expect(decision).toEqual({ kind: "SKIP", reason: "max-level" });
  });
});

describe("decideIssueEscalation — cooldown boundary", () => {
  it("exactly at cooldown boundary escalates (>= cooldown)", () => {
    const decision = decideIssueEscalation({
      row: row({
        escalation_level: 1,
        last_escalated_at: new Date(
          NOW.getTime() - ESCALATION_COOLDOWN_MINUTES * 60_000,
        ).toISOString(),
      }),
      now: NOW,
      cooldownMinutes: ESCALATION_COOLDOWN_MINUTES,
    });
    expect(decision.kind).toBe("ESCALATE");
  });

  it("custom cooldown honoured", () => {
    const decision = decideIssueEscalation({
      row: row({
        escalation_level: 1,
        last_escalated_at: new Date(NOW.getTime() - 4 * 60_000).toISOString(),
      }),
      now: NOW,
      cooldownMinutes: 5,
    });
    expect(decision).toEqual({ kind: "SKIP", reason: "cooldown" });
  });
});

describe("newEmptyOutcome", () => {
  it("returns zeroed aggregate with all skip-reason buckets initialised", () => {
    const o = newEmptyOutcome();
    expect(o).toEqual({
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
    });
  });
});
