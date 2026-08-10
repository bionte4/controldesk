import { describe, expect, it } from "vitest";

import {
  buildApproverOrSelfClause,
  classifyProjectScope,
  isApproverRole,
} from "./project-scope";

describe("classifyProjectScope", () => {
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
      expect(classifyProjectScope(role)).toBe("org");
    }
  });

  it("classifies OM / HM (legacy + canonical) as portfolio", () => {
    for (const role of [
      "HEAD_MANAGER",
      "OPERATIONS_MANAGER",
      "OM",
    ] as const) {
      expect(classifyProjectScope(role)).toBe("portfolio");
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
      expect(classifyProjectScope(role)).toBe("assigned");
    }
  });

  it("does NOT elevate HEAD_MANAGER to org even though it canonical-folds to DIRECTOR", () => {
    // Regression pin: HEAD_MANAGER folds to canonical `DIRECTOR`
    // via `toCanonicalRole`. If we ever refactor the scope
    // classifier to key off canonical roles instead of DB values,
    // HM would incorrectly get org-wide visibility. This test
    // makes that regression fail fast.
    expect(classifyProjectScope("HEAD_MANAGER")).toBe("portfolio");
    expect(classifyProjectScope("HEAD_MANAGER")).not.toBe("org");
  });

  it("does NOT downgrade PETTY_CASH_CUSTODIAN to org even though it canonical-folds to FINANCE", () => {
    // Regression pin: canonical fold merges PCC + LEAD_FINANCE
    // into `FINANCE`. Custodians must remain project-scoped —
    // the `FINANCE` bucket for org visibility is reserved for
    // LEAD_FINANCE canonical FINANCE seat.
    expect(classifyProjectScope("PETTY_CASH_CUSTODIAN")).toBe("assigned");
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

describe("buildApproverOrSelfClause", () => {
  const callerId = "00000000-0000-0000-0000-0000000000ca";

  it("returns null on org scope (no filter, org-tier visibility)", () => {
    expect(
      buildApproverOrSelfClause(
        { kind: "org" },
        callerId,
        "submitter_employee_id",
        { treatAsApprover: true },
      ),
    ).toBeNull();
  });

  it("returns 'self' for non-approvers regardless of scope size", () => {
    expect(
      buildApproverOrSelfClause(
        {
          kind: "assigned",
          projectIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
          empty: false,
        },
        callerId,
        "submitter_employee_id",
        { treatAsApprover: false },
      ),
    ).toBe("self");
  });

  it("returns 'self' for approvers with empty scope (fresh onboarding)", () => {
    expect(
      buildApproverOrSelfClause(
        { kind: "assigned", projectIds: [], empty: true },
        callerId,
        "submitter_employee_id",
        { treatAsApprover: true },
      ),
    ).toBe("self");
  });

  it("emits a supabase-compatible OR clause for approvers with a scope", () => {
    const projectIds = [
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    ];
    const clause = buildApproverOrSelfClause(
      { kind: "assigned", projectIds, empty: false },
      callerId,
      "submitter_employee_id",
      { treatAsApprover: true },
    );
    expect(clause).toBe(
      `project_id.in.(${projectIds.join(",")}),submitter_employee_id.eq.${callerId}`,
    );
  });

  it("honours a custom submitter column (cash advances use requester_employee_id)", () => {
    const clause = buildApproverOrSelfClause(
      {
        kind: "assigned",
        projectIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
        empty: false,
      },
      callerId,
      "requester_employee_id",
      { treatAsApprover: true },
    );
    expect(clause).toContain("requester_employee_id.eq.");
  });
});
