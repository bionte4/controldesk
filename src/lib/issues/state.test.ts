import { describe, expect, it } from "vitest";

import {
  ISSUE_ACTIVE_STATUSES,
  ISSUE_ESCALATION_ROLE,
  ISSUE_SEVERITIES,
  ISSUE_SEVERITY_RANK,
  ISSUE_SLA_HOURS_BUSINESS,
  ISSUE_STATUSES,
  allowedNextIssueStatuses,
  canTransitionIssue,
  isActiveIssueStatus,
  isTerminalIssueStatus,
  nextIssueEscalationLevel,
} from "./state";

describe("Project Issue state machine", () => {
  it("OPEN → IN_PROGRESS / RESOLVED / CLOSED allowed", () => {
    expect(canTransitionIssue("OPEN", "IN_PROGRESS")).toBe(true);
    expect(canTransitionIssue("OPEN", "RESOLVED")).toBe(true);
    expect(canTransitionIssue("OPEN", "CLOSED")).toBe(true);
    expect(canTransitionIssue("OPEN", "REOPENED")).toBe(false);
  });

  it("IN_PROGRESS can go back to OPEN or forward to RESOLVED / CLOSED", () => {
    expect(canTransitionIssue("IN_PROGRESS", "OPEN")).toBe(true);
    expect(canTransitionIssue("IN_PROGRESS", "RESOLVED")).toBe(true);
    expect(canTransitionIssue("IN_PROGRESS", "CLOSED")).toBe(true);
    expect(canTransitionIssue("IN_PROGRESS", "REOPENED")).toBe(false);
  });

  it("RESOLVED → CLOSED / REOPENED only", () => {
    expect(canTransitionIssue("RESOLVED", "CLOSED")).toBe(true);
    expect(canTransitionIssue("RESOLVED", "REOPENED")).toBe(true);
    expect(canTransitionIssue("RESOLVED", "OPEN")).toBe(false);
    expect(canTransitionIssue("RESOLVED", "IN_PROGRESS")).toBe(false);
  });

  it("CLOSED can only be REOPENED", () => {
    expect(canTransitionIssue("CLOSED", "REOPENED")).toBe(true);
    expect(canTransitionIssue("CLOSED", "OPEN")).toBe(false);
    expect(canTransitionIssue("CLOSED", "IN_PROGRESS")).toBe(false);
    expect(canTransitionIssue("CLOSED", "RESOLVED")).toBe(false);
  });

  it("REOPENED behaves like OPEN going forward", () => {
    expect(canTransitionIssue("REOPENED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionIssue("REOPENED", "RESOLVED")).toBe(true);
    expect(canTransitionIssue("REOPENED", "CLOSED")).toBe(true);
    expect(canTransitionIssue("REOPENED", "OPEN")).toBe(false);
  });

  it("no self-transitions are legal", () => {
    for (const s of ISSUE_STATUSES) {
      expect(canTransitionIssue(s, s)).toBe(false);
    }
  });

  it("allowedNextIssueStatuses is consistent with canTransitionIssue", () => {
    for (const from of ISSUE_STATUSES) {
      for (const to of ISSUE_STATUSES) {
        expect(
          allowedNextIssueStatuses(from).includes(to),
        ).toBe(canTransitionIssue(from, to));
      }
    }
  });

  it("isActiveIssueStatus covers OPEN / IN_PROGRESS / REOPENED", () => {
    expect(isActiveIssueStatus("OPEN")).toBe(true);
    expect(isActiveIssueStatus("IN_PROGRESS")).toBe(true);
    expect(isActiveIssueStatus("REOPENED")).toBe(true);
    expect(isActiveIssueStatus("RESOLVED")).toBe(false);
    expect(isActiveIssueStatus("CLOSED")).toBe(false);
    expect(ISSUE_ACTIVE_STATUSES).toEqual(["OPEN", "IN_PROGRESS", "REOPENED"]);
  });

  it("isTerminalIssueStatus is CLOSED only", () => {
    for (const s of ISSUE_STATUSES) {
      expect(isTerminalIssueStatus(s)).toBe(s === "CLOSED");
    }
  });
});

describe("Project Issue severity metadata", () => {
  it("SLA hours match rules §26 (business hours: 1 / 4 / 8 / 24)", () => {
    expect(ISSUE_SLA_HOURS_BUSINESS.CRITICAL).toBe(1);
    expect(ISSUE_SLA_HOURS_BUSINESS.HIGH).toBe(4);
    expect(ISSUE_SLA_HOURS_BUSINESS.MEDIUM).toBe(8);
    expect(ISSUE_SLA_HOURS_BUSINESS.LOW).toBe(24);
  });

  it("severity rank is monotone decreasing from CRITICAL to LOW", () => {
    const ranks = ISSUE_SEVERITIES.map((s) => ISSUE_SEVERITY_RANK[s]);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i - 1]).toBeGreaterThan(ranks[i]);
    }
  });

  it("SLA hours are monotone increasing from CRITICAL to LOW", () => {
    const hours = ISSUE_SEVERITIES.map((s) => ISSUE_SLA_HOURS_BUSINESS[s]);
    for (let i = 1; i < hours.length; i++) {
      expect(hours[i - 1]).toBeLessThan(hours[i]);
    }
  });
});

describe("Project Issue escalation ladder", () => {
  it("levels map to Supervisor → PM → OM → Director", () => {
    expect(ISSUE_ESCALATION_ROLE[0]).toBe("SUPERVISOR");
    expect(ISSUE_ESCALATION_ROLE[1]).toBe("PM");
    expect(ISSUE_ESCALATION_ROLE[2]).toBe("OM");
    expect(ISSUE_ESCALATION_ROLE[3]).toBe("DIRECTOR");
  });

  it("nextIssueEscalationLevel climbs 0→1→2→3 then stops", () => {
    expect(nextIssueEscalationLevel(0)).toBe(1);
    expect(nextIssueEscalationLevel(1)).toBe(2);
    expect(nextIssueEscalationLevel(2)).toBe(3);
    expect(nextIssueEscalationLevel(3)).toBeNull();
  });

  it("nextIssueEscalationLevel clamps out-of-range input", () => {
    expect(nextIssueEscalationLevel(-5)).toBe(1);
    expect(nextIssueEscalationLevel(10)).toBeNull();
    expect(nextIssueEscalationLevel(1.9)).toBe(2);
  });
});
