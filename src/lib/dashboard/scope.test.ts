import { describe, expect, it } from "vitest";

import { classifyDashboardScope, isApproverRole } from "./scope";

describe("classifyDashboardScope", () => {
  it("classifies executive + finance + HR roles as org-wide", () => {
    for (const role of [
      "TENANT_ADMIN",
      "ADMIN",
      "GENERAL_MANAGER",
      "DIRECTOR",
      "LEAD_FINANCE",
      "FINANCE",
      "HR_ADMIN",
    ] as const) {
      expect(classifyDashboardScope(role)).toBe("org");
    }
  });

  it("classifies OM / HM (legacy + canonical) as portfolio", () => {
    for (const role of [
      "HEAD_MANAGER",
      "OPERATIONS_MANAGER",
      "OM",
    ] as const) {
      expect(classifyDashboardScope(role)).toBe("portfolio");
    }
  });

  it("classifies PM / Supervisor / Employee / PCC as assigned", () => {
    for (const role of [
      "PROJECT_MANAGER",
      "PM",
      "SUPERVISOR",
      "EMPLOYEE",
      "PETTY_CASH_CUSTODIAN",
    ] as const) {
      expect(classifyDashboardScope(role)).toBe("assigned");
    }
  });

  it("does NOT elevate HEAD_MANAGER to org even though it canonical-folds to DIRECTOR", () => {
    // Regression pin: HEAD_MANAGER folds to canonical `DIRECTOR`
    // via `toCanonicalRole`. If we ever refactor the scope
    // classifier to key off canonical roles instead of DB values,
    // HM would incorrectly get org-wide visibility. This test
    // makes that regression fail fast.
    expect(classifyDashboardScope("HEAD_MANAGER")).toBe("portfolio");
    expect(classifyDashboardScope("HEAD_MANAGER")).not.toBe("org");
  });

  it("does NOT downgrade PETTY_CASH_CUSTODIAN to org even though it canonical-folds to FINANCE", () => {
    // Regression pin: canonical fold merges PCC + LEAD_FINANCE
    // into `FINANCE`. Custodians must remain project-scoped —
    // the `FINANCE` bucket for org visibility is reserved for
    // LEAD_FINANCE canonical FINANCE seat.
    expect(classifyDashboardScope("PETTY_CASH_CUSTODIAN")).toBe("assigned");
  });
});

describe("isApproverRole", () => {
  it("recognises every seat that appears in an approval chain", () => {
    for (const role of [
      "TENANT_ADMIN",
      "ADMIN",
      "GENERAL_MANAGER",
      "DIRECTOR",
      "HEAD_MANAGER",
      "OPERATIONS_MANAGER",
      "OM",
      "PROJECT_MANAGER",
      "PM",
      "LEAD_FINANCE",
      "FINANCE",
      "HR_ADMIN",
      "SUPERVISOR",
    ] as const) {
      expect(isApproverRole(role)).toBe(true);
    }
  });

  it("excludes non-approver seats", () => {
    for (const role of ["EMPLOYEE", "PETTY_CASH_CUSTODIAN"] as const) {
      expect(isApproverRole(role)).toBe(false);
    }
  });
});
