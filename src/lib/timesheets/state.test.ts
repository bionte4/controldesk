import { describe, expect, it } from "vitest";

import {
  canApproveTimesheet,
  isTimesheetPending,
  isTimesheetTerminal,
  nextTimesheetStatus,
} from "./state";

describe("timesheet state machine", () => {
  it("moves DRAFT to SUBMITTED", () => {
    expect(
      nextTimesheetStatus({ current: "DRAFT", action: "SUBMIT" }),
    ).toBe("SUBMITTED");
  });

  it("allows re-submitting a REJECTED timesheet", () => {
    expect(
      nextTimesheetStatus({ current: "REJECTED", action: "SUBMIT" }),
    ).toBe("SUBMITTED");
  });

  it("rejects re-submitting an APPROVED sheet", () => {
    expect(() =>
      nextTimesheetStatus({ current: "APPROVED", action: "SUBMIT" }),
    ).toThrowError(/SUBMIT/);
  });

  it("APPROVE only valid from SUBMITTED", () => {
    expect(
      nextTimesheetStatus({ current: "SUBMITTED", action: "APPROVE" }),
    ).toBe("APPROVED");
    expect(() =>
      nextTimesheetStatus({ current: "DRAFT", action: "APPROVE" }),
    ).toThrowError(/APPROVE/);
  });

  it("REJECT only valid from SUBMITTED", () => {
    expect(
      nextTimesheetStatus({ current: "SUBMITTED", action: "REJECT" }),
    ).toBe("REJECTED");
    expect(() =>
      nextTimesheetStatus({ current: "APPROVED", action: "REJECT" }),
    ).toThrowError(/REJECT/);
  });

  it("classifies pending/terminal correctly", () => {
    expect(isTimesheetPending("SUBMITTED")).toBe(true);
    expect(isTimesheetPending("DRAFT")).toBe(false);
    expect(isTimesheetTerminal("APPROVED")).toBe(true);
    expect(isTimesheetTerminal("REJECTED")).toBe(true);
    expect(isTimesheetTerminal("DRAFT")).toBe(false);
  });

  it("canApproveTimesheet: supervisor, PM, HR yes; EMPLOYEE no", () => {
    expect(canApproveTimesheet("SUPERVISOR", "SUBMITTED")).toBe(true);
    expect(canApproveTimesheet("PROJECT_MANAGER", "SUBMITTED")).toBe(true);
    expect(canApproveTimesheet("HR_ADMIN", "SUBMITTED")).toBe(true);
    expect(canApproveTimesheet("EMPLOYEE", "SUBMITTED")).toBe(false);
    expect(canApproveTimesheet("SUPERVISOR", "APPROVED")).toBe(false);
  });
});
