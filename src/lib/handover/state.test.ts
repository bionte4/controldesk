import { describe, expect, it } from "vitest";

import {
  PMH_PENDING_STATUSES,
  PMH_STATUS_APPROVER_ROLE,
  canApproveNextPmh,
  expectedPmhApproverRole,
  isPmhPending,
  isPmhTerminal,
  nextPmHandoverStatus,
} from "./state";

describe("nextPmHandoverStatus", () => {
  it("routes DRAFT → PENDING_OM → PENDING_HM → APPROVED", () => {
    let s = nextPmHandoverStatus({ current: "DRAFT", action: "SUBMIT" });
    expect(s).toBe("PENDING_OM");
    s = nextPmHandoverStatus({ current: s, action: "APPROVE" });
    expect(s).toBe("PENDING_HM");
    s = nextPmHandoverStatus({ current: s, action: "APPROVE" });
    expect(s).toBe("APPROVED");
  });

  it("rejects from any pending status", () => {
    expect(
      nextPmHandoverStatus({ current: "PENDING_OM", action: "REJECT" }),
    ).toBe("REJECTED");
    expect(
      nextPmHandoverStatus({ current: "PENDING_HM", action: "REJECT" }),
    ).toBe("REJECTED");
  });

  it("cancels from non-terminal states", () => {
    expect(
      nextPmHandoverStatus({ current: "DRAFT", action: "CANCEL" }),
    ).toBe("CANCELLED");
    expect(
      nextPmHandoverStatus({ current: "PENDING_OM", action: "CANCEL" }),
    ).toBe("CANCELLED");
    expect(
      nextPmHandoverStatus({ current: "APPROVED", action: "CANCEL" }),
    ).toBe("CANCELLED");
  });

  it("throws when submitting from non-DRAFT", () => {
    expect(() =>
      nextPmHandoverStatus({ current: "PENDING_OM", action: "SUBMIT" }),
    ).toThrow();
  });

  it("throws when rejecting from non-pending status", () => {
    expect(() =>
      nextPmHandoverStatus({ current: "APPROVED", action: "REJECT" }),
    ).toThrow();
  });

  it("throws when cancelling a terminal handover", () => {
    expect(() =>
      nextPmHandoverStatus({ current: "EXECUTED", action: "CANCEL" }),
    ).toThrow();
    expect(() =>
      nextPmHandoverStatus({ current: "REJECTED", action: "CANCEL" }),
    ).toThrow();
    expect(() =>
      nextPmHandoverStatus({ current: "CANCELLED", action: "CANCEL" }),
    ).toThrow();
  });

  it("throws when approving from a non-approval status", () => {
    expect(() =>
      nextPmHandoverStatus({ current: "APPROVED", action: "APPROVE" }),
    ).toThrow();
    expect(() =>
      nextPmHandoverStatus({ current: "DRAFT", action: "APPROVE" }),
    ).toThrow();
  });
});

describe("expectedPmhApproverRole / canApproveNextPmh", () => {
  it("maps PENDING_OM to OPERATIONS_MANAGER", () => {
    expect(expectedPmhApproverRole("PENDING_OM")).toBe("OPERATIONS_MANAGER");
    expect(canApproveNextPmh("OPERATIONS_MANAGER", "PENDING_OM")).toBe(true);
    expect(canApproveNextPmh("HEAD_MANAGER", "PENDING_OM")).toBe(false);
  });

  it("maps PENDING_HM to HEAD_MANAGER", () => {
    expect(expectedPmhApproverRole("PENDING_HM")).toBe("HEAD_MANAGER");
    expect(canApproveNextPmh("HEAD_MANAGER", "PENDING_HM")).toBe(true);
    expect(canApproveNextPmh("OPERATIONS_MANAGER", "PENDING_HM")).toBe(false);
  });

  it("TENANT_ADMIN can approve any pending status", () => {
    expect(canApproveNextPmh("TENANT_ADMIN", "PENDING_OM")).toBe(true);
    expect(canApproveNextPmh("TENANT_ADMIN", "PENDING_HM")).toBe(true);
  });

  it("returns null for non-pending states in role mapping", () => {
    expect(expectedPmhApproverRole("DRAFT")).toBeNull();
    expect(expectedPmhApproverRole("APPROVED")).toBeNull();
    expect(expectedPmhApproverRole("EXECUTED")).toBeNull();
    expect(expectedPmhApproverRole("REJECTED")).toBeNull();
    expect(expectedPmhApproverRole("CANCELLED")).toBeNull();
  });

  it("no role can approve non-pending states", () => {
    expect(canApproveNextPmh("OPERATIONS_MANAGER", "APPROVED")).toBe(false);
    expect(canApproveNextPmh("HEAD_MANAGER", "EXECUTED")).toBe(false);
  });
});

describe("isPmhPending / isPmhTerminal", () => {
  it("classifies pending vs terminal", () => {
    for (const s of PMH_PENDING_STATUSES) {
      expect(isPmhPending(s)).toBe(true);
      expect(isPmhTerminal(s)).toBe(false);
    }
    for (const s of ["EXECUTED", "REJECTED", "CANCELLED"] as const) {
      expect(isPmhTerminal(s)).toBe(true);
      expect(isPmhPending(s)).toBe(false);
    }
  });
});

describe("PMH_STATUS_APPROVER_ROLE coverage", () => {
  it("has an entry for every PmHandoverStatus", () => {
    expect(Object.keys(PMH_STATUS_APPROVER_ROLE)).toHaveLength(7);
  });
});
