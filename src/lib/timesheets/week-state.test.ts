import { describe, expect, it } from "vitest";

import {
  TW_PENDING_STATUSES,
  TW_STATUSES,
  canApproveWeek,
  isIsoMonday,
  isTwEditable,
  isTwPending,
  isTwTerminal,
  isWithinWeek,
  nextWeekStatus,
  toApprovalAction,
  weekDatesFromStart,
  weekEndFromStart,
  weekStartFromDate,
} from "./week-state";

describe("week-state enum bookkeeping", () => {
  it("statuses cover DRAFT/SUBMITTED/APPROVED/REJECTED", () => {
    expect(TW_STATUSES).toEqual(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"]);
  });

  it("pending statuses = SUBMITTED only", () => {
    expect(TW_PENDING_STATUSES).toEqual(["SUBMITTED"]);
  });

  it("guards agree on classification", () => {
    expect(isTwPending("SUBMITTED")).toBe(true);
    expect(isTwPending("APPROVED")).toBe(false);
    expect(isTwTerminal("APPROVED")).toBe(true);
    expect(isTwTerminal("REJECTED")).toBe(false); // resubmittable
    expect(isTwEditable("DRAFT")).toBe(true);
    expect(isTwEditable("REJECTED")).toBe(true);
    expect(isTwEditable("SUBMITTED")).toBe(false);
    expect(isTwEditable("APPROVED")).toBe(false);
  });
});

describe("nextWeekStatus — happy paths", () => {
  it("DRAFT + SUBMIT → SUBMITTED", () => {
    expect(nextWeekStatus({ current: "DRAFT", action: "SUBMIT" })).toBe(
      "SUBMITTED",
    );
  });

  it("REJECTED + SUBMIT → SUBMITTED (resubmit)", () => {
    expect(nextWeekStatus({ current: "REJECTED", action: "SUBMIT" })).toBe(
      "SUBMITTED",
    );
  });

  it("SUBMITTED + APPROVE → APPROVED", () => {
    expect(nextWeekStatus({ current: "SUBMITTED", action: "APPROVE" })).toBe(
      "APPROVED",
    );
  });

  it("SUBMITTED + REJECT → REJECTED", () => {
    expect(nextWeekStatus({ current: "SUBMITTED", action: "REJECT" })).toBe(
      "REJECTED",
    );
  });
});

describe("nextWeekStatus — illegal transitions throw", () => {
  it("APPROVED terminal — SUBMIT/APPROVE/REJECT all rejected", () => {
    expect(() =>
      nextWeekStatus({ current: "APPROVED", action: "SUBMIT" }),
    ).toThrow(/SUBMIT/);
    expect(() =>
      nextWeekStatus({ current: "APPROVED", action: "APPROVE" }),
    ).toThrow(/APPROVE/);
    expect(() =>
      nextWeekStatus({ current: "APPROVED", action: "REJECT" }),
    ).toThrow(/REJECT/);
  });

  it("SUBMITTED cannot re-SUBMIT", () => {
    expect(() =>
      nextWeekStatus({ current: "SUBMITTED", action: "SUBMIT" }),
    ).toThrow();
  });

  it("DRAFT cannot APPROVE/REJECT directly", () => {
    expect(() =>
      nextWeekStatus({ current: "DRAFT", action: "APPROVE" }),
    ).toThrow();
    expect(() =>
      nextWeekStatus({ current: "DRAFT", action: "REJECT" }),
    ).toThrow();
  });
});

describe("canApproveWeek", () => {
  it("only pending SUBMITTED is approvable, and only by approver roles", () => {
    expect(canApproveWeek("PROJECT_MANAGER", "SUBMITTED")).toBe(true);
    expect(canApproveWeek("SUPERVISOR", "SUBMITTED")).toBe(true);
    expect(canApproveWeek("HR_ADMIN", "SUBMITTED")).toBe(true);
    expect(canApproveWeek("EMPLOYEE", "SUBMITTED")).toBe(false);
    expect(canApproveWeek("PROJECT_MANAGER", "DRAFT")).toBe(false);
    expect(canApproveWeek("PROJECT_MANAGER", "APPROVED")).toBe(false);
    expect(canApproveWeek("PROJECT_MANAGER", "REJECTED")).toBe(false);
  });
});

describe("toApprovalAction", () => {
  it("maps 1:1 to the approval_action enum", () => {
    expect(toApprovalAction("SUBMIT")).toBe("SUBMIT");
    expect(toApprovalAction("APPROVE")).toBe("APPROVE");
    expect(toApprovalAction("REJECT")).toBe("REJECT");
  });
});

describe("weekStartFromDate — ISO Monday", () => {
  it("Monday → same Monday", () => {
    // 2026-08-03 is a Monday.
    expect(weekStartFromDate("2026-08-03")).toBe("2026-08-03");
  });

  it("Wednesday → prior Monday", () => {
    expect(weekStartFromDate("2026-08-05")).toBe("2026-08-03");
  });

  it("Sunday → prior Monday (NOT next)", () => {
    // 2026-08-09 is a Sunday.
    expect(weekStartFromDate("2026-08-09")).toBe("2026-08-03");
  });

  it("Sunday New-Year edge → prior year", () => {
    // 2027-01-03 is a Sunday.
    expect(weekStartFromDate("2027-01-03")).toBe("2026-12-28");
  });

  it("accepts Date instance", () => {
    const d = new Date("2026-08-05T00:00:00.000Z"); // Wed
    expect(weekStartFromDate(d)).toBe("2026-08-03");
  });
});

describe("weekDatesFromStart / weekEndFromStart", () => {
  it("expands Mon..Sun", () => {
    expect(weekDatesFromStart("2026-08-03")).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
  });

  it("weekEndFromStart is the Sunday", () => {
    expect(weekEndFromStart("2026-08-03")).toBe("2026-08-09");
  });

  it("month crossover", () => {
    expect(weekEndFromStart("2026-08-31")).toBe("2026-09-06");
  });
});

describe("isIsoMonday", () => {
  it("Monday true, other days false", () => {
    expect(isIsoMonday("2026-08-03")).toBe(true);
    expect(isIsoMonday("2026-08-04")).toBe(false);
    expect(isIsoMonday("2026-08-09")).toBe(false); // Sunday
  });

  it("bad shape false", () => {
    expect(isIsoMonday("08-03-2026")).toBe(false);
    expect(isIsoMonday("not-a-date")).toBe(false);
  });
});

describe("isWithinWeek", () => {
  it("inclusive of Monday and Sunday", () => {
    expect(isWithinWeek("2026-08-03", "2026-08-03")).toBe(true);
    expect(isWithinWeek("2026-08-03", "2026-08-09")).toBe(true);
    expect(isWithinWeek("2026-08-03", "2026-08-10")).toBe(false);
    expect(isWithinWeek("2026-08-03", "2026-08-02")).toBe(false);
  });
});
