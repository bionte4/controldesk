import { describe, expect, it } from "vitest";

import {
  APPROVAL_CONFIG,
  caFieldOpsApprovalChain,
  caGeneralApprovalChain,
  type CanonicalApprovalSlot,
} from "@/lib/rbac/roles";
import {
  CANONICAL_CA_PENDING_STATUSES,
  CANONICAL_CA_STATUSES,
  CANONICAL_CA_STATUS_LABEL,
  CANONICAL_CA_STATUS_SLOT,
  CANONICAL_CA_STATUS_TONE,
  caCanonicalChain,
  caCanonicalThresholds,
  canonicalCaCanApprove,
  canonicalCaPendingForRole,
  canonicalCaStatusForSlot,
  firstSlotForType,
  isCanonicalCaPending,
  isCanonicalCaStatus,
  isCanonicalCaTerminal,
  nextCanonicalCaStatus,
} from "./state-canonical";

const GENERAL_PM = APPROVAL_CONFIG.CASH_ADVANCE_GENERAL.PM_THRESHOLD;
const GENERAL_DIR = APPROVAL_CONFIG.CASH_ADVANCE_GENERAL.DIRECTOR_THRESHOLD;
const FIELD_PM = APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.PM_THRESHOLD;
const FIELD_OM = APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.OM_THRESHOLD;
const FIELD_DIR = APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.DIRECTOR_THRESHOLD;

describe("CANONICAL_CA constants", () => {
  it("pending statuses subset of all statuses", () => {
    for (const s of CANONICAL_CA_PENDING_STATUSES) {
      expect(CANONICAL_CA_STATUSES).toContain(s);
    }
  });

  it("every canonical status has a label & tone", () => {
    for (const s of CANONICAL_CA_STATUSES) {
      expect(CANONICAL_CA_STATUS_LABEL[s]).toBeTruthy();
      expect(CANONICAL_CA_STATUS_TONE[s]).toBeTruthy();
    }
  });

  it("pending statuses map to non-null slots", () => {
    for (const s of CANONICAL_CA_PENDING_STATUSES) {
      expect(CANONICAL_CA_STATUS_SLOT[s]).not.toBeNull();
    }
  });

  it("non-pending statuses map to null slot", () => {
    const nonPending = (
      ["DRAFT", "APPROVED", "DISBURSED", "SETTLED", "REJECTED", "CANCELLED"] as const
    );
    for (const s of nonPending) {
      expect(CANONICAL_CA_STATUS_SLOT[s]).toBeNull();
    }
  });
});

describe("isCanonicalCaStatus / isCanonicalCaPending / isCanonicalCaTerminal", () => {
  it("recognises canonical statuses", () => {
    expect(isCanonicalCaStatus("PENDING_PM")).toBe(true);
    expect(isCanonicalCaStatus("PENDING_DIRECTOR")).toBe(true);
    expect(isCanonicalCaStatus("APPROVED")).toBe(true);
  });

  it("rejects legacy statuses", () => {
    expect(isCanonicalCaStatus("PENDING_L1_SUPERVISOR")).toBe(false);
    expect(isCanonicalCaStatus("PENDING_L2_5_FINANCE")).toBe(false);
  });

  it("isCanonicalCaPending flags only actionable states", () => {
    expect(isCanonicalCaPending("PENDING_SUPERVISOR")).toBe(true);
    expect(isCanonicalCaPending("PENDING_PM")).toBe(true);
    expect(isCanonicalCaPending("APPROVED")).toBe(false);
    expect(isCanonicalCaPending("DRAFT")).toBe(false);
    expect(isCanonicalCaPending("SETTLED")).toBe(false);
  });

  it("isCanonicalCaTerminal covers SETTLED / REJECTED / CANCELLED", () => {
    expect(isCanonicalCaTerminal("SETTLED")).toBe(true);
    expect(isCanonicalCaTerminal("REJECTED")).toBe(true);
    expect(isCanonicalCaTerminal("CANCELLED")).toBe(true);
    expect(isCanonicalCaTerminal("APPROVED")).toBe(false);
    expect(isCanonicalCaTerminal("DISBURSED")).toBe(false);
  });
});

describe("slot ↔ status conversion", () => {
  it("canonicalCaStatusForSlot returns the pending status", () => {
    expect(canonicalCaStatusForSlot("SUPERVISOR")).toBe("PENDING_SUPERVISOR");
    expect(canonicalCaStatusForSlot("PM")).toBe("PENDING_PM");
    expect(canonicalCaStatusForSlot("OM")).toBe("PENDING_OM");
    expect(canonicalCaStatusForSlot("FINANCE")).toBe("PENDING_FINANCE");
    expect(canonicalCaStatusForSlot("DIRECTOR")).toBe("PENDING_DIRECTOR");
  });
});

describe("caCanonicalChain / firstSlotForType", () => {
  it("GENERAL under PM threshold → FINANCE only", () => {
    const chain = caCanonicalChain({ type: "GENERAL", amountIDR: 100_000 });
    expect(chain).toEqual(["FINANCE"]);
    expect(firstSlotForType({ type: "GENERAL", amountIDR: 100_000 })).toBe(
      "FINANCE",
    );
  });

  it("GENERAL at PM threshold triggers PM slot", () => {
    const chain = caCanonicalChain({ type: "GENERAL", amountIDR: GENERAL_PM });
    expect(chain).toEqual(["PM", "FINANCE"]);
  });

  it("GENERAL at Director threshold triggers PM + FINANCE + DIRECTOR", () => {
    const chain = caCanonicalChain({
      type: "GENERAL",
      amountIDR: GENERAL_DIR,
    });
    expect(chain).toEqual(["PM", "FINANCE", "DIRECTOR"]);
  });

  it("FIELD_OPS always starts at SUPERVISOR", () => {
    const chain = caCanonicalChain({ type: "FIELD_OPS", amountIDR: 100_000 });
    expect(chain[0]).toBe("SUPERVISOR");
    expect(firstSlotForType({ type: "FIELD_OPS", amountIDR: 100_000 })).toBe(
      "SUPERVISOR",
    );
  });

  it("FIELD_OPS at OM threshold has PM + OM before FINANCE", () => {
    const chain = caCanonicalChain({
      type: "FIELD_OPS",
      amountIDR: FIELD_OM,
    });
    expect(chain).toEqual(["SUPERVISOR", "PM", "OM", "FINANCE"]);
  });

  it("FIELD_OPS at Director threshold picks up all slots", () => {
    const chain = caCanonicalChain({
      type: "FIELD_OPS",
      amountIDR: FIELD_DIR,
    });
    expect(chain).toEqual([
      "SUPERVISOR",
      "PM",
      "OM",
      "FINANCE",
      "DIRECTOR",
    ]);
  });

  it("mirrors caGeneralApprovalChain / caFieldOpsApprovalChain exactly", () => {
    // Sample a handful of amounts so any regression in `roles.ts` cascades
    // here immediately.
    for (const amt of [0, 1, GENERAL_PM, GENERAL_DIR, GENERAL_DIR + 1]) {
      expect(caCanonicalChain({ type: "GENERAL", amountIDR: amt })).toEqual(
        caGeneralApprovalChain(amt),
      );
    }
    for (const amt of [0, FIELD_PM, FIELD_OM, FIELD_DIR, FIELD_DIR + 1]) {
      expect(caCanonicalChain({ type: "FIELD_OPS", amountIDR: amt })).toEqual(
        caFieldOpsApprovalChain(amt),
      );
    }
  });
});

describe("nextCanonicalCaStatus — SUBMIT", () => {
  it("submits GENERAL small → PENDING_FINANCE", () => {
    expect(
      nextCanonicalCaStatus({
        type: "GENERAL",
        amountIDR: 100_000,
        current: "DRAFT",
        action: "SUBMIT",
      }),
    ).toBe("PENDING_FINANCE");
  });

  it("submits GENERAL at PM threshold → PENDING_PM", () => {
    expect(
      nextCanonicalCaStatus({
        type: "GENERAL",
        amountIDR: GENERAL_PM,
        current: "DRAFT",
        action: "SUBMIT",
      }),
    ).toBe("PENDING_PM");
  });

  it("submits FIELD_OPS → PENDING_SUPERVISOR", () => {
    expect(
      nextCanonicalCaStatus({
        type: "FIELD_OPS",
        amountIDR: 100_000,
        current: "DRAFT",
        action: "SUBMIT",
      }),
    ).toBe("PENDING_SUPERVISOR");
  });

  it("throws when SUBMIT from non-DRAFT", () => {
    expect(() =>
      nextCanonicalCaStatus({
        type: "GENERAL",
        amountIDR: 100_000,
        current: "PENDING_PM",
        action: "SUBMIT",
      }),
    ).toThrow(/DRAFT/);
  });
});

describe("nextCanonicalCaStatus — APPROVE happy paths", () => {
  it("GENERAL PM approves → FINANCE (PM chain)", () => {
    expect(
      nextCanonicalCaStatus({
        type: "GENERAL",
        amountIDR: GENERAL_PM,
        current: "PENDING_PM",
        action: "APPROVE",
      }),
    ).toBe("PENDING_FINANCE");
  });

  it("GENERAL Finance approves small → APPROVED", () => {
    expect(
      nextCanonicalCaStatus({
        type: "GENERAL",
        amountIDR: 100_000,
        current: "PENDING_FINANCE",
        action: "FINANCE_APPROVE",
      }),
    ).toBe("APPROVED");
  });

  it("GENERAL Finance approves ≥ Director threshold → PENDING_DIRECTOR", () => {
    expect(
      nextCanonicalCaStatus({
        type: "GENERAL",
        amountIDR: GENERAL_DIR,
        current: "PENDING_FINANCE",
        action: "FINANCE_APPROVE",
      }),
    ).toBe("PENDING_DIRECTOR");
  });

  it("GENERAL Director approves → APPROVED", () => {
    expect(
      nextCanonicalCaStatus({
        type: "GENERAL",
        amountIDR: GENERAL_DIR,
        current: "PENDING_DIRECTOR",
        action: "APPROVE",
      }),
    ).toBe("APPROVED");
  });

  it("FIELD_OPS full chain traversal", () => {
    const commonArgs = {
      type: "FIELD_OPS",
      amountIDR: FIELD_DIR,
    } as const;
    let cur = nextCanonicalCaStatus({
      ...commonArgs,
      current: "DRAFT",
      action: "SUBMIT",
    });
    expect(cur).toBe("PENDING_SUPERVISOR");
    cur = nextCanonicalCaStatus({
      ...commonArgs,
      current: cur,
      action: "APPROVE",
    });
    expect(cur).toBe("PENDING_PM");
    cur = nextCanonicalCaStatus({
      ...commonArgs,
      current: cur,
      action: "APPROVE",
    });
    expect(cur).toBe("PENDING_OM");
    cur = nextCanonicalCaStatus({
      ...commonArgs,
      current: cur,
      action: "APPROVE",
    });
    expect(cur).toBe("PENDING_FINANCE");
    cur = nextCanonicalCaStatus({
      ...commonArgs,
      current: cur,
      action: "FINANCE_APPROVE",
    });
    expect(cur).toBe("PENDING_DIRECTOR");
    cur = nextCanonicalCaStatus({
      ...commonArgs,
      current: cur,
      action: "APPROVE",
    });
    expect(cur).toBe("APPROVED");
  });

  it("FIELD_OPS small (below all thresholds) → SUPERVISOR → FINANCE → APPROVED", () => {
    let cur = nextCanonicalCaStatus({
      type: "FIELD_OPS",
      amountIDR: 50_000,
      current: "DRAFT",
      action: "SUBMIT",
    });
    expect(cur).toBe("PENDING_SUPERVISOR");
    cur = nextCanonicalCaStatus({
      type: "FIELD_OPS",
      amountIDR: 50_000,
      current: cur,
      action: "APPROVE",
    });
    expect(cur).toBe("PENDING_FINANCE");
    cur = nextCanonicalCaStatus({
      type: "FIELD_OPS",
      amountIDR: 50_000,
      current: cur,
      action: "FINANCE_APPROVE",
    });
    expect(cur).toBe("APPROVED");
  });
});

describe("nextCanonicalCaStatus — REJECT / CANCEL", () => {
  it("REJECT from any pending → REJECTED", () => {
    for (const s of CANONICAL_CA_PENDING_STATUSES) {
      expect(
        nextCanonicalCaStatus({
          type: "GENERAL",
          amountIDR: 100_000,
          current: s,
          action: "REJECT",
        }),
      ).toBe("REJECTED");
    }
  });

  it("FINANCE_REJECT works at any pending too (canonical actor may fold)", () => {
    expect(
      nextCanonicalCaStatus({
        type: "GENERAL",
        amountIDR: 100_000,
        current: "PENDING_FINANCE",
        action: "FINANCE_REJECT",
      }),
    ).toBe("REJECTED");
  });

  it("REJECT throws from non-pending", () => {
    expect(() =>
      nextCanonicalCaStatus({
        type: "GENERAL",
        amountIDR: 100_000,
        current: "DRAFT",
        action: "REJECT",
      }),
    ).toThrow(/non-pending/);
  });

  it("CANCEL from open states → CANCELLED", () => {
    expect(
      nextCanonicalCaStatus({
        type: "GENERAL",
        amountIDR: 100_000,
        current: "PENDING_PM",
        action: "CANCEL",
      }),
    ).toBe("CANCELLED");
    expect(
      nextCanonicalCaStatus({
        type: "GENERAL",
        amountIDR: 100_000,
        current: "DRAFT",
        action: "CANCEL",
      }),
    ).toBe("CANCELLED");
  });

  it("CANCEL throws for terminal statuses", () => {
    expect(() =>
      nextCanonicalCaStatus({
        type: "GENERAL",
        amountIDR: 100_000,
        current: "SETTLED",
        action: "CANCEL",
      }),
    ).toThrow(/terminal/);
    expect(() =>
      nextCanonicalCaStatus({
        type: "GENERAL",
        amountIDR: 100_000,
        current: "CANCELLED",
        action: "CANCEL",
      }),
    ).toThrow(/terminal/);
  });
});

describe("nextCanonicalCaStatus — action shape guards", () => {
  it("FINANCE_APPROVE outside FINANCE slot throws", () => {
    expect(() =>
      nextCanonicalCaStatus({
        type: "GENERAL",
        amountIDR: GENERAL_PM,
        current: "PENDING_PM",
        action: "FINANCE_APPROVE",
      }),
    ).toThrow(/FINANCE_APPROVE only valid at FINANCE slot/);
  });

  it("APPROVE at FINANCE slot throws — must use FINANCE_APPROVE", () => {
    expect(() =>
      nextCanonicalCaStatus({
        type: "GENERAL",
        amountIDR: 100_000,
        current: "PENDING_FINANCE",
        action: "APPROVE",
      }),
    ).toThrow(/FINANCE_APPROVE at the FINANCE slot/);
  });

  it("APPROVE from non-pending throws", () => {
    expect(() =>
      nextCanonicalCaStatus({
        type: "GENERAL",
        amountIDR: 100_000,
        current: "APPROVED",
        action: "APPROVE",
      }),
    ).toThrow(/non-pending/);
  });
});

describe("canonicalCaCanApprove", () => {
  it("PM can approve PENDING_PM", () => {
    expect(
      canonicalCaCanApprove({
        actorRole: "PROJECT_MANAGER",
        current: "PENDING_PM",
      }),
    ).toBe(true);
  });

  it("EMPLOYEE cannot approve any pending", () => {
    for (const s of CANONICAL_CA_PENDING_STATUSES) {
      expect(
        canonicalCaCanApprove({ actorRole: "EMPLOYEE", current: s }),
      ).toBe(false);
    }
  });

  it("DIRECTOR can approve any operational rung (short-circuit)", () => {
    // DIRECTOR gate: DIRECTOR only. PM slot: PM/OM/DIRECTOR. OM slot: OM/DIRECTOR.
    expect(
      canonicalCaCanApprove({
        actorRole: "DIRECTOR",
        current: "PENDING_PM",
      }),
    ).toBe(true);
    expect(
      canonicalCaCanApprove({
        actorRole: "DIRECTOR",
        current: "PENDING_OM",
      }),
    ).toBe(true);
    expect(
      canonicalCaCanApprove({
        actorRole: "DIRECTOR",
        current: "PENDING_DIRECTOR",
      }),
    ).toBe(true);
  });

  it("DIRECTOR cannot fold into FINANCE slot (parallel gate)", () => {
    expect(
      canonicalCaCanApprove({
        actorRole: "DIRECTOR",
        current: "PENDING_FINANCE",
      }),
    ).toBe(false);
  });

  it("FINANCE only approves FINANCE slot", () => {
    expect(
      canonicalCaCanApprove({
        actorRole: "LEAD_FINANCE",
        current: "PENDING_FINANCE",
      }),
    ).toBe(true);
    expect(
      canonicalCaCanApprove({
        actorRole: "LEAD_FINANCE",
        current: "PENDING_PM",
      }),
    ).toBe(false);
  });

  it("ADMIN approves everything", () => {
    for (const s of CANONICAL_CA_PENDING_STATUSES) {
      expect(
        canonicalCaCanApprove({ actorRole: "TENANT_ADMIN", current: s }),
      ).toBe(true);
    }
  });

  it("returns false for non-canonical status", () => {
    expect(
      canonicalCaCanApprove({
        actorRole: "TENANT_ADMIN",
        current: "PENDING_L1_SUPERVISOR",
      }),
    ).toBe(false);
  });
});

describe("canonicalCaPendingForRole", () => {
  it("PM sees PENDING_PM only among canonical CA statuses", () => {
    const result = canonicalCaPendingForRole("PROJECT_MANAGER");
    expect(result).toContain("PENDING_PM");
    // PM can also decide on SUPERVISOR slot (short-circuit via canonicalCanApprove).
    expect(result).toContain("PENDING_SUPERVISOR");
    expect(result).not.toContain("PENDING_FINANCE");
    expect(result).not.toContain("PENDING_DIRECTOR");
  });

  it("OM sees SUPERVISOR / PM / OM (fold)", () => {
    const result = canonicalCaPendingForRole("OPERATIONS_MANAGER");
    expect(new Set(result)).toEqual(
      new Set(["PENDING_SUPERVISOR", "PENDING_PM", "PENDING_OM"]),
    );
  });

  it("DIRECTOR sees SUPERVISOR / PM / OM / DIRECTOR (not FINANCE)", () => {
    const result = canonicalCaPendingForRole("GENERAL_MANAGER");
    expect(new Set(result)).toEqual(
      new Set([
        "PENDING_SUPERVISOR",
        "PENDING_PM",
        "PENDING_OM",
        "PENDING_DIRECTOR",
      ]),
    );
  });

  it("FINANCE sees only PENDING_FINANCE", () => {
    expect(canonicalCaPendingForRole("LEAD_FINANCE")).toEqual([
      "PENDING_FINANCE",
    ]);
  });

  it("EMPLOYEE sees no pending", () => {
    expect(canonicalCaPendingForRole("EMPLOYEE")).toEqual([]);
  });

  it("ADMIN sees every pending status", () => {
    expect(new Set(canonicalCaPendingForRole("TENANT_ADMIN"))).toEqual(
      new Set(CANONICAL_CA_PENDING_STATUSES),
    );
  });
});

describe("caCanonicalThresholds", () => {
  it("GENERAL exposes PM + DIRECTOR only", () => {
    const t = caCanonicalThresholds("GENERAL");
    expect(t.PM_THRESHOLD).toBe(GENERAL_PM);
    expect(t.DIRECTOR_THRESHOLD).toBe(GENERAL_DIR);
    expect("OM_THRESHOLD" in t && (t as { OM_THRESHOLD?: number }).OM_THRESHOLD)
      .toBeFalsy();
  });

  it("FIELD_OPS exposes PM + OM + DIRECTOR", () => {
    const t = caCanonicalThresholds("FIELD_OPS");
    expect(t.PM_THRESHOLD).toBe(FIELD_PM);
    expect(t.OM_THRESHOLD).toBe(FIELD_OM);
    expect(t.DIRECTOR_THRESHOLD).toBe(FIELD_DIR);
  });
});

// Referenced above so linter doesn't complain about unused imports.
const _slots: readonly CanonicalApprovalSlot[] = [
  "PM",
  "OM",
  "SUPERVISOR",
  "FINANCE",
  "DIRECTOR",
];
void _slots;
