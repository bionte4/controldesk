import { describe, expect, it } from "vitest";

import {
  APPROVAL_CONFIG,
  APPROVAL_THRESHOLDS_IDR,
  budgetApprovalChain,
  budgetRequestApprovalChain,
  CANONICAL_ROLES,
  caFieldOpsApprovalChain,
  caGeneralApprovalChain,
  canApproveThreshold,
  canonicalCanApprove,
  EMPLOYEE_ROLES,
  expenseApprovalChain,
  formatRole,
  isOperationalRole,
  isStaffRole,
  MULTI_PROJECT_CANONICAL_ROLES,
  OPERATIONAL_LADDER,
  pettyCashDecision,
  requiredApprovalChain,
  requiresFinanceApproval,
  roleRank,
  toCanonicalRole,
  toLegacyDbRole,
} from "@/lib/rbac/roles";

describe("rbac/roles — rank & classification", () => {
  it("assigns every enum value a stable position", () => {
    // Sanity: no duplicates, and every listed enum is a valid role.
    const seen = new Set(EMPLOYEE_ROLES);
    expect(seen.size).toBe(EMPLOYEE_ROLES.length);
  });

  it("ranks operational roles in ascending order", () => {
    expect(roleRank("EMPLOYEE")).toBeLessThan(roleRank("SUPERVISOR"));
    expect(roleRank("SUPERVISOR")).toBeLessThan(roleRank("PROJECT_MANAGER"));
    expect(roleRank("PROJECT_MANAGER")).toBeLessThan(
      roleRank("OPERATIONS_MANAGER"),
    );
    expect(roleRank("OPERATIONS_MANAGER")).toBeLessThan(
      roleRank("HEAD_MANAGER"),
    );
    expect(roleRank("HEAD_MANAGER")).toBeLessThan(roleRank("GENERAL_MANAGER"));
    expect(roleRank("GENERAL_MANAGER")).toBeLessThan(roleRank("TENANT_ADMIN"));
  });

  it("returns -1 for staff roles (they are gatekeepers, not escalation targets)", () => {
    expect(roleRank("LEAD_FINANCE")).toBe(-1);
    expect(roleRank("HR_ADMIN")).toBe(-1);
    expect(roleRank("PETTY_CASH_CUSTODIAN")).toBe(-1);
  });

  it("classifies staff vs operational roles", () => {
    expect(isStaffRole("LEAD_FINANCE")).toBe(true);
    expect(isStaffRole("HR_ADMIN")).toBe(true);
    expect(isStaffRole("PETTY_CASH_CUSTODIAN")).toBe(true);
    expect(isStaffRole("PROJECT_MANAGER")).toBe(false);

    expect(isOperationalRole("PROJECT_MANAGER")).toBe(true);
    expect(isOperationalRole("EMPLOYEE")).toBe(true);
    expect(isOperationalRole("LEAD_FINANCE")).toBe(false);
  });

  it("operational ladder contains only operational roles", () => {
    for (const r of OPERATIONAL_LADDER) {
      expect(isStaffRole(r)).toBe(false);
    }
  });
});

describe("rbac/roles — threshold matrix (rules §9)", () => {
  it("small amount (< 5M) tops out at L2 PROJECT_MANAGER", () => {
    const chain = requiredApprovalChain(2_000_000);
    expect(chain).toEqual(["L1_SUPERVISOR", "L2_PROJECT_MANAGER"]);
  });

  it("amount at exactly 5M is still L2 (boundary is inclusive of L2)", () => {
    const chain = requiredApprovalChain(APPROVAL_THRESHOLDS_IDR.L2_PROJECT_MANAGER);
    expect(chain).toEqual(["L1_SUPERVISOR", "L2_PROJECT_MANAGER"]);
  });

  it("just above 5M escalates to L3 OPERATIONS_MANAGER", () => {
    const chain = requiredApprovalChain(
      APPROVAL_THRESHOLDS_IDR.L2_PROJECT_MANAGER + 1,
    );
    expect(chain.at(-1)).toBe("L3_OPERATIONS_MANAGER");
  });

  it("just above 25M escalates to L4 HEAD_MANAGER", () => {
    const chain = requiredApprovalChain(
      APPROVAL_THRESHOLDS_IDR.L3_OPERATIONS_MANAGER + 1,
    );
    expect(chain.at(-1)).toBe("L4_HEAD_MANAGER");
  });

  it("above 100M escalates all the way to L5 GENERAL_MANAGER", () => {
    const chain = requiredApprovalChain(200_000_000);
    expect(chain.at(-1)).toBe("L5_GENERAL_MANAGER");
    expect(chain).toEqual([
      "L1_SUPERVISOR",
      "L2_PROJECT_MANAGER",
      "L3_OPERATIONS_MANAGER",
      "L4_HEAD_MANAGER",
      "L5_GENERAL_MANAGER",
    ]);
  });

  it("finance approval is always required regardless of amount", () => {
    expect(requiresFinanceApproval(0)).toBe(true);
    expect(requiresFinanceApproval(999_999_999_999)).toBe(true);
  });
});

describe("rbac/roles — canApproveThreshold", () => {
  it("TENANT_ADMIN short-circuits to true at any amount", () => {
    expect(canApproveThreshold("TENANT_ADMIN", 999_999_999_999)).toBe(true);
  });

  it("PROJECT_MANAGER can approve below 5M but not above", () => {
    expect(canApproveThreshold("PROJECT_MANAGER", 2_000_000)).toBe(true);
    expect(canApproveThreshold("PROJECT_MANAGER", 10_000_000)).toBe(false);
  });

  it("OPERATIONS_MANAGER can approve 5M–25M but not above", () => {
    expect(canApproveThreshold("OPERATIONS_MANAGER", 10_000_000)).toBe(true);
    expect(canApproveThreshold("OPERATIONS_MANAGER", 50_000_000)).toBe(false);
  });

  it("HEAD_MANAGER can approve up to 100M", () => {
    expect(canApproveThreshold("HEAD_MANAGER", 50_000_000)).toBe(true);
    expect(canApproveThreshold("HEAD_MANAGER", 150_000_000)).toBe(false);
  });

  it("GENERAL_MANAGER can approve any bracket", () => {
    expect(canApproveThreshold("GENERAL_MANAGER", 999_000_000)).toBe(true);
  });

  it("EMPLOYEE cannot approve anything (rank below any threshold)", () => {
    expect(canApproveThreshold("EMPLOYEE", 1_000_000)).toBe(false);
  });

  it("staff roles cannot approve on the operational chain", () => {
    // LEAD_FINANCE goes through the parallel gate, not the operational chain;
    // canApproveThreshold checks operational rank only.
    expect(canApproveThreshold("LEAD_FINANCE", 1_000_000)).toBe(false);
    expect(canApproveThreshold("HR_ADMIN", 1_000_000)).toBe(false);
  });
});

describe("rbac/roles — formatRole", () => {
  it("returns a friendly label for every enum value", () => {
    for (const r of EMPLOYEE_ROLES) {
      const label = formatRole(r);
      expect(label).toBeTruthy();
      expect(typeof label).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// GAS-ALIGNED CANONICAL ROLE TESTS (Fase 0 — rules §6 rewrite).
// ---------------------------------------------------------------------------

describe("rbac/roles — canonical role model", () => {
  it("exposes exactly 7 canonical roles", () => {
    expect(CANONICAL_ROLES).toHaveLength(7);
    expect(new Set(CANONICAL_ROLES).size).toBe(7);
  });

  it("legacy → canonical mapping folds the BPO 10-role space onto 7", () => {
    expect(toCanonicalRole("TENANT_ADMIN")).toBe("ADMIN");
    expect(toCanonicalRole("HR_ADMIN")).toBe("ADMIN");

    expect(toCanonicalRole("GENERAL_MANAGER")).toBe("DIRECTOR");
    expect(toCanonicalRole("HEAD_MANAGER")).toBe("DIRECTOR");

    expect(toCanonicalRole("LEAD_FINANCE")).toBe("FINANCE");
    expect(toCanonicalRole("PETTY_CASH_CUSTODIAN")).toBe("FINANCE");

    expect(toCanonicalRole("OPERATIONS_MANAGER")).toBe("OM");
    expect(toCanonicalRole("PROJECT_MANAGER")).toBe("PM");
    expect(toCanonicalRole("SUPERVISOR")).toBe("SUPERVISOR");
    expect(toCanonicalRole("EMPLOYEE")).toBe("EMPLOYEE");
  });

  it("canonical → legacy mapping is stable and deterministic", () => {
    expect(toLegacyDbRole("ADMIN")).toBe("TENANT_ADMIN");
    expect(toLegacyDbRole("DIRECTOR")).toBe("GENERAL_MANAGER");
    expect(toLegacyDbRole("FINANCE")).toBe("LEAD_FINANCE");
    expect(toLegacyDbRole("OM")).toBe("OPERATIONS_MANAGER");
    expect(toLegacyDbRole("PM")).toBe("PROJECT_MANAGER");
    expect(toLegacyDbRole("SUPERVISOR")).toBe("SUPERVISOR");
    expect(toLegacyDbRole("EMPLOYEE")).toBe("EMPLOYEE");
  });

  it("PM and OM are the only multi-project canonical roles", () => {
    expect([...MULTI_PROJECT_CANONICAL_ROLES].sort()).toEqual(["OM", "PM"]);
  });
});

describe("rbac/roles — Expense chain (GAS §9.1)", () => {
  it("under 5M lands on Finance-only", () => {
    expect(expenseApprovalChain(1_000_000)).toEqual(["FINANCE"]);
    expect(expenseApprovalChain(4_999_999)).toEqual(["FINANCE"]);
  });

  it("at 5M inclusive triggers PM slot", () => {
    expect(expenseApprovalChain(APPROVAL_CONFIG.EXPENSE.PM_THRESHOLD))
      .toEqual(["PM", "FINANCE"]);
  });

  it("between 5M and 50M is PM → Finance", () => {
    expect(expenseApprovalChain(25_000_000)).toEqual(["PM", "FINANCE"]);
  });

  it("at 50M inclusive triggers Director slot", () => {
    expect(expenseApprovalChain(APPROVAL_CONFIG.EXPENSE.DIRECTOR_THRESHOLD))
      .toEqual(["PM", "FINANCE", "DIRECTOR"]);
  });

  it("above 50M escalates all the way", () => {
    expect(expenseApprovalChain(150_000_000)).toEqual(["PM", "FINANCE", "DIRECTOR"]);
  });
});

describe("rbac/roles — Budget chain (GAS §9.2)", () => {
  it("small totalPlanned needs Finance only", () => {
    expect(budgetApprovalChain(10_000_000)).toEqual(["FINANCE"]);
  });

  it("totalPlanned ≥ 50M needs Director", () => {
    expect(budgetApprovalChain(APPROVAL_CONFIG.BUDGET.DIRECTOR_THRESHOLD))
      .toEqual(["FINANCE", "DIRECTOR"]);
  });
});

describe("rbac/roles — Cash Advance General chain (GAS §9.3)", () => {
  it("under 2M is Finance only", () => {
    expect(caGeneralApprovalChain(500_000)).toEqual(["FINANCE"]);
  });

  it("2M–20M is PM → Finance", () => {
    expect(caGeneralApprovalChain(2_000_000)).toEqual(["PM", "FINANCE"]);
    expect(caGeneralApprovalChain(15_000_000)).toEqual(["PM", "FINANCE"]);
  });

  it("above 20M is PM → Finance → Director", () => {
    expect(caGeneralApprovalChain(20_000_000)).toEqual(["PM", "FINANCE", "DIRECTOR"]);
    expect(caGeneralApprovalChain(75_000_000)).toEqual(["PM", "FINANCE", "DIRECTOR"]);
  });
});

describe("rbac/roles — Cash Advance Field Ops chain (GAS §9.4)", () => {
  it("Supervisor always at rung 0, Finance always in chain", () => {
    const chain = caFieldOpsApprovalChain(500_000);
    expect(chain[0]).toBe("SUPERVISOR");
    expect(chain).toContain("FINANCE");
  });

  it("under 5M: Supervisor → Finance (PM/OM skipped)", () => {
    expect(caFieldOpsApprovalChain(1_000_000)).toEqual(["SUPERVISOR", "FINANCE"]);
  });

  it("at 5M: adds PM slot", () => {
    expect(caFieldOpsApprovalChain(5_000_000))
      .toEqual(["SUPERVISOR", "PM", "FINANCE"]);
  });

  it("at 20M: adds OM slot", () => {
    expect(caFieldOpsApprovalChain(20_000_000))
      .toEqual(["SUPERVISOR", "PM", "OM", "FINANCE"]);
  });

  it("at 50M: adds Director slot (full chain)", () => {
    expect(caFieldOpsApprovalChain(50_000_000))
      .toEqual(["SUPERVISOR", "PM", "OM", "FINANCE", "DIRECTOR"]);
  });
});

describe("rbac/roles — Budget Request chain (GAS §9.6)", () => {
  it("mirrors the Expense threshold ladder", () => {
    expect(budgetRequestApprovalChain(1_000_000)).toEqual(["FINANCE"]);
    expect(budgetRequestApprovalChain(5_000_000)).toEqual(["PM", "FINANCE"]);
    expect(budgetRequestApprovalChain(50_000_000))
      .toEqual(["PM", "FINANCE", "DIRECTOR"]);
  });
});

describe("rbac/roles — Petty Cash decision (GAS §10)", () => {
  it("under 200K auto-approves", () => {
    expect(pettyCashDecision(50_000)).toEqual({ kind: "AUTO_APPROVE" });
    expect(pettyCashDecision(199_999)).toEqual({ kind: "AUTO_APPROVE" });
  });

  it("200K–2M requires Finance approval; receipt required at ≥100K", () => {
    expect(pettyCashDecision(200_000)).toEqual({
      kind: "FINANCE_APPROVAL_REQUIRED",
      requiresReceipt: true,
    });
    expect(pettyCashDecision(1_500_000)).toEqual({
      kind: "FINANCE_APPROVAL_REQUIRED",
      requiresReceipt: true,
    });
  });

  it("above 2M ceiling redirects to Expense flow", () => {
    expect(pettyCashDecision(2_500_000)).toEqual({
      kind: "ABOVE_CEILING",
      useExpenseFlowInstead: true,
    });
  });
});

describe("rbac/roles — chain builders with custom thresholds (Option B)", () => {
  // Every builder accepts an optional 2nd argument for per-tenant tuning.
  // Below we push each builder off the frozen APPROVAL_CONFIG defaults to
  // prove the override lands — and that omitting the arg keeps the legacy
  // path intact (already covered above, so we only pin the override path).

  it("Expense: lowered PM threshold routes 2M into PM slot", () => {
    // Default PM=5M — 2M is Finance-only. With override PM=1M, 2M crosses.
    expect(
      expenseApprovalChain(2_000_000, {
        PM_THRESHOLD: 1_000_000,
        DIRECTOR_THRESHOLD: 50_000_000,
      }),
    ).toEqual(["PM", "FINANCE"]);
  });

  it("Expense: raised Director threshold prevents escalation at default 50M", () => {
    expect(
      expenseApprovalChain(50_000_000, {
        PM_THRESHOLD: 5_000_000,
        DIRECTOR_THRESHOLD: 100_000_000,
      }),
    ).toEqual(["PM", "FINANCE"]);
  });

  it("Budget: custom Director threshold governs the escalation gate", () => {
    // Push Director down to 10M — 10M inclusive now escalates.
    expect(budgetApprovalChain(10_000_000, { DIRECTOR_THRESHOLD: 10_000_000 }))
      .toEqual(["FINANCE", "DIRECTOR"]);
    // Push Director up to 200M — same 10M stays Finance-only.
    expect(budgetApprovalChain(10_000_000, { DIRECTOR_THRESHOLD: 200_000_000 }))
      .toEqual(["FINANCE"]);
  });

  it("CA General: override lets tenant tighten the PM slot to 500K", () => {
    expect(
      caGeneralApprovalChain(500_000, {
        PM_THRESHOLD: 500_000,
        DIRECTOR_THRESHOLD: 20_000_000,
      }),
    ).toEqual(["PM", "FINANCE"]);
  });

  it("CA Field Ops: OM slot honours the override even when PM/Director stay default", () => {
    const chain = caFieldOpsApprovalChain(10_000_000, {
      PM_THRESHOLD: 5_000_000,
      OM_THRESHOLD: 10_000_000,
      DIRECTOR_THRESHOLD: 50_000_000,
    });
    // At 10M with OM=10M the OM slot must be present; PM already crossed.
    expect(chain).toEqual(["SUPERVISOR", "PM", "OM", "FINANCE"]);
  });

  it("Budget Request: symmetric to Expense — override routes correctly", () => {
    expect(
      budgetRequestApprovalChain(500_000, {
        PM_THRESHOLD: 100_000,
        DIRECTOR_THRESHOLD: 50_000_000,
      }),
    ).toEqual(["PM", "FINANCE"]);
  });

  it("Petty Cash: raised HARD_CEILING extends the flow ceiling", () => {
    // Default HARD_CEILING=2M — 2.5M would redirect to Expense flow. With
    // override 5M, 2.5M stays within petty-cash Finance approval.
    expect(
      pettyCashDecision(2_500_000, {
        AUTO_APPROVE_BELOW: 200_000,
        RECEIPT_REQUIRED_ABOVE: 100_000,
        HARD_CEILING: 5_000_000,
      }),
    ).toEqual({ kind: "FINANCE_APPROVAL_REQUIRED", requiresReceipt: true });
  });

  it("Petty Cash: lowered AUTO_APPROVE_BELOW forces approval on 100K", () => {
    // Default 200K auto-approves 100K. With override 50K, 100K must go to
    // Finance approval.
    expect(
      pettyCashDecision(100_000, {
        AUTO_APPROVE_BELOW: 50_000,
        RECEIPT_REQUIRED_ABOVE: 100_000,
        HARD_CEILING: 2_000_000,
      }),
    ).toEqual({ kind: "FINANCE_APPROVAL_REQUIRED", requiresReceipt: true });
  });

  it("all builders remain callable without arguments (backward compat)", () => {
    // The regression this pins: TypeScript signature change from
    // `(amount)` to `(amount, thresholds?)` must remain compatible with
    // every legacy call site in the codebase.
    expect(expenseApprovalChain(5_000_000)).toEqual(["PM", "FINANCE"]);
    expect(budgetApprovalChain(50_000_000)).toEqual(["FINANCE", "DIRECTOR"]);
    expect(caGeneralApprovalChain(2_000_000)).toEqual(["PM", "FINANCE"]);
    expect(caFieldOpsApprovalChain(5_000_000)).toEqual([
      "SUPERVISOR",
      "PM",
      "FINANCE",
    ]);
    expect(budgetRequestApprovalChain(5_000_000)).toEqual(["PM", "FINANCE"]);
    expect(pettyCashDecision(1_000_000)).toEqual({
      kind: "FINANCE_APPROVAL_REQUIRED",
      requiresReceipt: true,
    });
  });
});

describe("rbac/roles — canonicalCanApprove", () => {
  it("ADMIN short-circuits every slot", () => {
    for (const slot of ["SUPERVISOR", "PM", "OM", "FINANCE", "DIRECTOR"] as const) {
      expect(canonicalCanApprove("ADMIN", slot)).toBe(true);
    }
  });

  it("FINANCE slot is finance-only (managers cannot take over)", () => {
    expect(canonicalCanApprove("FINANCE", "FINANCE")).toBe(true);
    expect(canonicalCanApprove("PM", "FINANCE")).toBe(false);
    expect(canonicalCanApprove("DIRECTOR", "FINANCE")).toBe(false);
    // Only ADMIN and FINANCE itself may act on the finance parallel gate.
  });

  it("PM slot allows PM, OM, Director (higher rank short-circuit)", () => {
    expect(canonicalCanApprove("PM", "PM")).toBe(true);
    expect(canonicalCanApprove("OM", "PM")).toBe(true);
    expect(canonicalCanApprove("DIRECTOR", "PM")).toBe(true);
    expect(canonicalCanApprove("EMPLOYEE", "PM")).toBe(false);
    expect(canonicalCanApprove("SUPERVISOR", "PM")).toBe(false);
  });

  it("DIRECTOR slot is Director-only (plus ADMIN)", () => {
    expect(canonicalCanApprove("DIRECTOR", "DIRECTOR")).toBe(true);
    expect(canonicalCanApprove("OM", "DIRECTOR")).toBe(false);
  });

  it("SUPERVISOR slot is Supervisor+", () => {
    expect(canonicalCanApprove("SUPERVISOR", "SUPERVISOR")).toBe(true);
    expect(canonicalCanApprove("EMPLOYEE", "SUPERVISOR")).toBe(false);
    expect(canonicalCanApprove("PM", "SUPERVISOR")).toBe(true);
  });
});
