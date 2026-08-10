import { describe, expect, it } from "vitest";

import {
  authorizeCanonical,
  canDecideCanonical,
  toCanonicalActor,
  type CanonicalActionVerb,
  type CanonicalActor,
  type CanonicalAttributes,
  type CanonicalResource,
} from "@/lib/security/pdp-canonical";
import type { CanonicalRole } from "@/lib/rbac/roles";
import { mergeThresholds } from "@/lib/rbac/thresholds";

const TENANT_A = "00000000-0000-0000-0000-00000000000a";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";

function actor(role: CanonicalRole, tenantId = TENANT_A): CanonicalActor {
  return {
    userId: `user-${role.toLowerCase()}`,
    employeeId: `emp-${role.toLowerCase()}`,
    role,
    tenantId,
  };
}

function attrs(overrides: Partial<CanonicalAttributes> = {}): CanonicalAttributes {
  return { tenantId: TENANT_A, ...overrides };
}

function decide(
  a: CanonicalActor,
  action: CanonicalActionVerb,
  resource: CanonicalResource,
  attributes: CanonicalAttributes = attrs(),
) {
  return authorizeCanonical({ actor: a, action, resource, attributes });
}

describe("toCanonicalActor", () => {
  it("folds a legacy DB role onto canonical", () => {
    const c = toCanonicalActor({
      userId: "u",
      employeeId: "e",
      role: "PROJECT_MANAGER",
      tenantId: TENANT_A,
    });
    expect(c.role).toBe("PM");
  });

  it("passes canonical DB values through unchanged", () => {
    const c = toCanonicalActor({
      userId: "u",
      employeeId: "e",
      role: "DIRECTOR",
      tenantId: TENANT_A,
    });
    expect(c.role).toBe("DIRECTOR");
  });
});

describe("canDecideCanonical", () => {
  it("returns ALLOW when the role can act on the slot", () => {
    const d = canDecideCanonical(actor("PM"), "PM");
    expect(d.effect).toBe("ALLOW");
  });

  it("returns DENY when the role cannot act on the slot", () => {
    const d = canDecideCanonical(actor("EMPLOYEE"), "FINANCE");
    expect(d.effect).toBe("DENY");
  });

  it("ADMIN can act on every slot", () => {
    for (const slot of ["PM", "OM", "FINANCE", "DIRECTOR", "SUPERVISOR"] as const) {
      const d = canDecideCanonical(actor("ADMIN"), slot);
      expect(d.effect).toBe("ALLOW");
    }
  });
});

describe("authorizeCanonical — tenant isolation", () => {
  it("denies cross-tenant access, even for ADMIN", () => {
    const d = decide(
      actor("ADMIN", TENANT_A),
      "read",
      "budget",
      attrs({ tenantId: TENANT_B }),
    );
    expect(d.effect).toBe("DENY");
    expect(d.reason).toMatch(/cross-tenant/i);
  });

  it("allows same-tenant read for any role", () => {
    expect(decide(actor("EMPLOYEE"), "read", "project_milestone").effect).toBe(
      "ALLOW",
    );
  });
});

describe("authorizeCanonical — ADMIN override", () => {
  it("ADMIN can do everything within its tenant", () => {
    const actions: CanonicalActionVerb[] = [
      "create",
      "update",
      "delete",
      "submit",
      "approve",
      "reject",
      "disburse",
      "settle",
    ];
    for (const action of actions) {
      const d = decide(actor("ADMIN"), action, "budget");
      expect(d.effect).toBe("ALLOW");
    }
  });
});

describe("authorizeCanonical — approval slot check", () => {
  it("denies approve when pendingSlot is missing", () => {
    const d = decide(actor("PM"), "approve", "budget_request");
    expect(d.effect).toBe("DENY");
    expect(d.reason).toMatch(/no pending slot/i);
  });

  it("PM approves PM slot on budget_request", () => {
    const d = decide(actor("PM"), "approve", "budget_request", attrs({ pendingSlot: "PM" }));
    expect(d.effect).toBe("ALLOW");
  });

  it("EMPLOYEE cannot approve any slot", () => {
    for (const slot of ["PM", "OM", "FINANCE", "DIRECTOR"] as const) {
      const d = decide(actor("EMPLOYEE"), "approve", "budget_request", attrs({ pendingSlot: slot }));
      expect(d.effect).toBe("DENY");
    }
  });

  it("DIRECTOR can short-circuit lower slots (canonical rule)", () => {
    const d = decide(actor("DIRECTOR"), "approve", "budget_request", attrs({ pendingSlot: "PM" }));
    expect(d.effect).toBe("ALLOW");
  });
});

describe("authorizeCanonical — threshold drift guard", () => {
  it("denies DIRECTOR approval when amount doesn't need Director", () => {
    const t = mergeThresholds("EXPENSE", null);
    const d = decide(
      actor("DIRECTOR"),
      "approve",
      "budget_request",
      attrs({
        pendingSlot: "DIRECTOR",
        amountIDR: 1_000_000,
        thresholds: mergeThresholds("BUDGET_REQUEST", null),
      }),
    );
    // 1M < BUDGET_REQUEST.DIRECTOR_THRESHOLD (50M) → over-escalation.
    expect(d.effect).toBe("DENY");
    expect(d.reason).toMatch(/over-escalated/i);
    // Sanity: ensure the fixture threshold is a positive number.
    expect(t.PM_THRESHOLD).toBeGreaterThan(0);
  });

  it("allows DIRECTOR approval when amount meets Director threshold", () => {
    const d = decide(
      actor("DIRECTOR"),
      "approve",
      "cash_advance_field_ops",
      attrs({
        pendingSlot: "DIRECTOR",
        amountIDR: 60_000_000,
        thresholds: mergeThresholds("CASH_ADVANCE_FIELD_OPS", null),
      }),
    );
    expect(d.effect).toBe("ALLOW");
  });

  it("skips drift check when thresholds are not supplied", () => {
    const d = decide(
      actor("DIRECTOR"),
      "approve",
      "budget_request",
      attrs({ pendingSlot: "DIRECTOR", amountIDR: 100 }),
    );
    expect(d.effect).toBe("ALLOW"); // slot allowed, drift check skipped.
  });
});

describe("authorizeCanonical — project_milestone", () => {
  it("PM can create + update", () => {
    expect(decide(actor("PM"), "create", "project_milestone").effect).toBe("ALLOW");
    expect(decide(actor("PM"), "update", "project_milestone").effect).toBe("ALLOW");
  });

  it("EMPLOYEE cannot create", () => {
    expect(decide(actor("EMPLOYEE"), "create", "project_milestone").effect).toBe("DENY");
  });

  it("PM cannot delete milestones (OM/DIRECTOR only)", () => {
    expect(decide(actor("PM"), "delete", "project_milestone").effect).toBe("DENY");
    expect(decide(actor("OM"), "delete", "project_milestone").effect).toBe("ALLOW");
  });
});

describe("authorizeCanonical — budget", () => {
  it("PM/OM/DIRECTOR/FINANCE may create", () => {
    for (const r of ["PM", "OM", "DIRECTOR", "FINANCE"] as const) {
      expect(decide(actor(r), "create", "budget").effect).toBe("ALLOW");
    }
  });

  it("SUPERVISOR / EMPLOYEE cannot create", () => {
    expect(decide(actor("SUPERVISOR"), "create", "budget").effect).toBe("DENY");
    expect(decide(actor("EMPLOYEE"), "create", "budget").effect).toBe("DENY");
  });

  it("only DIRECTOR may delete", () => {
    expect(decide(actor("PM"), "delete", "budget").effect).toBe("DENY");
    expect(decide(actor("OM"), "delete", "budget").effect).toBe("DENY");
    expect(decide(actor("FINANCE"), "delete", "budget").effect).toBe("DENY");
    expect(decide(actor("DIRECTOR"), "delete", "budget").effect).toBe("ALLOW");
  });

  it("budget_detail follows budget policy", () => {
    expect(decide(actor("PM"), "create", "budget_detail").effect).toBe("ALLOW");
    expect(decide(actor("EMPLOYEE"), "create", "budget_detail").effect).toBe("DENY");
  });
});

describe("authorizeCanonical — budget_request", () => {
  it("assigned employee may create", () => {
    const d = decide(
      actor("EMPLOYEE"),
      "create",
      "budget_request",
      attrs({ isActiveAssignment: true }),
    );
    expect(d.effect).toBe("ALLOW");
  });

  it("unassigned employee is denied", () => {
    const d = decide(
      actor("EMPLOYEE"),
      "create",
      "budget_request",
      attrs({ isActiveAssignment: false }),
    );
    expect(d.effect).toBe("DENY");
  });

  it("PM/OM/DIRECTOR may create without assignment", () => {
    for (const r of ["PM", "OM", "DIRECTOR"] as const) {
      expect(decide(actor(r), "create", "budget_request").effect).toBe("ALLOW");
    }
  });

  it("submitter may edit while status is DRAFT / PENDING_PM", () => {
    const d = decide(
      actor("EMPLOYEE"),
      "update",
      "budget_request",
      attrs({ ownerEmployeeId: "emp-employee", status: "PENDING_PM" }),
    );
    expect(d.effect).toBe("ALLOW");
  });

  it("submitter cannot edit after status advances", () => {
    const d = decide(
      actor("EMPLOYEE"),
      "update",
      "budget_request",
      attrs({ ownerEmployeeId: "emp-employee", status: "PENDING_FINANCE" }),
    );
    expect(d.effect).toBe("DENY");
    expect(d.reason).toMatch(/locked/i);
  });

  it("non-submitter cannot edit", () => {
    const d = decide(
      actor("PM"),
      "update",
      "budget_request",
      attrs({ ownerEmployeeId: "someone-else", status: "DRAFT" }),
    );
    expect(d.effect).toBe("DENY");
  });
});

describe("authorizeCanonical — cash_advance_general", () => {
  it("assigned employee may initiate a general CA", () => {
    const d = decide(
      actor("EMPLOYEE"),
      "create",
      "cash_advance_general",
      attrs({ projectId: "proj-1", isActiveAssignment: true }),
    );
    expect(d.effect).toBe("ALLOW");
  });

  it("PM/OM/DIRECTOR may initiate general CA even without assignment", () => {
    for (const r of ["PM", "OM", "DIRECTOR"] as const) {
      const d = decide(
        actor(r),
        "create",
        "cash_advance_general",
        attrs({ projectId: "proj-1", isActiveAssignment: false }),
      );
      expect(d.effect).toBe("ALLOW");
    }
  });

  it("unassigned EMPLOYEE cannot initiate", () => {
    const d = decide(
      actor("EMPLOYEE"),
      "create",
      "cash_advance_general",
      attrs({ projectId: "proj-1", isActiveAssignment: false }),
    );
    expect(d.effect).toBe("DENY");
  });

  it("missing project_id is denied", () => {
    const d = decide(actor("PM"), "create", "cash_advance_general");
    expect(d.effect).toBe("DENY");
    expect(d.reason).toMatch(/project_id/i);
  });

  it("requester may edit while DRAFT / PENDING_PM", () => {
    for (const status of ["DRAFT", "PENDING_PM"] as const) {
      const d = decide(
        actor("PM"),
        "update",
        "cash_advance_general",
        attrs({
          ownerEmployeeId: "emp-pm",
          status,
        }),
      );
      expect(d.effect).toBe("ALLOW");
    }
  });

  it("non-owner cannot edit", () => {
    const d = decide(
      actor("PM"),
      "update",
      "cash_advance_general",
      attrs({ ownerEmployeeId: "somebody-else", status: "DRAFT" }),
    );
    expect(d.effect).toBe("DENY");
  });

  it("locked once past PENDING_PM", () => {
    const d = decide(
      actor("PM"),
      "update",
      "cash_advance_general",
      attrs({ ownerEmployeeId: "emp-pm", status: "PENDING_FINANCE" }),
    );
    expect(d.effect).toBe("DENY");
    expect(d.reason).toMatch(/locked/i);
  });

  it("only FINANCE may disburse / settle", () => {
    expect(
      decide(actor("FINANCE"), "disburse", "cash_advance_general").effect,
    ).toBe("ALLOW");
    expect(
      decide(actor("PM"), "disburse", "cash_advance_general").effect,
    ).toBe("DENY");
    expect(
      decide(actor("FINANCE"), "settle", "cash_advance_general").effect,
    ).toBe("ALLOW");
    expect(
      decide(actor("DIRECTOR"), "settle", "cash_advance_general").effect,
    ).toBe("DENY");
  });
});

describe("authorizeCanonical — cash_advance_settlement", () => {
  it("owner may submit", () => {
    const d = decide(
      actor("EMPLOYEE"),
      "submit",
      "cash_advance_settlement",
      attrs({ ownerEmployeeId: "emp-employee" }),
    );
    expect(d.effect).toBe("ALLOW");
  });

  it("non-owner cannot submit", () => {
    const d = decide(
      actor("EMPLOYEE"),
      "submit",
      "cash_advance_settlement",
      attrs({ ownerEmployeeId: "somebody-else" }),
    );
    expect(d.effect).toBe("DENY");
  });

  it("only FINANCE may accept (settle) or return (reject)", () => {
    expect(
      decide(actor("FINANCE"), "settle", "cash_advance_settlement").effect,
    ).toBe("ALLOW");
    expect(
      decide(actor("PM"), "settle", "cash_advance_settlement").effect,
    ).toBe("DENY");
    expect(
      decide(actor("FINANCE"), "reject", "cash_advance_settlement").effect,
    ).toBe("ALLOW");
    expect(
      decide(actor("DIRECTOR"), "reject", "cash_advance_settlement").effect,
    ).toBe("DENY");
  });
});

describe("authorizeCanonical — cash_advance_field_ops", () => {
  it("SUPERVISOR/PM/OM may create with projectId", () => {
    for (const r of ["SUPERVISOR", "PM", "OM"] as const) {
      const d = decide(
        actor(r),
        "create",
        "cash_advance_field_ops",
        attrs({ projectId: "proj-1" }),
      );
      expect(d.effect).toBe("ALLOW");
    }
  });

  it("EMPLOYEE cannot create field-ops CA without an active field-tech assignment", () => {
    const d = decide(
      actor("EMPLOYEE"),
      "create",
      "cash_advance_field_ops",
      attrs({ projectId: "proj-1" }),
    );
    expect(d.effect).toBe("DENY");
    expect(d.reason).toMatch(/supervisor|field technician/i);
  });

  it("EMPLOYEE with isFieldTech=true may initiate field-ops CA (rules §7 + §11)", () => {
    const d = decide(
      actor("EMPLOYEE"),
      "create",
      "cash_advance_field_ops",
      attrs({ projectId: "proj-1", isFieldTech: true }),
    );
    expect(d.effect).toBe("ALLOW");
    expect(d.reason).toMatch(/field.?tech/i);
  });

  it("EMPLOYEE with isFieldTech=false is treated as a base employee (DENY)", () => {
    const d = decide(
      actor("EMPLOYEE"),
      "create",
      "cash_advance_field_ops",
      attrs({ projectId: "proj-1", isFieldTech: false }),
    );
    expect(d.effect).toBe("DENY");
  });

  it("SUPERVISOR does NOT need isFieldTech to initiate (supervisor+ always allowed)", () => {
    const d = decide(
      actor("SUPERVISOR"),
      "create",
      "cash_advance_field_ops",
      attrs({ projectId: "proj-1", isFieldTech: false }),
    );
    expect(d.effect).toBe("ALLOW");
  });

  it("cross-tenant access is denied even with isFieldTech=true (defense in depth)", () => {
    const d = authorizeCanonical({
      actor: actor("EMPLOYEE", TENANT_A),
      action: "create",
      resource: "cash_advance_field_ops",
      attributes: {
        tenantId: TENANT_B,
        projectId: "proj-b",
        isFieldTech: true,
      },
    });
    expect(d.effect).toBe("DENY");
    expect(d.reason).toMatch(/cross-tenant/);
  });

  it("submit follows the same policy as create (field-tech allowed, plain employee denied)", () => {
    expect(
      decide(
        actor("EMPLOYEE"),
        "submit",
        "cash_advance_field_ops",
        attrs({ projectId: "proj-1", isFieldTech: true }),
      ).effect,
    ).toBe("ALLOW");
    expect(
      decide(
        actor("EMPLOYEE"),
        "submit",
        "cash_advance_field_ops",
        attrs({ projectId: "proj-1" }),
      ).effect,
    ).toBe("DENY");
  });

  it("missing project_id is denied", () => {
    const d = decide(actor("SUPERVISOR"), "create", "cash_advance_field_ops");
    expect(d.effect).toBe("DENY");
    expect(d.reason).toMatch(/project_id/i);
  });

  it("only FINANCE may disburse", () => {
    expect(decide(actor("FINANCE"), "disburse", "cash_advance_field_ops").effect).toBe("ALLOW");
    expect(decide(actor("PM"), "disburse", "cash_advance_field_ops").effect).toBe("DENY");
  });
});

describe("authorizeCanonical — project_issue", () => {
  it("assigned member may raise issue", () => {
    const d = decide(
      actor("EMPLOYEE"),
      "create",
      "project_issue",
      attrs({ isActiveAssignment: true }),
    );
    expect(d.effect).toBe("ALLOW");
  });

  it("supervisor+ may triage others' issues", () => {
    const d = decide(
      actor("SUPERVISOR"),
      "update",
      "project_issue",
      attrs({ ownerEmployeeId: "someone-else" }),
    );
    expect(d.effect).toBe("ALLOW");
  });

  it("employee cannot triage others' issues", () => {
    const d = decide(
      actor("EMPLOYEE"),
      "update",
      "project_issue",
      attrs({ ownerEmployeeId: "someone-else" }),
    );
    expect(d.effect).toBe("DENY");
  });

  it("only PM+ may retract", () => {
    expect(decide(actor("EMPLOYEE"), "delete", "project_issue").effect).toBe("DENY");
    expect(decide(actor("SUPERVISOR"), "delete", "project_issue").effect).toBe("DENY");
    expect(decide(actor("PM"), "delete", "project_issue").effect).toBe("ALLOW");
    expect(decide(actor("DIRECTOR"), "delete", "project_issue").effect).toBe("ALLOW");
  });
});

describe("authorizeCanonical — weekly_timesheet", () => {
  it("self may create / update", () => {
    const d = decide(
      actor("EMPLOYEE"),
      "update",
      "weekly_timesheet",
      attrs({ ownerEmployeeId: "emp-employee" }),
    );
    expect(d.effect).toBe("ALLOW");
  });

  it("supervisor may edit team timesheets", () => {
    const d = decide(
      actor("SUPERVISOR"),
      "update",
      "weekly_timesheet",
      attrs({ ownerEmployeeId: "someone-else" }),
    );
    expect(d.effect).toBe("ALLOW");
  });

  it("finance cannot edit others' timesheets", () => {
    const d = decide(
      actor("FINANCE"),
      "update",
      "weekly_timesheet",
      attrs({ ownerEmployeeId: "someone-else" }),
    );
    expect(d.effect).toBe("DENY");
  });
});

describe("authorizeCanonical — approval_threshold", () => {
  it("ADMIN/DIRECTOR can create / update", () => {
    expect(decide(actor("ADMIN"), "create", "approval_threshold").effect).toBe("ALLOW");
    expect(decide(actor("DIRECTOR"), "update", "approval_threshold").effect).toBe("ALLOW");
  });

  it("FINANCE cannot tune thresholds (audit trail integrity)", () => {
    expect(decide(actor("FINANCE"), "update", "approval_threshold").effect).toBe("DENY");
  });

  it("only ADMIN can delete an override", () => {
    expect(decide(actor("DIRECTOR"), "delete", "approval_threshold").effect).toBe("DENY");
    expect(decide(actor("ADMIN"), "delete", "approval_threshold").effect).toBe("ALLOW");
  });

  it("everyone-in-tenant may read the threshold config", () => {
    expect(decide(actor("EMPLOYEE"), "read", "approval_threshold").effect).toBe("ALLOW");
  });
});

describe("authorizeCanonical — client_portal_view", () => {
  it("employees cannot read the portal view", () => {
    const d = decide(actor("EMPLOYEE"), "read", "client_portal_view");
    expect(d.effect).toBe("DENY");
  });

  it("only ADMIN may manage portal user accounts", () => {
    expect(decide(actor("ADMIN"), "create", "client_portal_view").effect).toBe("ALLOW");
    expect(decide(actor("DIRECTOR"), "create", "client_portal_view").effect).toBe("DENY");
  });
});

// ---------------------------------------------------------------------------
// capability_override — Fase 2 (write) + Fase 3B (read gating on audit trail).
// ---------------------------------------------------------------------------
describe("authorizeCanonical — capability_override", () => {
  it("ADMIN/DIRECTOR can create / update overrides", () => {
    expect(decide(actor("ADMIN"), "create", "capability_override").effect).toBe(
      "ALLOW",
    );
    expect(decide(actor("DIRECTOR"), "update", "capability_override").effect).toBe(
      "ALLOW",
    );
  });

  it("FINANCE cannot tune the capability matrix", () => {
    expect(decide(actor("FINANCE"), "update", "capability_override").effect).toBe(
      "DENY",
    );
  });

  it("only ADMIN can delete an override row", () => {
    expect(decide(actor("DIRECTOR"), "delete", "capability_override").effect).toBe(
      "DENY",
    );
    expect(decide(actor("ADMIN"), "delete", "capability_override").effect).toBe(
      "ALLOW",
    );
  });

  it("read of the audit trail is admin/director only (Fase 3B)", () => {
    // History sheet on /settings/capabilities must not be scrape-able
    // by non-privileged callers even via a hand-rolled server action.
    // Legacy `decideCanonicalRead` fallback for tenant-scoped reads
    // would otherwise let EMPLOYEE / SUPERVISOR through here; this
    // test pins the tighter gate.
    expect(decide(actor("EMPLOYEE"), "read", "capability_override").effect).toBe(
      "DENY",
    );
    expect(decide(actor("SUPERVISOR"), "read", "capability_override").effect).toBe(
      "DENY",
    );
    expect(decide(actor("FINANCE"), "read", "capability_override").effect).toBe(
      "DENY",
    );
    expect(decide(actor("PM"), "read", "capability_override").effect).toBe(
      "DENY",
    );
    expect(decide(actor("OM"), "read", "capability_override").effect).toBe(
      "DENY",
    );
    expect(decide(actor("DIRECTOR"), "read", "capability_override").effect).toBe(
      "ALLOW",
    );
    expect(decide(actor("ADMIN"), "read", "capability_override").effect).toBe(
      "ALLOW",
    );
  });
});
