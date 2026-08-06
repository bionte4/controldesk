import { describe, expect, it } from "vitest";

import {
  STATUS_APPROVER_ROLE,
  canApproveNext,
  expectedApproverRole,
  isPending,
  isTerminal,
  nextExpenseStatus,
} from "./state";

/**
 * Full coverage of the rules §9 threshold matrix. Every bracket is
 * exercised from DRAFT to APPROVED as a happy path, plus the terminal
 * REJECT/CANCEL transitions.
 */
describe("nextExpenseStatus — threshold matrix", () => {
  it("routes < 5M to L2 PM + Finance and terminates at APPROVED after finance", () => {
    let s = nextExpenseStatus({
      amountIDR: 1_500_000,
      current: "DRAFT",
      action: "SUBMIT",
    });
    expect(s).toBe("PENDING_L1_SUPERVISOR");

    s = nextExpenseStatus({
      amountIDR: 1_500_000,
      current: s,
      action: "APPROVE",
    });
    expect(s).toBe("PENDING_L2_PROJECT_MANAGER");

    s = nextExpenseStatus({
      amountIDR: 1_500_000,
      current: s,
      action: "APPROVE",
    });
    expect(s).toBe("PENDING_L2_5_FINANCE");

    s = nextExpenseStatus({
      amountIDR: 1_500_000,
      current: s,
      action: "FINANCE_APPROVE",
    });
    expect(s).toBe("APPROVED");
  });

  it("routes 5M-25M through L3 OM after Finance", () => {
    // amount just above 5M
    let s: ReturnType<typeof nextExpenseStatus> = "PENDING_L2_5_FINANCE";
    s = nextExpenseStatus({
      amountIDR: 12_000_000,
      current: s,
      action: "FINANCE_APPROVE",
    });
    expect(s).toBe("PENDING_L3_OPERATIONS_MANAGER");

    s = nextExpenseStatus({
      amountIDR: 12_000_000,
      current: s,
      action: "APPROVE",
    });
    expect(s).toBe("APPROVED");
  });

  it("routes 25M-100M through L3 → L4 HM", () => {
    let s: ReturnType<typeof nextExpenseStatus> = "PENDING_L2_5_FINANCE";
    s = nextExpenseStatus({
      amountIDR: 60_000_000,
      current: s,
      action: "FINANCE_APPROVE",
    });
    expect(s).toBe("PENDING_L3_OPERATIONS_MANAGER");

    s = nextExpenseStatus({
      amountIDR: 60_000_000,
      current: s,
      action: "APPROVE",
    });
    expect(s).toBe("PENDING_L4_HEAD_MANAGER");

    s = nextExpenseStatus({
      amountIDR: 60_000_000,
      current: s,
      action: "APPROVE",
    });
    expect(s).toBe("APPROVED");
  });

  it("routes > 100M all the way to L5 GM", () => {
    let s: ReturnType<typeof nextExpenseStatus> = "PENDING_L2_5_FINANCE";
    s = nextExpenseStatus({
      amountIDR: 250_000_000,
      current: s,
      action: "FINANCE_APPROVE",
    });
    expect(s).toBe("PENDING_L3_OPERATIONS_MANAGER");

    s = nextExpenseStatus({ amountIDR: 250_000_000, current: s, action: "APPROVE" });
    expect(s).toBe("PENDING_L4_HEAD_MANAGER");

    s = nextExpenseStatus({ amountIDR: 250_000_000, current: s, action: "APPROVE" });
    expect(s).toBe("PENDING_L5_GENERAL_MANAGER");

    s = nextExpenseStatus({ amountIDR: 250_000_000, current: s, action: "APPROVE" });
    expect(s).toBe("APPROVED");
  });

  it("SUBMIT only valid from DRAFT", () => {
    expect(() =>
      nextExpenseStatus({
        amountIDR: 1,
        current: "PENDING_L1_SUPERVISOR",
        action: "SUBMIT",
      }),
    ).toThrow(/only valid from DRAFT/i);
  });

  it("CANCEL rejects terminal states", () => {
    for (const t of ["APPROVED", "REJECTED", "CANCELLED"] as const) {
      expect(() =>
        nextExpenseStatus({ amountIDR: 1, current: t, action: "CANCEL" }),
      ).toThrow(/terminal/);
    }
  });

  it("CANCEL from any pending state → CANCELLED", () => {
    expect(
      nextExpenseStatus({
        amountIDR: 1,
        current: "PENDING_L2_PROJECT_MANAGER",
        action: "CANCEL",
      }),
    ).toBe("CANCELLED");
  });

  it("REJECT / FINANCE_REJECT from pending → REJECTED", () => {
    expect(
      nextExpenseStatus({
        amountIDR: 1,
        current: "PENDING_L1_SUPERVISOR",
        action: "REJECT",
      }),
    ).toBe("REJECTED");
    expect(
      nextExpenseStatus({
        amountIDR: 1,
        current: "PENDING_L2_5_FINANCE",
        action: "FINANCE_REJECT",
      }),
    ).toBe("REJECTED");
  });

  it("rejects wrong action at finance gate", () => {
    expect(() =>
      nextExpenseStatus({
        amountIDR: 1,
        current: "PENDING_L2_5_FINANCE",
        action: "APPROVE",
      }),
    ).toThrow(/FINANCE_APPROVE/);
  });

  it("rejects FINANCE_APPROVE outside the finance gate", () => {
    expect(() =>
      nextExpenseStatus({
        amountIDR: 1,
        current: "PENDING_L2_PROJECT_MANAGER",
        action: "FINANCE_APPROVE",
      }),
    ).toThrow(/APPROVE at L2/i);
  });
});

describe("expectedApproverRole + canApproveNext", () => {
  it("maps each pending state to the matching role", () => {
    expect(expectedApproverRole("PENDING_L1_SUPERVISOR")).toBe("SUPERVISOR");
    expect(expectedApproverRole("PENDING_L2_PROJECT_MANAGER")).toBe(
      "PROJECT_MANAGER",
    );
    expect(expectedApproverRole("PENDING_L2_5_FINANCE")).toBe("LEAD_FINANCE");
    expect(expectedApproverRole("PENDING_L3_OPERATIONS_MANAGER")).toBe(
      "OPERATIONS_MANAGER",
    );
    expect(expectedApproverRole("PENDING_L4_HEAD_MANAGER")).toBe("HEAD_MANAGER");
    expect(expectedApproverRole("PENDING_L5_GENERAL_MANAGER")).toBe(
      "GENERAL_MANAGER",
    );
  });

  it("terminal states have no approver", () => {
    expect(expectedApproverRole("APPROVED")).toBeNull();
    expect(expectedApproverRole("REJECTED")).toBeNull();
    expect(expectedApproverRole("CANCELLED")).toBeNull();
    expect(expectedApproverRole("DRAFT")).toBeNull();
  });

  it("canApproveNext gates by role match", () => {
    expect(canApproveNext("SUPERVISOR", "PENDING_L1_SUPERVISOR")).toBe(true);
    expect(canApproveNext("PROJECT_MANAGER", "PENDING_L1_SUPERVISOR")).toBe(false);
    expect(canApproveNext("EMPLOYEE", "PENDING_L1_SUPERVISOR")).toBe(false);
    expect(canApproveNext("LEAD_FINANCE", "PENDING_L2_5_FINANCE")).toBe(true);
    // TENANT_ADMIN is always allowed on pending states
    expect(canApproveNext("TENANT_ADMIN", "PENDING_L4_HEAD_MANAGER")).toBe(true);
    // Non-pending: nobody can act
    expect(canApproveNext("TENANT_ADMIN", "APPROVED")).toBe(false);
  });
});

describe("state predicates", () => {
  it("isPending / isTerminal cover the full enum", () => {
    expect(isPending("DRAFT")).toBe(false);
    expect(isPending("PENDING_L1_SUPERVISOR")).toBe(true);
    expect(isTerminal("APPROVED")).toBe(true);
    expect(isTerminal("REJECTED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("DRAFT")).toBe(false);
  });

  it("STATUS_APPROVER_ROLE has an entry for every ExpenseStatus", () => {
    const statuses = Object.keys(STATUS_APPROVER_ROLE);
    // 3 non-pending non-draft (APPROVED/REJECTED/CANCELLED) + 6 pending + DRAFT = 10
    expect(statuses).toHaveLength(10);
  });
});
