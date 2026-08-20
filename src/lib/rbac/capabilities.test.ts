import { describe, expect, it } from "vitest";

import {
  CAPABILITY_CATALOG,
  CAPABILITY_IDS,
  defaultRolesFor,
  getCapability,
  isCapabilityId,
  type CapabilityId,
} from "./capabilities";
import {
  BUDGET_VIEWER_ROLES,
  CLIENT_VIEWER_ROLES,
  CONTRACT_VIEWER_ROLES,
  EMPLOYEE_DIRECTORY_VIEWER_ROLES,
  HANDOVER_VIEWER_ROLES,
  INSIGHTS_VIEWER_ROLES,
  PAYROLL_VIEWER_ROLES,
  PERFORMANCE_VIEWER_ROLES,
  PETTY_CASH_VIEWER_ROLES,
  UPK_VIEWER_ROLES,
  ASSIGNMENT_VIEWER_ROLES,
} from "./roles";

describe("CAPABILITY_CATALOG", () => {
  it("has 12 distinct capabilities with unique ids", () => {
    expect(CAPABILITY_CATALOG.length).toBe(12);
    const ids = new Set(CAPABILITY_CATALOG.map((c) => c.id));
    expect(ids.size).toBe(CAPABILITY_CATALOG.length);
  });

  it("keeps CAPABILITY_IDS in sync with the catalog", () => {
    expect(CAPABILITY_IDS.length).toBe(CAPABILITY_CATALOG.length);
    for (const cap of CAPABILITY_CATALOG) {
      expect(CAPABILITY_IDS).toContain(cap.id);
    }
  });

  it("categorises every capability into one of the 4 buckets", () => {
    const validCategories = new Set([
      "finance",
      "hr",
      "operations",
      "strategy",
    ]);
    for (const cap of CAPABILITY_CATALOG) {
      expect(validCategories.has(cap.category)).toBe(true);
    }
  });

  // Regression pins — the whole point of the catalog is that it
  // *is* the source of truth for role gates. If a future refactor
  // changes a defaultRoles list, these tests fail loudly and force
  // the author to consider tenant fallout (existing overrides).
  const regressionCases: Array<{
    id: CapabilityId;
    legacy: readonly string[];
  }> = [
    { id: "view_budget", legacy: BUDGET_VIEWER_ROLES },
    { id: "view_contract", legacy: CONTRACT_VIEWER_ROLES },
    { id: "view_performance", legacy: PERFORMANCE_VIEWER_ROLES },
    { id: "view_payroll", legacy: PAYROLL_VIEWER_ROLES },
    { id: "view_employee_directory", legacy: EMPLOYEE_DIRECTORY_VIEWER_ROLES },
    { id: "view_petty_cash", legacy: PETTY_CASH_VIEWER_ROLES },
    { id: "view_upk", legacy: UPK_VIEWER_ROLES },
    { id: "view_client", legacy: CLIENT_VIEWER_ROLES },
    { id: "view_assignment", legacy: ASSIGNMENT_VIEWER_ROLES },
    { id: "view_handover", legacy: HANDOVER_VIEWER_ROLES },
    { id: "view_insights", legacy: INSIGHTS_VIEWER_ROLES },
  ];

  it.each(regressionCases)(
    "$id defaults match the legacy *_VIEWER_ROLES constant",
    ({ id, legacy }) => {
      const defaults = defaultRolesFor(id);
      expect(new Set(defaults)).toEqual(new Set(legacy));
    },
  );

  // `view_budget_amount` is stricter than `view_budget` (list access)
  // — PM/OM see the list but not the nominal figures. Pin the default
  // roles so a future admin refactor that grants PM this capability
  // is caught immediately (rules §3 / §9 audit trail sensitivity).
  it("view_budget_amount defaults to Finance-leader tier only", () => {
    const defaults = defaultRolesFor("view_budget_amount");
    expect(new Set(defaults)).toEqual(
      new Set([
        "HEAD_MANAGER",
        "GENERAL_MANAGER",
        "LEAD_FINANCE",
        "TENANT_ADMIN",
      ]),
    );
    // Must be a proper subset of view_budget — you can't have amount
    // access without list access by default.
    const listRoles = new Set(defaultRolesFor("view_budget"));
    for (const role of defaults) {
      expect(listRoles.has(role)).toBe(true);
    }
    // PM and OM are the two roles this capability was introduced to
    // exclude — pin them so tenant defaults never regress.
    expect(defaults).not.toContain("PROJECT_MANAGER");
    expect(defaults).not.toContain("OPERATIONS_MANAGER");
  });

  it("view_budget_amount is flagged high-sensitivity", () => {
    // Admins toggling this in the matrix should see the "are you sure?"
    // confirm dialog (rules §3) — pin the sensitivity so a future
    // catalog edit doesn't accidentally downgrade it.
    expect(getCapability("view_budget_amount").sensitivity).toBe("high");
  });
});

describe("isCapabilityId", () => {
  it("accepts every known capability id", () => {
    for (const id of CAPABILITY_IDS) {
      expect(isCapabilityId(id)).toBe(true);
    }
  });

  it("rejects unknown / malformed inputs", () => {
    expect(isCapabilityId("view_everything")).toBe(false);
    expect(isCapabilityId("")).toBe(false);
    expect(isCapabilityId(null)).toBe(false);
    expect(isCapabilityId(undefined)).toBe(false);
    expect(isCapabilityId(42)).toBe(false);
    expect(isCapabilityId({ id: "view_budget" })).toBe(false);
  });
});

describe("getCapability", () => {
  it("returns the descriptor for a known id", () => {
    const cap = getCapability("view_budget");
    expect(cap.id).toBe("view_budget");
    expect(cap.category).toBe("finance");
  });

  it("throws for an unknown id (misspell / stale reference)", () => {
    // @ts-expect-error deliberate bad input
    expect(() => getCapability("view_nothing")).toThrow(
      /Unknown capability id/,
    );
  });
});
