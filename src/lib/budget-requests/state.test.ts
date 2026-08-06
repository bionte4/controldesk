import { describe, expect, it } from "vitest";

import {
  APPROVAL_CONFIG,
} from "@/lib/rbac/roles";
import {
  BR_PENDING_STATUSES,
  BR_STATUSES,
  BR_STATUS_SLOT,
  BR_THRESHOLDS,
  brApprovalChain,
  brApproverSlot,
  brCanApprove,
  brFirstSlot,
  brFirstStatus,
  brPendingForRole,
  isBrPending,
  isBrTerminal,
  nextBrStatus,
  statusForSlot,
} from "./state";

const { PM_THRESHOLD, DIRECTOR_THRESHOLD } = APPROVAL_CONFIG.BUDGET_REQUEST;

describe("Budget Request chain resolver", () => {
  it("< PM threshold → [FINANCE] only", () => {
    const chain = brApprovalChain(PM_THRESHOLD - 1);
    expect(chain).toEqual(["FINANCE"]);
    expect(brFirstSlot(PM_THRESHOLD - 1)).toBe("FINANCE");
    expect(brFirstStatus(PM_THRESHOLD - 1)).toBe("PENDING_FINANCE");
  });

  it("= PM threshold → [PM, FINANCE]", () => {
    expect(brApprovalChain(PM_THRESHOLD)).toEqual(["PM", "FINANCE"]);
    expect(brFirstStatus(PM_THRESHOLD)).toBe("PENDING_PM");
  });

  it("= DIRECTOR threshold → [PM, FINANCE, DIRECTOR]", () => {
    expect(brApprovalChain(DIRECTOR_THRESHOLD)).toEqual([
      "PM",
      "FINANCE",
      "DIRECTOR",
    ]);
    expect(brFirstStatus(DIRECTOR_THRESHOLD)).toBe("PENDING_PM");
  });

  it("re-exports thresholds without divergence", () => {
    expect(BR_THRESHOLDS.PM_THRESHOLD).toBe(PM_THRESHOLD);
    expect(BR_THRESHOLDS.DIRECTOR_THRESHOLD).toBe(DIRECTOR_THRESHOLD);
  });
});

describe("Budget Request status enum bookkeeping", () => {
  it("BR_STATUSES covers exactly the 8 lifecycle states", () => {
    expect(BR_STATUSES).toEqual([
      "DRAFT",
      "PENDING_PM",
      "PENDING_FINANCE",
      "PENDING_DIRECTOR",
      "APPROVED",
      "APPLIED",
      "REJECTED",
      "CANCELLED",
    ]);
  });

  it("BR_PENDING_STATUSES is the 3 review states", () => {
    expect(BR_PENDING_STATUSES).toEqual([
      "PENDING_PM",
      "PENDING_FINANCE",
      "PENDING_DIRECTOR",
    ]);
  });

  it("isBrPending / isBrTerminal cover partitions correctly", () => {
    for (const s of BR_STATUSES) {
      const isPending = (BR_PENDING_STATUSES as readonly string[]).includes(s);
      expect(isBrPending(s)).toBe(isPending);
      expect(isBrTerminal(s)).toBe(
        s === "APPLIED" || s === "REJECTED" || s === "CANCELLED",
      );
    }
  });

  it("BR_STATUS_SLOT maps pending statuses to their slot only", () => {
    expect(BR_STATUS_SLOT.PENDING_PM).toBe("PM");
    expect(BR_STATUS_SLOT.PENDING_FINANCE).toBe("FINANCE");
    expect(BR_STATUS_SLOT.PENDING_DIRECTOR).toBe("DIRECTOR");
    expect(BR_STATUS_SLOT.DRAFT).toBeNull();
    expect(BR_STATUS_SLOT.APPROVED).toBeNull();
    expect(BR_STATUS_SLOT.APPLIED).toBeNull();
    expect(BR_STATUS_SLOT.REJECTED).toBeNull();
    expect(BR_STATUS_SLOT.CANCELLED).toBeNull();
  });

  it("statusForSlot throws on non-BR slots", () => {
    expect(() => statusForSlot("PM")).not.toThrow();
    expect(() => statusForSlot("FINANCE")).not.toThrow();
    expect(() => statusForSlot("DIRECTOR")).not.toThrow();
    expect(() => statusForSlot("SUPERVISOR")).toThrow();
    expect(() => statusForSlot("OM")).toThrow();
  });

  it("brApproverSlot mirrors BR_STATUS_SLOT", () => {
    expect(brApproverSlot("PENDING_PM")).toBe("PM");
    expect(brApproverSlot("APPROVED")).toBeNull();
  });
});

describe("nextBrStatus — SUBMIT paths", () => {
  it("small amount lands at PENDING_FINANCE", () => {
    expect(
      nextBrStatus({
        current: "DRAFT",
        amountIDR: 1_000_000,
        action: "SUBMIT",
      }),
    ).toBe("PENDING_FINANCE");
  });

  it("PM-tier amount lands at PENDING_PM", () => {
    expect(
      nextBrStatus({
        current: "DRAFT",
        amountIDR: PM_THRESHOLD,
        action: "SUBMIT",
      }),
    ).toBe("PENDING_PM");
  });

  it("Director-tier amount still starts at PENDING_PM", () => {
    expect(
      nextBrStatus({
        current: "DRAFT",
        amountIDR: DIRECTOR_THRESHOLD,
        action: "SUBMIT",
      }),
    ).toBe("PENDING_PM");
  });

  it("SUBMIT from non-DRAFT throws", () => {
    expect(() =>
      nextBrStatus({
        current: "PENDING_PM",
        amountIDR: 10_000_000,
        action: "SUBMIT",
      }),
    ).toThrow();
  });
});

describe("nextBrStatus — APPROVE chain progression", () => {
  it("PM approves at PM tier → FINANCE next", () => {
    expect(
      nextBrStatus({
        current: "PENDING_PM",
        amountIDR: PM_THRESHOLD,
        action: "APPROVE",
      }),
    ).toBe("PENDING_FINANCE");
  });

  it("PM approves at Director tier → FINANCE next", () => {
    expect(
      nextBrStatus({
        current: "PENDING_PM",
        amountIDR: DIRECTOR_THRESHOLD,
        action: "APPROVE",
      }),
    ).toBe("PENDING_FINANCE");
  });

  it("FINANCE_APPROVE at FINANCE (small amount, no Director) → APPROVED", () => {
    expect(
      nextBrStatus({
        current: "PENDING_FINANCE",
        amountIDR: 1_000_000,
        action: "FINANCE_APPROVE",
      }),
    ).toBe("APPROVED");
  });

  it("FINANCE_APPROVE at FINANCE (Director tier) → PENDING_DIRECTOR", () => {
    expect(
      nextBrStatus({
        current: "PENDING_FINANCE",
        amountIDR: DIRECTOR_THRESHOLD,
        action: "FINANCE_APPROVE",
      }),
    ).toBe("PENDING_DIRECTOR");
  });

  it("DIRECTOR approves → APPROVED", () => {
    expect(
      nextBrStatus({
        current: "PENDING_DIRECTOR",
        amountIDR: DIRECTOR_THRESHOLD,
        action: "APPROVE",
      }),
    ).toBe("APPROVED");
  });

  it("FINANCE_APPROVE outside FINANCE slot throws", () => {
    expect(() =>
      nextBrStatus({
        current: "PENDING_PM",
        amountIDR: PM_THRESHOLD,
        action: "FINANCE_APPROVE",
      }),
    ).toThrow();
  });

  it("APPROVE at FINANCE slot throws (must be FINANCE_APPROVE)", () => {
    expect(() =>
      nextBrStatus({
        current: "PENDING_FINANCE",
        amountIDR: 1_000_000,
        action: "APPROVE",
      }),
    ).toThrow();
  });

  it("APPROVE from non-pending status throws", () => {
    expect(() =>
      nextBrStatus({
        current: "APPROVED",
        amountIDR: 1_000_000,
        action: "APPROVE",
      }),
    ).toThrow();
  });
});

describe("nextBrStatus — REJECT / CANCEL paths", () => {
  it("REJECT from any pending status → REJECTED", () => {
    for (const s of BR_PENDING_STATUSES) {
      expect(
        nextBrStatus({
          current: s,
          amountIDR: 5_000_000,
          action: "REJECT",
        }),
      ).toBe("REJECTED");
    }
  });

  it("FINANCE_REJECT from PENDING_FINANCE → REJECTED", () => {
    expect(
      nextBrStatus({
        current: "PENDING_FINANCE",
        amountIDR: 1_000_000,
        action: "FINANCE_REJECT",
      }),
    ).toBe("REJECTED");
  });

  it("REJECT from non-pending status throws", () => {
    expect(() =>
      nextBrStatus({
        current: "APPROVED",
        amountIDR: 1_000_000,
        action: "REJECT",
      }),
    ).toThrow();
    expect(() =>
      nextBrStatus({
        current: "DRAFT",
        amountIDR: 1_000_000,
        action: "REJECT",
      }),
    ).toThrow();
  });

  it("CANCEL from DRAFT or any pending → CANCELLED", () => {
    for (const s of ["DRAFT", ...BR_PENDING_STATUSES] as const) {
      expect(
        nextBrStatus({
          current: s,
          amountIDR: 1_000_000,
          action: "CANCEL",
        }),
      ).toBe("CANCELLED");
    }
  });

  it("CANCEL from terminal status throws", () => {
    for (const s of ["APPLIED", "REJECTED", "CANCELLED"] as const) {
      expect(() =>
        nextBrStatus({
          current: s,
          amountIDR: 1_000_000,
          action: "CANCEL",
        }),
      ).toThrow();
    }
  });
});

describe("brCanApprove", () => {
  it("PM can approve PENDING_PM but not PENDING_FINANCE or PENDING_DIRECTOR", () => {
    expect(brCanApprove({ actorRole: "PM", current: "PENDING_PM" })).toBe(true);
    expect(brCanApprove({ actorRole: "PM", current: "PENDING_FINANCE" })).toBe(false);
    expect(brCanApprove({ actorRole: "PM", current: "PENDING_DIRECTOR" })).toBe(false);
  });

  it("FINANCE can approve only PENDING_FINANCE", () => {
    expect(brCanApprove({ actorRole: "FINANCE", current: "PENDING_FINANCE" })).toBe(true);
    expect(brCanApprove({ actorRole: "FINANCE", current: "PENDING_PM" })).toBe(false);
  });

  it("DIRECTOR can approve PM + Director slots but NOT Finance (Finance is a segregated gate — rules §9.7)", () => {
    expect(brCanApprove({ actorRole: "DIRECTOR", current: "PENDING_PM" })).toBe(true);
    // FINANCE gate is intentionally exclusive to segregate duty — even
    // DIRECTOR cannot short-circuit Finance sign-off.
    expect(brCanApprove({ actorRole: "DIRECTOR", current: "PENDING_FINANCE" })).toBe(false);
    expect(brCanApprove({ actorRole: "DIRECTOR", current: "PENDING_DIRECTOR" })).toBe(true);
  });

  it("ADMIN can approve any pending slot (override)", () => {
    for (const s of BR_PENDING_STATUSES) {
      expect(brCanApprove({ actorRole: "ADMIN", current: s })).toBe(true);
    }
  });

  it("Employee cannot approve any pending status", () => {
    for (const s of BR_PENDING_STATUSES) {
      expect(brCanApprove({ actorRole: "EMPLOYEE", current: s })).toBe(false);
    }
  });

  it("terminal statuses always reject approval", () => {
    for (const s of ["DRAFT", "APPROVED", "APPLIED", "REJECTED", "CANCELLED"] as const) {
      expect(brCanApprove({ actorRole: "DIRECTOR", current: s })).toBe(false);
    }
  });

  it("legacy PROJECT_MANAGER folds to canonical PM", () => {
    expect(
      brCanApprove({ actorRole: "PROJECT_MANAGER", current: "PENDING_PM" }),
    ).toBe(true);
  });
});

describe("brPendingForRole (approvals inbox filter)", () => {
  it("PM sees PENDING_PM + APPROVED", () => {
    expect(brPendingForRole("PM").sort()).toEqual(
      ["APPROVED", "PENDING_PM"].sort(),
    );
  });

  it("FINANCE sees PENDING_FINANCE + APPROVED (for APPLY)", () => {
    expect(brPendingForRole("FINANCE").sort()).toEqual(
      ["APPROVED", "PENDING_FINANCE"].sort(),
    );
  });

  it("DIRECTOR sees PENDING_PM + PENDING_DIRECTOR + APPROVED — but NOT PENDING_FINANCE (segregated duty)", () => {
    const out = brPendingForRole("DIRECTOR").sort();
    expect(out).toContain("PENDING_PM");
    expect(out).toContain("PENDING_DIRECTOR");
    expect(out).toContain("APPROVED");
    expect(out).not.toContain("PENDING_FINANCE");
  });

  it("OM sees PENDING_PM (as PM+ role) + APPROVED", () => {
    const out = brPendingForRole("OM").sort();
    expect(out).toContain("PENDING_PM");
    expect(out).toContain("APPROVED");
    expect(out).not.toContain("PENDING_FINANCE");
  });

  it("SUPERVISOR / EMPLOYEE see nothing", () => {
    expect(brPendingForRole("SUPERVISOR")).toEqual([]);
    expect(brPendingForRole("EMPLOYEE")).toEqual([]);
  });

  it("ADMIN sees all pending states + APPROVED", () => {
    const out = brPendingForRole("ADMIN").sort();
    expect(out).toEqual(
      [
        "PENDING_PM",
        "PENDING_FINANCE",
        "PENDING_DIRECTOR",
        "APPROVED",
      ].sort(),
    );
  });
});
