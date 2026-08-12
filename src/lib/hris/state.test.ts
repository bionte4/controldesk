import { describe, expect, it } from "vitest";

import {
  HR_PENDING_STATUSES,
  HR_STATUS_APPROVER_ROLE,
  canApproveNextHr,
  expectedHrApproverRole,
  hrChainForKind,
  isHrPending,
  isHrTerminal,
  nextHrRequestStatus,
} from "./state";

describe("nextHrRequestStatus — LEAVE / OVERTIME chain", () => {
  it("routes LEAVE from DRAFT → L1 → L2 → L3 → HR → APPROVED", () => {
    let s = nextHrRequestStatus({
      kind: "LEAVE",
      current: "DRAFT",
      action: "SUBMIT",
    });
    expect(s).toBe("PENDING_L1_SUPERVISOR");

    s = nextHrRequestStatus({ kind: "LEAVE", current: s, action: "APPROVE" });
    expect(s).toBe("PENDING_L2_PROJECT_MANAGER");

    s = nextHrRequestStatus({ kind: "LEAVE", current: s, action: "APPROVE" });
    expect(s).toBe("PENDING_L3_OPERATIONS_MANAGER");

    s = nextHrRequestStatus({ kind: "LEAVE", current: s, action: "APPROVE" });
    expect(s).toBe("PENDING_HR_ADMIN");

    s = nextHrRequestStatus({ kind: "LEAVE", current: s, action: "APPROVE" });
    expect(s).toBe("APPROVED");
  });

  it("routes OVERTIME through the same 4-level chain", () => {
    let s: ReturnType<typeof nextHrRequestStatus> = "DRAFT";
    for (const _ of [0, 1, 2, 3]) {
      void _;
      s = nextHrRequestStatus({
        kind: "OVERTIME",
        current: s,
        action: s === "DRAFT" ? "SUBMIT" : "APPROVE",
      });
    }
    // After SUBMIT + L1 approve + L2 approve + L3 approve → HR pending
    expect(s).toBe("PENDING_HR_ADMIN");
  });
});

describe("nextHrRequestStatus — SICK short-circuit", () => {
  it("skips PM/OM and goes DRAFT → L1 → HR → APPROVED", () => {
    let s = nextHrRequestStatus({
      kind: "SICK",
      current: "DRAFT",
      action: "SUBMIT",
    });
    expect(s).toBe("PENDING_L1_SUPERVISOR");

    s = nextHrRequestStatus({ kind: "SICK", current: s, action: "APPROVE" });
    expect(s).toBe("PENDING_HR_ADMIN");

    s = nextHrRequestStatus({ kind: "SICK", current: s, action: "APPROVE" });
    expect(s).toBe("APPROVED");
  });
});

describe("nextHrRequestStatus — invalid transitions", () => {
  it("SUBMIT is only valid from DRAFT", () => {
    expect(() =>
      nextHrRequestStatus({
        kind: "LEAVE",
        current: "PENDING_L1_SUPERVISOR",
        action: "SUBMIT",
      }),
    ).toThrow(/DRAFT/);
  });

  it("CANCEL rejects terminal states", () => {
    for (const status of ["APPROVED", "REJECTED", "CANCELLED"] as const) {
      expect(() =>
        nextHrRequestStatus({
          kind: "LEAVE",
          current: status,
          action: "CANCEL",
        }),
      ).toThrow(/terminal/);
    }
  });

  it("REJECT requires a pending status", () => {
    expect(() =>
      nextHrRequestStatus({
        kind: "LEAVE",
        current: "DRAFT",
        action: "REJECT",
      }),
    ).toThrow(/non-pending/);
    expect(
      nextHrRequestStatus({
        kind: "LEAVE",
        current: "PENDING_L2_PROJECT_MANAGER",
        action: "REJECT",
      }),
    ).toBe("REJECTED");
  });

  it("APPROVE from terminal is rejected", () => {
    expect(() =>
      nextHrRequestStatus({
        kind: "LEAVE",
        current: "APPROVED",
        action: "APPROVE",
      }),
    ).toThrow(/non-pending/);
  });
});

describe("HR helpers", () => {
  it("expectedHrApproverRole maps each pending state correctly", () => {
    expect(expectedHrApproverRole("PENDING_L1_SUPERVISOR")).toBe("SUPERVISOR");
    expect(expectedHrApproverRole("PENDING_L2_PROJECT_MANAGER")).toBe(
      "PROJECT_MANAGER",
    );
    expect(expectedHrApproverRole("PENDING_L3_OPERATIONS_MANAGER")).toBe(
      "OPERATIONS_MANAGER",
    );
    expect(expectedHrApproverRole("PENDING_HR_ADMIN")).toBe("HR_ADMIN");
    expect(expectedHrApproverRole("APPROVED")).toBeNull();
  });

  it("canApproveNextHr gates by role and TENANT_ADMIN override", () => {
    expect(canApproveNextHr("SUPERVISOR", "PENDING_L1_SUPERVISOR")).toBe(true);
    expect(canApproveNextHr("EMPLOYEE", "PENDING_L1_SUPERVISOR")).toBe(false);
    expect(canApproveNextHr("HR_ADMIN", "PENDING_HR_ADMIN")).toBe(true);
    expect(canApproveNextHr("TENANT_ADMIN", "PENDING_L3_OPERATIONS_MANAGER")).toBe(
      true,
    );
    expect(canApproveNextHr("TENANT_ADMIN", "APPROVED")).toBe(false);
  });

  it("isHrPending / isHrTerminal categorize the enum", () => {
    for (const s of HR_PENDING_STATUSES) {
      expect(isHrPending(s)).toBe(true);
      expect(isHrTerminal(s)).toBe(false);
    }
    expect(isHrTerminal("APPROVED")).toBe(true);
    expect(isHrTerminal("REJECTED")).toBe(true);
    expect(isHrTerminal("CANCELLED")).toBe(true);
  });

  it("HR_STATUS_APPROVER_ROLE covers every enum value", () => {
    expect(Object.keys(HR_STATUS_APPROVER_ROLE)).toHaveLength(8);
  });

  it("hrChainForKind returns the correct chain per kind", () => {
    expect(hrChainForKind("LEAVE")).toEqual([
      "PENDING_L1_SUPERVISOR",
      "PENDING_L2_PROJECT_MANAGER",
      "PENDING_L3_OPERATIONS_MANAGER",
      "PENDING_HR_ADMIN",
    ]);
    expect(hrChainForKind("OVERTIME")).toEqual([
      "PENDING_L1_SUPERVISOR",
      "PENDING_L2_PROJECT_MANAGER",
      "PENDING_L3_OPERATIONS_MANAGER",
      "PENDING_HR_ADMIN",
    ]);
    expect(hrChainForKind("SICK")).toEqual([
      "PENDING_L1_SUPERVISOR",
      "PENDING_HR_ADMIN",
    ]);
  });
});
