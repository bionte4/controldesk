import { describe, expect, it } from "vitest";

import {
  CA_PENDING_APPROVAL_STATUSES,
  CA_STATUS_APPROVER_ROLE,
  canApproveNextCa,
  expectedCaApproverRole,
  isCaPendingApproval,
  isCaTerminal,
  nextCashAdvanceStatus,
} from "./state";

/**
 * Cash advance shares the §9 threshold matrix with expenses. These tests
 * lock in that behaviour end-to-end.
 */
describe("nextCashAdvanceStatus — threshold matrix", () => {
  it("routes < 5M → L1 → L2 PM → Finance → APPROVED", () => {
    let s = nextCashAdvanceStatus({
      amountIDR: 2_000_000,
      current: "DRAFT",
      action: "SUBMIT",
    });
    expect(s).toBe("PENDING_L1_SUPERVISOR");

    s = nextCashAdvanceStatus({
      amountIDR: 2_000_000,
      current: s,
      action: "APPROVE",
    });
    expect(s).toBe("PENDING_L2_PROJECT_MANAGER");

    s = nextCashAdvanceStatus({
      amountIDR: 2_000_000,
      current: s,
      action: "APPROVE",
    });
    expect(s).toBe("PENDING_L2_5_FINANCE");

    s = nextCashAdvanceStatus({
      amountIDR: 2_000_000,
      current: s,
      action: "FINANCE_APPROVE",
    });
    expect(s).toBe("APPROVED");
  });

  it("routes 5M–25M via L3 OM after Finance", () => {
    const s = nextCashAdvanceStatus({
      amountIDR: 10_000_000,
      current: "PENDING_L2_5_FINANCE",
      action: "FINANCE_APPROVE",
    });
    expect(s).toBe("PENDING_L3_OPERATIONS_MANAGER");

    const s2 = nextCashAdvanceStatus({
      amountIDR: 10_000_000,
      current: s,
      action: "APPROVE",
    });
    expect(s2).toBe("APPROVED");
  });

  it("routes 25M–100M via L3 → L4 HM", () => {
    let s = nextCashAdvanceStatus({
      amountIDR: 60_000_000,
      current: "PENDING_L2_5_FINANCE",
      action: "FINANCE_APPROVE",
    });
    expect(s).toBe("PENDING_L3_OPERATIONS_MANAGER");

    s = nextCashAdvanceStatus({
      amountIDR: 60_000_000,
      current: s,
      action: "APPROVE",
    });
    expect(s).toBe("PENDING_L4_HEAD_MANAGER");

    s = nextCashAdvanceStatus({
      amountIDR: 60_000_000,
      current: s,
      action: "APPROVE",
    });
    expect(s).toBe("APPROVED");
  });

  it("routes > 100M all the way to L5 GM", () => {
    let s = nextCashAdvanceStatus({
      amountIDR: 250_000_000,
      current: "PENDING_L2_5_FINANCE",
      action: "FINANCE_APPROVE",
    });
    s = nextCashAdvanceStatus({
      amountIDR: 250_000_000,
      current: s,
      action: "APPROVE",
    });
    s = nextCashAdvanceStatus({
      amountIDR: 250_000_000,
      current: s,
      action: "APPROVE",
    });
    expect(s).toBe("PENDING_L5_GENERAL_MANAGER");

    s = nextCashAdvanceStatus({
      amountIDR: 250_000_000,
      current: s,
      action: "APPROVE",
    });
    expect(s).toBe("APPROVED");
  });
});

describe("nextCashAdvanceStatus — invalid transitions", () => {
  it("SUBMIT only from DRAFT", () => {
    expect(() =>
      nextCashAdvanceStatus({
        amountIDR: 1,
        current: "PENDING_L1_SUPERVISOR",
        action: "SUBMIT",
      }),
    ).toThrow(/DRAFT/);
  });

  it("CANCEL rejects terminal states", () => {
    for (const status of ["SETTLED", "REJECTED", "CANCELLED"] as const) {
      expect(() =>
        nextCashAdvanceStatus({
          amountIDR: 1,
          current: status,
          action: "CANCEL",
        }),
      ).toThrow(/terminal/);
    }
  });

  it("REJECT / FINANCE_REJECT from pending → REJECTED", () => {
    expect(
      nextCashAdvanceStatus({
        amountIDR: 1,
        current: "PENDING_L1_SUPERVISOR",
        action: "REJECT",
      }),
    ).toBe("REJECTED");
    expect(
      nextCashAdvanceStatus({
        amountIDR: 1,
        current: "PENDING_L2_5_FINANCE",
        action: "FINANCE_REJECT",
      }),
    ).toBe("REJECTED");
  });

  it("rejects APPROVE at the finance gate", () => {
    expect(() =>
      nextCashAdvanceStatus({
        amountIDR: 1,
        current: "PENDING_L2_5_FINANCE",
        action: "APPROVE",
      }),
    ).toThrow(/FINANCE_APPROVE/);
  });

  it("rejects FINANCE_APPROVE outside of the finance gate", () => {
    expect(() =>
      nextCashAdvanceStatus({
        amountIDR: 1,
        current: "PENDING_L2_PROJECT_MANAGER",
        action: "FINANCE_APPROVE",
      }),
    ).toThrow(/APPROVE at L2/i);
  });
});

describe("CA helpers", () => {
  it("expectedCaApproverRole maps every pending state", () => {
    expect(expectedCaApproverRole("PENDING_L1_SUPERVISOR")).toBe("SUPERVISOR");
    expect(expectedCaApproverRole("PENDING_L2_PROJECT_MANAGER")).toBe(
      "PROJECT_MANAGER",
    );
    expect(expectedCaApproverRole("PENDING_L2_5_FINANCE")).toBe("LEAD_FINANCE");
    expect(expectedCaApproverRole("PENDING_L3_OPERATIONS_MANAGER")).toBe(
      "OPERATIONS_MANAGER",
    );
    expect(expectedCaApproverRole("PENDING_L4_HEAD_MANAGER")).toBe(
      "HEAD_MANAGER",
    );
    expect(expectedCaApproverRole("PENDING_L5_GENERAL_MANAGER")).toBe(
      "GENERAL_MANAGER",
    );
    expect(expectedCaApproverRole("APPROVED")).toBe("LEAD_FINANCE");
    expect(expectedCaApproverRole("DISBURSED")).toBeNull();
    expect(expectedCaApproverRole("SETTLED")).toBeNull();
  });

  it("canApproveNextCa gates by role match and TENANT_ADMIN override", () => {
    expect(canApproveNextCa("SUPERVISOR", "PENDING_L1_SUPERVISOR")).toBe(true);
    expect(canApproveNextCa("EMPLOYEE", "PENDING_L1_SUPERVISOR")).toBe(false);
    expect(canApproveNextCa("LEAD_FINANCE", "PENDING_L2_5_FINANCE")).toBe(true);
    expect(canApproveNextCa("TENANT_ADMIN", "PENDING_L4_HEAD_MANAGER")).toBe(
      true,
    );
    expect(canApproveNextCa("TENANT_ADMIN", "APPROVED")).toBe(false);
    expect(canApproveNextCa("TENANT_ADMIN", "SETTLED")).toBe(false);
  });

  it("isCaPendingApproval / isCaTerminal categorize correctly", () => {
    for (const s of CA_PENDING_APPROVAL_STATUSES) {
      expect(isCaPendingApproval(s)).toBe(true);
      expect(isCaTerminal(s)).toBe(false);
    }
    expect(isCaPendingApproval("APPROVED")).toBe(false);
    expect(isCaTerminal("SETTLED")).toBe(true);
    expect(isCaTerminal("REJECTED")).toBe(true);
    expect(isCaTerminal("CANCELLED")).toBe(true);
    expect(isCaTerminal("APPROVED")).toBe(false);
    expect(isCaTerminal("DISBURSED")).toBe(false);
  });

  it("CA_STATUS_APPROVER_ROLE covers every enum value", () => {
    // 12 legacy L1-L5 chain + 5 canonical (PENDING_SUPERVISOR / PM / OM /
    // FINANCE / DIRECTOR) added by migration 0027. See rules §9 canonical.
    expect(Object.keys(CA_STATUS_APPROVER_ROLE)).toHaveLength(17);
  });
});
