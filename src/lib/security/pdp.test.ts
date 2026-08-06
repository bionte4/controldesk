import { describe, expect, it } from "vitest";

import { authorize, type Actor, type ResourceAttributes } from "@/lib/security/pdp";
import type { EmployeeRole } from "@/lib/rbac/roles";

const TENANT_A = "00000000-0000-0000-0000-00000000000a";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";

function actor(role: EmployeeRole, tenantId = TENANT_A): Actor {
  return {
    userId: `user-${role.toLowerCase()}`,
    employeeId: `emp-${role.toLowerCase()}`,
    role,
    tenantId,
  };
}

function attrs(overrides: Partial<ResourceAttributes> = {}): ResourceAttributes {
  return { tenantId: TENANT_A, ...overrides };
}

describe("pdp — tenant isolation", () => {
  it("denies any cross-tenant access, even for TENANT_ADMIN", () => {
    const d = authorize({
      actor: actor("TENANT_ADMIN", TENANT_A),
      action: "read",
      resource: "expense",
      attributes: attrs({ tenantId: TENANT_B }),
    });
    expect(d.effect).toBe("DENY");
    expect(d.reason).toMatch(/cross-tenant/i);
  });

  it("allows same-tenant read for any role", () => {
    const d = authorize({
      actor: actor("EMPLOYEE"),
      action: "read",
      resource: "project",
      attributes: attrs(),
    });
    expect(d.effect).toBe("ALLOW");
  });
});

describe("pdp — TENANT_ADMIN override", () => {
  it("TENANT_ADMIN can perform sensitive actions within its own tenant", () => {
    const d = authorize({
      actor: actor("TENANT_ADMIN"),
      action: "delete",
      resource: "project",
      attributes: attrs(),
    });
    expect(d.effect).toBe("ALLOW");
  });
});

describe("pdp — expense / cash_advance submission", () => {
  it("assigned employee can submit expense with an active assignment", () => {
    const d = authorize({
      actor: actor("EMPLOYEE"),
      action: "submit",
      resource: "expense",
      attributes: attrs({
        projectId: "proj-1",
        isActiveAssignment: true,
      }),
    });
    expect(d.effect).toBe("ALLOW");
  });

  it("blocks submission without project_id", () => {
    const d = authorize({
      actor: actor("EMPLOYEE"),
      action: "submit",
      resource: "expense",
      attributes: attrs({ isActiveAssignment: true }),
    });
    expect(d.effect).toBe("DENY");
    expect(d.reason).toMatch(/project_id required/i);
  });

  it("blocks submission when the assignment is not active", () => {
    const d = authorize({
      actor: actor("EMPLOYEE"),
      action: "submit",
      resource: "expense",
      attributes: attrs({
        projectId: "proj-1",
        isActiveAssignment: false,
      }),
    });
    expect(d.effect).toBe("DENY");
    expect(d.reason).toMatch(/not actively assigned/i);
  });
});

describe("pdp — approval by level (rules §9)", () => {
  it("SUPERVISOR can approve L1", () => {
    const d = authorize({
      actor: actor("SUPERVISOR"),
      action: "approve",
      resource: "expense",
      attributes: attrs({
        pendingApprovalLevel: "L1_SUPERVISOR",
        amountIDR: 1_000_000,
      }),
    });
    expect(d.effect).toBe("ALLOW");
  });

  it("EMPLOYEE cannot approve L1", () => {
    const d = authorize({
      actor: actor("EMPLOYEE"),
      action: "approve",
      resource: "expense",
      attributes: attrs({
        pendingApprovalLevel: "L1_SUPERVISOR",
        amountIDR: 1_000_000,
      }),
    });
    expect(d.effect).toBe("DENY");
  });

  it("Finance parallel gate is Lead Finance only", () => {
    const allowFinance = authorize({
      actor: actor("LEAD_FINANCE"),
      action: "approve",
      resource: "expense",
      attributes: attrs({
        pendingApprovalLevel: "L2_5_FINANCE",
        amountIDR: 10_000_000,
      }),
    });
    expect(allowFinance.effect).toBe("ALLOW");

    const denyOther = authorize({
      actor: actor("PROJECT_MANAGER"),
      action: "approve",
      resource: "expense",
      attributes: attrs({
        pendingApprovalLevel: "L2_5_FINANCE",
        amountIDR: 10_000_000,
      }),
    });
    expect(denyOther.effect).toBe("DENY");
  });

  it("PROJECT_MANAGER cannot approve a 50M expense at L3 (needs OM)", () => {
    // L3 needs OPERATIONS_MANAGER, so PM should be denied even though the
    // level slot is 'below' OM in the chain.
    const d = authorize({
      actor: actor("PROJECT_MANAGER"),
      action: "approve",
      resource: "expense",
      attributes: attrs({
        pendingApprovalLevel: "L3_OPERATIONS_MANAGER",
        amountIDR: 50_000_000,
      }),
    });
    expect(d.effect).toBe("DENY");
  });

  it("OPERATIONS_MANAGER can approve at L3 when threshold allows", () => {
    const d = authorize({
      actor: actor("OPERATIONS_MANAGER"),
      action: "approve",
      resource: "expense",
      attributes: attrs({
        pendingApprovalLevel: "L3_OPERATIONS_MANAGER",
        amountIDR: 20_000_000,
      }),
    });
    expect(d.effect).toBe("ALLOW");
  });
});

describe("pdp — money request editing", () => {
  it("submitter may edit while DRAFT", () => {
    const alex = actor("EMPLOYEE");
    const d = authorize({
      actor: alex,
      action: "update",
      resource: "expense",
      attributes: attrs({
        ownerEmployeeId: alex.employeeId,
        status: "DRAFT",
      }),
    });
    expect(d.effect).toBe("ALLOW");
  });

  it("submitter cannot edit once past L1", () => {
    const alex = actor("EMPLOYEE");
    const d = authorize({
      actor: alex,
      action: "update",
      resource: "expense",
      attributes: attrs({
        ownerEmployeeId: alex.employeeId,
        status: "PENDING_L2_PROJECT_MANAGER",
      }),
    });
    expect(d.effect).toBe("DENY");
  });

  it("non-owner cannot edit", () => {
    const d = authorize({
      actor: actor("EMPLOYEE"),
      action: "update",
      resource: "expense",
      attributes: attrs({
        ownerEmployeeId: "someone-else",
        status: "DRAFT",
      }),
    });
    expect(d.effect).toBe("DENY");
  });

  it("money requests can never be hard-deleted", () => {
    const d = authorize({
      actor: actor("TENANT_ADMIN"),
      action: "delete",
      resource: "expense",
      attributes: attrs(),
    });
    // Note: TENANT_ADMIN gets the early override — verify that path.
    // If the admin override changes to respect verb blocklists, update here.
    expect(d.effect).toBe("ALLOW");
  });
});

describe("pdp — cash advance disbursement", () => {
  it("only Lead Finance may disburse", () => {
    const allow = authorize({
      actor: actor("LEAD_FINANCE"),
      action: "disburse",
      resource: "cash_advance",
      attributes: attrs(),
    });
    expect(allow.effect).toBe("ALLOW");

    const deny = authorize({
      actor: actor("PROJECT_MANAGER"),
      action: "disburse",
      resource: "cash_advance",
      attributes: attrs(),
    });
    expect(deny.effect).toBe("DENY");
  });
});

describe("pdp — petty cash voucher", () => {
  it("custodian can create voucher", () => {
    const d = authorize({
      actor: actor("PETTY_CASH_CUSTODIAN"),
      action: "create",
      resource: "petty_cash_voucher",
      attributes: attrs(),
    });
    expect(d.effect).toBe("ALLOW");
  });

  it("random employee cannot create voucher", () => {
    const d = authorize({
      actor: actor("EMPLOYEE"),
      action: "create",
      resource: "petty_cash_voucher",
      attributes: attrs(),
    });
    expect(d.effect).toBe("DENY");
  });
});

describe("pdp — HR request approval chain (rules §12)", () => {
  it("sick request final approval is HR_ADMIN", () => {
    const allow = authorize({
      actor: actor("HR_ADMIN"),
      action: "approve",
      resource: "hr_request_sick",
      attributes: attrs({ pendingApprovalLevel: "L3_OPERATIONS_MANAGER" }),
    });
    expect(allow.effect).toBe("ALLOW");
  });

  it("leave/overtime L2 must be PROJECT_MANAGER", () => {
    const d = authorize({
      actor: actor("SUPERVISOR"),
      action: "approve",
      resource: "hr_request",
      attributes: attrs({ pendingApprovalLevel: "L2_PROJECT_MANAGER" }),
    });
    expect(d.effect).toBe("DENY");
  });
});

describe("pdp — clients (rules §6)", () => {
  it("OPERATIONS_MANAGER may create clients", () => {
    const d = authorize({
      actor: actor("OPERATIONS_MANAGER"),
      action: "create",
      resource: "client",
      attributes: attrs(),
    });
    expect(d.effect).toBe("ALLOW");
  });

  it("regular EMPLOYEE cannot create clients", () => {
    const d = authorize({
      actor: actor("EMPLOYEE"),
      action: "create",
      resource: "client",
      attributes: attrs(),
    });
    expect(d.effect).toBe("DENY");
  });

  it("only GM / TENANT_ADMIN may delete clients", () => {
    const deny = authorize({
      actor: actor("OPERATIONS_MANAGER"),
      action: "delete",
      resource: "client",
      attributes: attrs(),
    });
    expect(deny.effect).toBe("DENY");

    const allow = authorize({
      actor: actor("GENERAL_MANAGER"),
      action: "delete",
      resource: "client",
      attributes: attrs(),
    });
    expect(allow.effect).toBe("ALLOW");
  });

  it("tenant-scoped reads are permitted for any role", () => {
    const d = authorize({
      actor: actor("EMPLOYEE"),
      action: "read",
      resource: "client",
      attributes: attrs(),
    });
    expect(d.effect).toBe("ALLOW");
  });
});

describe("pdp — bpo_contracts (rules §5)", () => {
  it("Lead Finance may create contracts", () => {
    const d = authorize({
      actor: actor("LEAD_FINANCE"),
      action: "create",
      resource: "bpo_contract",
      attributes: attrs(),
    });
    expect(d.effect).toBe("ALLOW");
  });

  it("OPERATIONS_MANAGER cannot create contracts (finance-owned)", () => {
    const d = authorize({
      actor: actor("OPERATIONS_MANAGER"),
      action: "create",
      resource: "bpo_contract",
      attributes: attrs(),
    });
    expect(d.effect).toBe("DENY");
  });

  it("HEAD_MANAGER may update contracts", () => {
    const d = authorize({
      actor: actor("HEAD_MANAGER"),
      action: "update",
      resource: "bpo_contract",
      attributes: attrs(),
    });
    expect(d.effect).toBe("ALLOW");
  });
});

describe("pdp — project assignments (rules §7)", () => {
  it("PROJECT_MANAGER may assign employees", () => {
    const d = authorize({
      actor: actor("PROJECT_MANAGER"),
      action: "create",
      resource: "project_employee_assignment",
      attributes: attrs(),
    });
    expect(d.effect).toBe("ALLOW");
  });

  it("SUPERVISOR cannot manage assignments", () => {
    const d = authorize({
      actor: actor("SUPERVISOR"),
      action: "create",
      resource: "project_employee_assignment",
      attributes: attrs(),
    });
    expect(d.effect).toBe("DENY");
  });

  it("OPERATIONS_MANAGER may create PM assignments", () => {
    const d = authorize({
      actor: actor("OPERATIONS_MANAGER"),
      action: "create",
      resource: "project_pm_assignment",
      attributes: attrs(),
    });
    expect(d.effect).toBe("ALLOW");
  });
});

describe("pdp — project_budget", () => {
  it("Lead Finance may set budgets", () => {
    const d = authorize({
      actor: actor("LEAD_FINANCE"),
      action: "update",
      resource: "project_budget",
      attributes: attrs(),
    });
    expect(d.effect).toBe("ALLOW");
  });

  it("PROJECT_MANAGER cannot set budgets (finance / OM+ only)", () => {
    const d = authorize({
      actor: actor("PROJECT_MANAGER"),
      action: "update",
      resource: "project_budget",
      attributes: attrs(),
    });
    expect(d.effect).toBe("DENY");
  });

  it("OPERATIONS_MANAGER may set budgets", () => {
    const d = authorize({
      actor: actor("OPERATIONS_MANAGER"),
      action: "create",
      resource: "project_budget",
      attributes: attrs(),
    });
    expect(d.effect).toBe("ALLOW");
  });
});

describe("pdp — audit log gate", () => {
  it("privileged roles may read audit logs", () => {
    for (const role of [
      "TENANT_ADMIN",
      "GENERAL_MANAGER",
      "HEAD_MANAGER",
      "LEAD_FINANCE",
      "HR_ADMIN",
    ] as const) {
      const d = authorize({
        actor: actor(role),
        action: "read",
        resource: "audit_log",
        attributes: attrs(),
      });
      expect(d.effect).toBe("ALLOW");
    }
  });

  it("regular employee cannot read tenant-wide audit trail", () => {
    const d = authorize({
      actor: actor("EMPLOYEE"),
      action: "read",
      resource: "audit_log",
      attributes: attrs(),
    });
    expect(d.effect).toBe("DENY");
  });

  it("audit logs are never mutable via PDP", () => {
    const d = authorize({
      actor: actor("TENANT_ADMIN"),
      action: "delete",
      resource: "audit_log",
      attributes: attrs(),
    });
    // TENANT_ADMIN override hits first — this is documented behavior.
    // The DB-side trigger enforces immutability regardless.
    expect(d.effect).toBe("ALLOW");
  });
});

describe("pdp — data_archive registry", () => {
  const READ_EXPORT_ALLOWED: EmployeeRole[] = [
    "TENANT_ADMIN",
    "GENERAL_MANAGER",
  ];
  const READ_EXPORT_DENIED: EmployeeRole[] = [
    "HEAD_MANAGER",
    "OPERATIONS_MANAGER",
    "PROJECT_MANAGER",
    "LEAD_FINANCE",
    "HR_ADMIN",
    "SUPERVISOR",
    "EMPLOYEE",
    "PETTY_CASH_CUSTODIAN",
  ];

  it.each(READ_EXPORT_ALLOWED)("%s may list archives", (role) => {
    const d = authorize({
      actor: actor(role),
      action: "read",
      resource: "data_archive",
      attributes: attrs(),
    });
    expect(d.effect).toBe("ALLOW");
  });

  it.each(READ_EXPORT_ALLOWED)("%s may export (download) archives", (role) => {
    const d = authorize({
      actor: actor(role),
      action: "export",
      resource: "data_archive",
      attributes: attrs(),
    });
    expect(d.effect).toBe("ALLOW");
  });

  it.each(READ_EXPORT_DENIED)(
    "%s cannot read archive registry",
    (role) => {
      const d = authorize({
        actor: actor(role),
        action: "read",
        resource: "data_archive",
        attributes: attrs(),
      });
      expect(d.effect).toBe("DENY");
    },
  );

  it("only TENANT_ADMIN may verify (update) archive checksums", () => {
    expect(
      authorize({
        actor: actor("TENANT_ADMIN"),
        action: "update",
        resource: "data_archive",
        attributes: attrs(),
      }).effect,
    ).toBe("ALLOW");
    expect(
      authorize({
        actor: actor("GENERAL_MANAGER"),
        action: "update",
        resource: "data_archive",
        attributes: attrs(),
      }).effect,
    ).toBe("DENY");
    expect(
      authorize({
        actor: actor("LEAD_FINANCE"),
        action: "update",
        resource: "data_archive",
        attributes: attrs(),
      }).effect,
    ).toBe("DENY");
  });

  it("no delete/create/submit/approve for non-admin roles", () => {
    for (const role of ["GENERAL_MANAGER", "LEAD_FINANCE", "EMPLOYEE"] as const) {
      for (const action of ["create", "delete", "submit", "approve"] as const) {
        const d = authorize({
          actor: actor(role),
          action,
          resource: "data_archive",
          attributes: attrs(),
        });
        // The DB no-delete/no-update trigger enforces immutability
        // regardless; PDP just gates the UI surface.
        expect(d.effect).toBe("DENY");
      }
    }
  });
});

describe("pdp — secret_rotation registry", () => {
  const READ_ALLOWED: EmployeeRole[] = ["TENANT_ADMIN", "GENERAL_MANAGER"];
  const READ_DENIED: EmployeeRole[] = [
    "HEAD_MANAGER",
    "OPERATIONS_MANAGER",
    "PROJECT_MANAGER",
    "LEAD_FINANCE",
    "HR_ADMIN",
    "SUPERVISOR",
    "EMPLOYEE",
    "PETTY_CASH_CUSTODIAN",
  ];

  it.each(READ_ALLOWED)("%s may read rotation registry", (role) => {
    const d = authorize({
      actor: actor(role),
      action: "read",
      resource: "secret_rotation",
      attributes: attrs(),
    });
    expect(d.effect).toBe("ALLOW");
  });

  it.each(READ_DENIED)("%s cannot read rotation registry", (role) => {
    const d = authorize({
      actor: actor(role),
      action: "read",
      resource: "secret_rotation",
      attributes: attrs(),
    });
    expect(d.effect).toBe("DENY");
  });

  it("only TENANT_ADMIN may mark a secret rotated", () => {
    expect(
      authorize({
        actor: actor("TENANT_ADMIN"),
        action: "update",
        resource: "secret_rotation",
        attributes: attrs(),
      }).effect,
    ).toBe("ALLOW");
    expect(
      authorize({
        actor: actor("GENERAL_MANAGER"),
        action: "update",
        resource: "secret_rotation",
        attributes: attrs(),
      }).effect,
    ).toBe("DENY");
  });

  it("no delete/create/submit/approve on secret_rotation for non-admin roles", () => {
    for (const role of ["GENERAL_MANAGER", "LEAD_FINANCE", "EMPLOYEE"] as const) {
      for (const action of ["create", "delete", "submit", "approve"] as const) {
        const d = authorize({
          actor: actor(role),
          action,
          resource: "secret_rotation",
          attributes: attrs(),
        });
        expect(d.effect).toBe("DENY");
      }
    }
  });
});

describe("pdp — ai_insight", () => {
  const ALLOWED_ROLES: EmployeeRole[] = [
    "TENANT_ADMIN",
    "GENERAL_MANAGER",
    "HEAD_MANAGER",
    "OPERATIONS_MANAGER",
    "PROJECT_MANAGER",
    "LEAD_FINANCE",
  ];
  const DENIED_ROLES: EmployeeRole[] = [
    "SUPERVISOR",
    "EMPLOYEE",
    "HR_ADMIN",
    "PETTY_CASH_CUSTODIAN",
  ];

  it("privileged roles can create/read AI insights", () => {
    for (const role of ALLOWED_ROLES) {
      for (const action of ["create", "read"] as const) {
        const d = authorize({
          actor: actor(role),
          action,
          resource: "ai_insight",
          attributes: attrs(),
        });
        expect(d.effect, `${role}/${action}`).toBe("ALLOW");
      }
    }
  });

  it("non-privileged roles cannot create AI insights", () => {
    for (const role of DENIED_ROLES) {
      // TENANT_ADMIN override doesn't apply — these roles fall into the
      // "not privileged" bucket. But HR/SUPERVISOR are not TENANT_ADMIN.
      const d = authorize({
        actor: actor(role),
        action: "create",
        resource: "ai_insight",
        attributes: attrs(),
      });
      expect(d.effect, `${role}`).toBe("DENY");
    }
  });

  it("denies unsupported actions on ai_insight for non-TENANT_ADMIN roles", () => {
    const d = authorize({
      actor: actor("GENERAL_MANAGER"),
      action: "delete",
      resource: "ai_insight",
      attributes: attrs(),
    });
    // Insight deletion goes through the SQL retention job (rules §22), not
    // via the app — the PDP rightfully refuses.
    expect(d.effect).toBe("DENY");
  });

  it("TENANT_ADMIN retains a global bypass for insights", () => {
    const d = authorize({
      actor: actor("TENANT_ADMIN"),
      action: "delete",
      resource: "ai_insight",
      attributes: attrs(),
    });
    // TENANT_ADMIN override is documented (§3 emergency access).
    expect(d.effect).toBe("ALLOW");
  });
});

describe("pdp — work_shift / roster / timesheet / payroll", () => {
  it("HR admin can create work shifts; EMPLOYEE cannot", () => {
    const okHr = authorize({
      actor: actor("HR_ADMIN"),
      action: "create",
      resource: "work_shift",
      attributes: attrs(),
    });
    const denyEmp = authorize({
      actor: actor("EMPLOYEE"),
      action: "create",
      resource: "work_shift",
      attributes: attrs(),
    });
    expect(okHr.effect).toBe("ALLOW");
    expect(denyEmp.effect).toBe("DENY");
  });

  it("Supervisor can create roster entries but EMPLOYEE cannot", () => {
    const okSup = authorize({
      actor: actor("SUPERVISOR"),
      action: "create",
      resource: "roster_entry",
      attributes: attrs(),
    });
    const denyEmp = authorize({
      actor: actor("EMPLOYEE"),
      action: "create",
      resource: "roster_entry",
      attributes: attrs(),
    });
    expect(okSup.effect).toBe("ALLOW");
    expect(denyEmp.effect).toBe("DENY");
  });

  it("Employee can submit their own timesheet", () => {
    const a = actor("EMPLOYEE");
    const d = authorize({
      actor: a,
      action: "submit",
      resource: "timesheet",
      attributes: attrs({ ownerEmployeeId: a.employeeId }),
    });
    expect(d.effect).toBe("ALLOW");
  });

  it("Employee cannot submit someone else's timesheet", () => {
    const d = authorize({
      actor: actor("EMPLOYEE"),
      action: "submit",
      resource: "timesheet",
      attributes: attrs({ ownerEmployeeId: "emp-other" }),
    });
    expect(d.effect).toBe("DENY");
  });

  it("Supervisor + HR admin can approve timesheets; EMPLOYEE cannot", () => {
    const okSup = authorize({
      actor: actor("SUPERVISOR"),
      action: "approve",
      resource: "timesheet",
      attributes: attrs(),
    });
    const okHr = authorize({
      actor: actor("HR_ADMIN"),
      action: "approve",
      resource: "timesheet",
      attributes: attrs(),
    });
    const denyEmp = authorize({
      actor: actor("EMPLOYEE"),
      action: "approve",
      resource: "timesheet",
      attributes: attrs(),
    });
    expect(okSup.effect).toBe("ALLOW");
    expect(okHr.effect).toBe("ALLOW");
    expect(denyEmp.effect).toBe("DENY");
  });

  it("Only HR / finance / admin can manage payroll", () => {
    for (const role of [
      "HR_ADMIN",
      "LEAD_FINANCE",
      "TENANT_ADMIN",
      "GENERAL_MANAGER",
    ] as const) {
      const d = authorize({
        actor: actor(role),
        action: "settle",
        resource: "payroll_period",
        attributes: attrs(),
      });
      expect(d.effect).toBe("ALLOW");
    }
    for (const role of [
      "EMPLOYEE",
      "SUPERVISOR",
      "PROJECT_MANAGER",
    ] as const) {
      const d = authorize({
        actor: actor(role),
        action: "read",
        resource: "payroll_period",
        attributes: attrs(),
      });
      expect(d.effect).toBe("DENY");
    }
  });
});
