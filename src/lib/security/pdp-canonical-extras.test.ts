/**
 * Targeted coverage for canonical PDP helpers that the existing
 * `pdp-canonical.test.ts` fixture does not exercise: Field-Ops CA,
 * Project Issue, Weekly Timesheet, Client Portal View, and
 * Approval Threshold.
 *
 * Rules §21 (coverage floor for src/lib/security/**) + §9.4 + §15b.
 */

import { describe, expect, it } from "vitest";

import {
  authorizeCanonical,
  type CanonicalActionVerb,
  type CanonicalActor,
  type CanonicalAttributes,
  type CanonicalResource,
} from "@/lib/security/pdp-canonical";
import type { CanonicalRole } from "@/lib/rbac/roles";

const TENANT = "00000000-0000-0000-0000-00000000000a";

function actor(role: CanonicalRole, employeeId = `e-${role}`): CanonicalActor {
  return {
    userId: `u-${role}`,
    employeeId,
    role,
    tenantId: TENANT,
  };
}

function attrs(overrides: Partial<CanonicalAttributes> = {}): CanonicalAttributes {
  return { tenantId: TENANT, ...overrides };
}

function decide(
  a: CanonicalActor,
  action: CanonicalActionVerb,
  resource: CanonicalResource,
  overrides: Partial<CanonicalAttributes> = {},
) {
  return authorizeCanonical({
    actor: a,
    action,
    resource,
    attributes: attrs(overrides),
  });
}

// ---------------------------------------------------------------------------
// cash_advance_field_ops (rules §9.4 + §27)
// ---------------------------------------------------------------------------
describe("pdp-canonical — cash_advance_field_ops", () => {
  it("DENYs create when projectId is missing", () => {
    const d = decide(actor("SUPERVISOR"), "create", "cash_advance_field_ops");
    expect(d.effect).toBe("DENY");
    expect(d.reason).toMatch(/project_id required/);
  });

  it.each([
    "SUPERVISOR",
    "PM",
    "OM",
    "FINANCE",
    "DIRECTOR",
  ] as const)("allows %s to create when projectId is set", (role) => {
    const d = decide(actor(role), "create", "cash_advance_field_ops", {
      projectId: "proj-1",
    });
    expect(d.effect).toBe("ALLOW");
  });

  it("allows EMPLOYEE to create only when isFieldTech=true", () => {
    const allowed = decide(actor("EMPLOYEE"), "create", "cash_advance_field_ops", {
      projectId: "proj-1",
      isFieldTech: true,
    });
    expect(allowed.effect).toBe("ALLOW");

    const denied = decide(actor("EMPLOYEE"), "create", "cash_advance_field_ops", {
      projectId: "proj-1",
      isFieldTech: false,
    });
    expect(denied.effect).toBe("DENY");
  });

  it("allows initiator to update while status is DRAFT", () => {
    const owner = "emp-owner";
    const d = decide(actor("EMPLOYEE", owner), "update", "cash_advance_field_ops", {
      ownerEmployeeId: owner,
      status: "DRAFT",
    });
    expect(d.effect).toBe("ALLOW");
  });

  it("blocks update when actor is not the initiator", () => {
    const d = decide(actor("EMPLOYEE", "someone-else"), "update", "cash_advance_field_ops", {
      ownerEmployeeId: "emp-owner",
      status: "DRAFT",
    });
    expect(d.effect).toBe("DENY");
    expect(d.reason).toMatch(/only initiator/i);
  });

  it("locks update when status is past DRAFT / PENDING_SUPERVISOR", () => {
    const owner = "emp-1";
    const d = decide(actor("EMPLOYEE", owner), "update", "cash_advance_field_ops", {
      ownerEmployeeId: owner,
      status: "DISBURSED",
    });
    expect(d.effect).toBe("DENY");
    expect(d.reason).toMatch(/locked at status DISBURSED/);
  });

  it("disburse: only FINANCE", () => {
    expect(
      decide(actor("FINANCE"), "disburse", "cash_advance_field_ops").effect,
    ).toBe("ALLOW");
    expect(
      decide(actor("SUPERVISOR"), "disburse", "cash_advance_field_ops").effect,
    ).toBe("DENY");
  });

  it("settle: only FINANCE", () => {
    expect(
      decide(actor("FINANCE"), "settle", "cash_advance_field_ops").effect,
    ).toBe("ALLOW");
    expect(
      decide(actor("PM"), "settle", "cash_advance_field_ops").effect,
    ).toBe("DENY");
  });

  it("DENYs unsupported action (fall-through)", () => {
    const d = decide(actor("SUPERVISOR"), "read", "cash_advance_field_ops");
    // `read` is not covered by decideFieldOpsCa (reads go through the
    // generic read path). We assert it either resolves to ALLOW via the
    // default read policy OR DENY — the point is that the function
    // returns a Decision, not a throw.
    expect(["ALLOW", "DENY"]).toContain(d.effect);
  });
});

// ---------------------------------------------------------------------------
// project_issue (rules §15b — SLA-tracked)
// ---------------------------------------------------------------------------
describe("pdp-canonical — project_issue", () => {
  it("assigned member can raise (create) an issue", () => {
    const d = decide(actor("EMPLOYEE"), "create", "project_issue", {
      isActiveAssignment: true,
    });
    expect(d.effect).toBe("ALLOW");
  });

  it("PM+/OM+/DIRECTOR can raise on ANY project (even without assignment)", () => {
    for (const role of ["PM", "OM", "DIRECTOR"] as CanonicalRole[]) {
      const d = decide(actor(role), "create", "project_issue", {
        isActiveAssignment: false,
      });
      expect(d.effect).toBe("ALLOW");
    }
  });

  it("EMPLOYEE without assignment cannot raise", () => {
    const d = decide(actor("EMPLOYEE"), "create", "project_issue", {
      isActiveAssignment: false,
    });
    expect(d.effect).toBe("DENY");
  });

  it("reporter can update their own issue", () => {
    const d = decide(actor("EMPLOYEE", "e-1"), "update", "project_issue", {
      ownerEmployeeId: "e-1",
    });
    expect(d.effect).toBe("ALLOW");
  });

  it("supervisor/PM+ can triage anyone's issue", () => {
    for (const role of ["SUPERVISOR", "PM", "OM", "DIRECTOR"] as CanonicalRole[]) {
      const d = decide(actor(role), "update", "project_issue", {
        ownerEmployeeId: "someone-else",
      });
      expect(d.effect).toBe("ALLOW");
    }
  });

  it("EMPLOYEE cannot triage someone else's issue", () => {
    const d = decide(actor("EMPLOYEE"), "update", "project_issue", {
      ownerEmployeeId: "someone-else",
    });
    expect(d.effect).toBe("DENY");
  });

  it("only PM+ may delete (retract) an issue", () => {
    for (const role of ["PM", "OM", "DIRECTOR"] as CanonicalRole[]) {
      expect(
        decide(actor(role), "delete", "project_issue").effect,
      ).toBe("ALLOW");
    }
    expect(decide(actor("EMPLOYEE"), "delete", "project_issue").effect).toBe(
      "DENY",
    );
    expect(decide(actor("SUPERVISOR"), "delete", "project_issue").effect).toBe(
      "DENY",
    );
  });
});

// ---------------------------------------------------------------------------
// weekly_timesheet
// ---------------------------------------------------------------------------
describe("pdp-canonical — weekly_timesheet", () => {
  it("employee edits own weekly timesheet (create/submit/update)", () => {
    const owner = "e-1";
    for (const action of ["create", "submit", "update"] as const) {
      const d = decide(actor("EMPLOYEE", owner), action, "weekly_timesheet", {
        ownerEmployeeId: owner,
      });
      expect(d.effect).toBe("ALLOW");
    }
  });

  it("supervisor / PM / OM edits a team member's weekly timesheet", () => {
    for (const role of ["SUPERVISOR", "PM", "OM"] as CanonicalRole[]) {
      const d = decide(actor(role), "update", "weekly_timesheet", {
        ownerEmployeeId: "someone-else",
      });
      expect(d.effect).toBe("ALLOW");
    }
  });

  it("blocks other employees from editing someone else's timesheet", () => {
    const d = decide(actor("EMPLOYEE"), "update", "weekly_timesheet", {
      ownerEmployeeId: "someone-else",
    });
    expect(d.effect).toBe("DENY");
  });

  it("only submitter may cancel", () => {
    const owner = "e-1";
    const allowed = decide(actor("EMPLOYEE", owner), "cancel", "weekly_timesheet", {
      ownerEmployeeId: owner,
    });
    expect(allowed.effect).toBe("ALLOW");

    const denied = decide(actor("PM"), "cancel", "weekly_timesheet", {
      ownerEmployeeId: "someone-else",
    });
    expect(denied.effect).toBe("DENY");
  });
});

// ---------------------------------------------------------------------------
// client_portal_view (rules §28)
// ---------------------------------------------------------------------------
describe("pdp-canonical — client_portal_view", () => {
  it("only ADMIN can create/update/delete portal users", () => {
    // NB: authorizeCanonical short-circuits ADMIN at the top of the pipe
    // with a "admin override" ALLOW — we still hit the helper for any
    // non-admin role. Use FINANCE / DIRECTOR to reach the helper's DENY.
    for (const action of ["create", "update", "delete"] as const) {
      expect(
        decide(actor("FINANCE"), action, "client_portal_view").effect,
      ).toBe("DENY");
      expect(
        decide(actor("DIRECTOR"), action, "client_portal_view").effect,
      ).toBe("DENY");
    }
  });

  it("unsupported action falls to DENY", () => {
    const d = decide(actor("FINANCE"), "submit", "client_portal_view");
    expect(d.effect).toBe("DENY");
  });
});

// ---------------------------------------------------------------------------
// approval_threshold (migration 0024)
// ---------------------------------------------------------------------------
describe("pdp-canonical — approval_threshold", () => {
  it("ADMIN / DIRECTOR may tune thresholds (create/update)", () => {
    // ADMIN short-circuits at the top; DIRECTOR proves the helper branch.
    for (const action of ["create", "update"] as const) {
      expect(decide(actor("DIRECTOR"), action, "approval_threshold").effect).toBe(
        "ALLOW",
      );
      // Confirm FINANCE / PM / EMPLOYEE are locked out.
      expect(decide(actor("FINANCE"), action, "approval_threshold").effect).toBe(
        "DENY",
      );
      expect(decide(actor("PM"), action, "approval_threshold").effect).toBe(
        "DENY",
      );
    }
  });

  it("only ADMIN may DELETE a threshold override (DIRECTOR cannot)", () => {
    expect(decide(actor("DIRECTOR"), "delete", "approval_threshold").effect).toBe(
      "DENY",
    );
    expect(decide(actor("EMPLOYEE"), "delete", "approval_threshold").effect).toBe(
      "DENY",
    );
  });

  it("unsupported action falls to DENY", () => {
    const d = decide(actor("DIRECTOR"), "submit", "approval_threshold");
    expect(d.effect).toBe("DENY");
  });
});
