import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

import {
  buildApproverOrSelfClause,
  classifyProjectScope,
  isApproverRole,
  resolveEmployeeScope,
  resolveProjectScope,
} from "./project-scope";

/**
 * Thenable PostgREST chain so `await supabase.from().select().eq().in()`
 * resolves to `{ data, error }` without a real client.
 */
function query(data: unknown) {
  const result = { data, error: null };
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.eq = self;
  chain.in = self;
  chain.then = (
    resolve: (v: unknown) => unknown,
    reject: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

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

describe("resolveProjectScope", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns org scope without touching assignment tables", async () => {
    const scope = await resolveProjectScope({
      id: "emp-org-1",
      role: "DIRECTOR",
    });
    expect(scope).toEqual({ kind: "org" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("returns assigned project ids from both PM and member tables", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "project_pm_assignments") {
        return query([
          { project_id: "proj-a" },
          { project_id: "proj-b" },
        ]);
      }
      if (table === "project_employee_assignments") {
        return query([
          { project_id: "proj-b" },
          { project_id: "proj-c" },
        ]);
      }
      return query([]);
    });

    const scope = await resolveProjectScope({
      id: "emp-assigned-1",
      role: "EMPLOYEE",
    });
    expect(scope.kind).toBe("assigned");
    if (scope.kind === "org") throw new Error("expected assigned");
    expect(scope.empty).toBe(false);
    expect(scope.projectIds.sort()).toEqual(["proj-a", "proj-b", "proj-c"]);
  });

  it("marks assigned scope empty when both assignment queries return null", async () => {
    fromMock.mockImplementation(() => query(null));

    const scope = await resolveProjectScope({
      id: "emp-assigned-empty",
      role: "PM",
    });
    expect(scope).toEqual({
      kind: "assigned",
      projectIds: [],
      empty: true,
    });
  });

  it("walks the reporting tree for portfolio roles and unions assignments", async () => {
    let employeeHops = 0;
    fromMock.mockImplementation((table: string) => {
      if (table === "employees") {
        employeeHops += 1;
        if (employeeHops === 1) {
          return query([{ id: "sub-1" }, { id: "sub-1" }]);
        }
        return query([]);
      }
      if (table === "project_pm_assignments") {
        return query([{ project_id: "port-1" }]);
      }
      if (table === "project_employee_assignments") {
        return query([{ project_id: "port-2" }]);
      }
      return query([]);
    });

    const scope = await resolveProjectScope({
      id: "emp-om-1",
      role: "OM",
    });
    expect(scope.kind).toBe("portfolio");
    if (scope.kind === "org") throw new Error("expected portfolio");
    expect(scope.empty).toBe(false);
    expect(scope.projectIds.sort()).toEqual(["port-1", "port-2"]);
  });
});

describe("resolveEmployeeScope", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns org when the caller is an org-tier role", async () => {
    const scope = await resolveEmployeeScope({
      id: "emp-hr-1",
      role: "HR_ADMIN",
    });
    expect(scope).toEqual({ kind: "org" });
  });

  it("returns just the caller when their project scope is empty", async () => {
    fromMock.mockImplementation(() => query([]));

    const scope = await resolveEmployeeScope({
      id: "emp-pm-empty",
      role: "PROJECT_MANAGER",
    });
    expect(scope).toEqual({
      kind: "scoped",
      ids: ["emp-pm-empty"],
    });
  });

  it("unions PM + member ids on assigned projects and always includes the caller", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "project_pm_assignments") {
        return query([
          { project_id: "proj-x", pm_employee_id: "other-pm" },
        ]);
      }
      if (table === "project_employee_assignments") {
        return query([
          { project_id: "proj-x", employee_id: "other-dev" },
        ]);
      }
      return query([]);
    });

    const scope = await resolveEmployeeScope({
      id: "emp-pm-team",
      role: "PM",
    });
    expect(scope.kind).toBe("scoped");
    if (scope.kind === "org") throw new Error("expected scoped");
    expect(scope.ids.sort()).toEqual([
      "emp-pm-team",
      "other-dev",
      "other-pm",
    ]);
  });
});
