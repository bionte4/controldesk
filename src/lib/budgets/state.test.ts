import { describe, expect, it } from "vitest";

import {
  BUDGET_DIRECTOR_THRESHOLD,
  BUDGET_STATUS_LABEL,
  BUDGET_STATUS_TONE,
  PENDING_BUDGET_STATUSES,
  TERMINAL_BUDGET_STATUSES,
  budgetPendingForRole,
  budgetSlotForStatus,
  canBudgetAdvance,
  isPendingBudget,
  isTerminalBudget,
  nextBudgetStatus,
} from "./state";
import type { CanonicalRole } from "@/lib/rbac/roles";

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

describe("budget state — constants", () => {
  it("PENDING_BUDGET_STATUSES enumerates in-flight statuses", () => {
    expect(PENDING_BUDGET_STATUSES).toEqual([
      "PENDING_FINANCE",
      "PENDING_DIRECTOR",
    ]);
  });

  it("TERMINAL_BUDGET_STATUSES covers APPROVED + CANCELLED", () => {
    expect(TERMINAL_BUDGET_STATUSES).toEqual(["APPROVED", "CANCELLED"]);
  });

  it("BUDGET_STATUS_LABEL covers every enum value", () => {
    for (const s of [
      "DRAFT",
      "PENDING_FINANCE",
      "PENDING_DIRECTOR",
      "APPROVED",
      "REVISED",
      "CANCELLED",
    ] as const) {
      expect(BUDGET_STATUS_LABEL[s]).toBeTruthy();
      expect(BUDGET_STATUS_TONE[s]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Predicates.
// ---------------------------------------------------------------------------

describe("isPendingBudget / isTerminalBudget", () => {
  it("marks pending statuses correctly", () => {
    expect(isPendingBudget("PENDING_FINANCE")).toBe(true);
    expect(isPendingBudget("PENDING_DIRECTOR")).toBe(true);
    expect(isPendingBudget("DRAFT")).toBe(false);
    expect(isPendingBudget("APPROVED")).toBe(false);
  });

  it("marks terminal statuses correctly", () => {
    expect(isTerminalBudget("APPROVED")).toBe(true);
    expect(isTerminalBudget("CANCELLED")).toBe(true);
    expect(isTerminalBudget("PENDING_FINANCE")).toBe(false);
    expect(isTerminalBudget("DRAFT")).toBe(false);
    expect(isTerminalBudget("REVISED")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Slot resolution.
// ---------------------------------------------------------------------------

describe("budgetSlotForStatus", () => {
  it("maps pending statuses to the correct canonical slot", () => {
    expect(budgetSlotForStatus("PENDING_FINANCE")).toBe("FINANCE");
    expect(budgetSlotForStatus("PENDING_DIRECTOR")).toBe("DIRECTOR");
  });

  it("returns null for non-pending statuses", () => {
    expect(budgetSlotForStatus("DRAFT")).toBeNull();
    expect(budgetSlotForStatus("APPROVED")).toBeNull();
    expect(budgetSlotForStatus("REVISED")).toBeNull();
    expect(budgetSlotForStatus("CANCELLED")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// State machine — SUBMIT.
// ---------------------------------------------------------------------------

describe("nextBudgetStatus — SUBMIT", () => {
  it("DRAFT → PENDING_FINANCE", () => {
    expect(
      nextBudgetStatus({ totalPlannedIDR: 1_000_000, current: "DRAFT", action: "SUBMIT" }),
    ).toBe("PENDING_FINANCE");
  });

  it("REVISED → PENDING_FINANCE", () => {
    expect(
      nextBudgetStatus({
        totalPlannedIDR: 1_000_000,
        current: "REVISED",
        action: "SUBMIT",
      }),
    ).toBe("PENDING_FINANCE");
  });

  it("rejects SUBMIT from PENDING_FINANCE", () => {
    expect(() =>
      nextBudgetStatus({
        totalPlannedIDR: 1_000_000,
        current: "PENDING_FINANCE",
        action: "SUBMIT",
      }),
    ).toThrow(/SUBMIT/);
  });

  it("rejects SUBMIT from APPROVED", () => {
    expect(() =>
      nextBudgetStatus({
        totalPlannedIDR: 1_000_000,
        current: "APPROVED",
        action: "SUBMIT",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// State machine — APPROVE (threshold-driven).
// ---------------------------------------------------------------------------

describe("nextBudgetStatus — APPROVE threshold matrix", () => {
  it("PENDING_FINANCE + below director threshold → APPROVED", () => {
    expect(
      nextBudgetStatus({
        totalPlannedIDR: BUDGET_DIRECTOR_THRESHOLD - 1,
        current: "PENDING_FINANCE",
        action: "APPROVE",
      }),
    ).toBe("APPROVED");
  });

  it("PENDING_FINANCE + at director threshold → PENDING_DIRECTOR", () => {
    expect(
      nextBudgetStatus({
        totalPlannedIDR: BUDGET_DIRECTOR_THRESHOLD,
        current: "PENDING_FINANCE",
        action: "APPROVE",
      }),
    ).toBe("PENDING_DIRECTOR");
  });

  it("PENDING_FINANCE + above director threshold → PENDING_DIRECTOR", () => {
    expect(
      nextBudgetStatus({
        totalPlannedIDR: BUDGET_DIRECTOR_THRESHOLD + 1_000_000,
        current: "PENDING_FINANCE",
        action: "APPROVE",
      }),
    ).toBe("PENDING_DIRECTOR");
  });

  it("PENDING_DIRECTOR → APPROVED", () => {
    expect(
      nextBudgetStatus({
        totalPlannedIDR: BUDGET_DIRECTOR_THRESHOLD + 1_000_000,
        current: "PENDING_DIRECTOR",
        action: "APPROVE",
      }),
    ).toBe("APPROVED");
  });

  it("rejects APPROVE from DRAFT", () => {
    expect(() =>
      nextBudgetStatus({
        totalPlannedIDR: 1_000_000,
        current: "DRAFT",
        action: "APPROVE",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// State machine — REJECT & CANCEL.
// ---------------------------------------------------------------------------

describe("nextBudgetStatus — REJECT / CANCEL", () => {
  it("REJECT from PENDING_FINANCE → CANCELLED", () => {
    expect(
      nextBudgetStatus({
        totalPlannedIDR: 1_000_000,
        current: "PENDING_FINANCE",
        action: "REJECT",
      }),
    ).toBe("CANCELLED");
  });

  it("REJECT from PENDING_DIRECTOR → CANCELLED", () => {
    expect(
      nextBudgetStatus({
        totalPlannedIDR: 1_000_000,
        current: "PENDING_DIRECTOR",
        action: "REJECT",
      }),
    ).toBe("CANCELLED");
  });

  it("rejects REJECT from DRAFT", () => {
    expect(() =>
      nextBudgetStatus({
        totalPlannedIDR: 1_000_000,
        current: "DRAFT",
        action: "REJECT",
      }),
    ).toThrow();
  });

  it("CANCEL from DRAFT → CANCELLED", () => {
    expect(
      nextBudgetStatus({
        totalPlannedIDR: 1_000_000,
        current: "DRAFT",
        action: "CANCEL",
      }),
    ).toBe("CANCELLED");
  });

  it("CANCEL from PENDING_FINANCE → CANCELLED", () => {
    expect(
      nextBudgetStatus({
        totalPlannedIDR: 1_000_000,
        current: "PENDING_FINANCE",
        action: "CANCEL",
      }),
    ).toBe("CANCELLED");
  });

  it("rejects CANCEL from APPROVED", () => {
    expect(() =>
      nextBudgetStatus({
        totalPlannedIDR: 1_000_000,
        current: "APPROVED",
        action: "CANCEL",
      }),
    ).toThrow();
  });

  it("rejects CANCEL from CANCELLED", () => {
    expect(() =>
      nextBudgetStatus({
        totalPlannedIDR: 1_000_000,
        current: "CANCELLED",
        action: "CANCEL",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// canBudgetAdvance — role vs slot check.
// ---------------------------------------------------------------------------

describe("canBudgetAdvance", () => {
  const cases: Array<[CanonicalRole, "PENDING_FINANCE" | "PENDING_DIRECTOR", boolean]> = [
    ["FINANCE", "PENDING_FINANCE", true],
    ["FINANCE", "PENDING_DIRECTOR", false],
    ["DIRECTOR", "PENDING_FINANCE", false],
    ["DIRECTOR", "PENDING_DIRECTOR", true],
    ["ADMIN", "PENDING_FINANCE", true],
    ["ADMIN", "PENDING_DIRECTOR", true],
    ["PM", "PENDING_FINANCE", false],
    ["PM", "PENDING_DIRECTOR", false],
    ["OM", "PENDING_FINANCE", false],
    ["OM", "PENDING_DIRECTOR", false],
    ["EMPLOYEE", "PENDING_FINANCE", false],
    ["SUPERVISOR", "PENDING_DIRECTOR", false],
  ];

  it.each(cases)("role=%s + status=%s → %s", (role, status, expected) => {
    expect(canBudgetAdvance(role, status)).toBe(expected);
  });

  it("returns false for non-pending statuses regardless of role", () => {
    expect(canBudgetAdvance("DIRECTOR", "DRAFT")).toBe(false);
    expect(canBudgetAdvance("FINANCE", "APPROVED")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// budgetPendingForRole — inbox filter.
// ---------------------------------------------------------------------------

describe("budgetPendingForRole", () => {
  it("ADMIN sees every pending status", () => {
    expect(budgetPendingForRole("ADMIN")).toEqual([
      "PENDING_FINANCE",
      "PENDING_DIRECTOR",
    ]);
  });

  it("FINANCE sees only PENDING_FINANCE", () => {
    expect(budgetPendingForRole("FINANCE")).toEqual(["PENDING_FINANCE"]);
  });

  it("DIRECTOR sees only PENDING_DIRECTOR", () => {
    expect(budgetPendingForRole("DIRECTOR")).toEqual(["PENDING_DIRECTOR"]);
  });

  it("EMPLOYEE / SUPERVISOR / PM / OM see nothing", () => {
    expect(budgetPendingForRole("EMPLOYEE")).toEqual([]);
    expect(budgetPendingForRole("SUPERVISOR")).toEqual([]);
    expect(budgetPendingForRole("PM")).toEqual([]);
    expect(budgetPendingForRole("OM")).toEqual([]);
  });
});
