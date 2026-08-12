/**
 * Targeted coverage for PDP decision helpers that fall outside the main
 * `pdp.test.ts` fixture: evaluation templates, evaluations, UPK notes,
 * monthly reports, and import jobs.
 *
 * Rules §21 (coverage floor for src/lib/security/**). These decision
 * paths guard HR + Finance flows so they carry the same 80% gating as
 * the rest of the security helpers.
 */

import { describe, expect, it } from "vitest";

import {
  authorize,
  type ActionVerb,
  type Actor,
  type ResourceAttributes,
} from "@/lib/security/pdp";
import type { EmployeeRole } from "@/lib/rbac/roles";

const TENANT = "00000000-0000-0000-0000-00000000000a";

function actor(role: EmployeeRole): Actor {
  return {
    userId: `u-${role}`,
    employeeId: `e-${role}`,
    role,
    tenantId: TENANT,
  };
}

const baseAttrs: ResourceAttributes = { tenantId: TENANT };

function decide(input: {
  role: EmployeeRole;
  action: ActionVerb;
  resource: Parameters<typeof authorize>[0]["resource"];
  attributes?: ResourceAttributes;
}) {
  return authorize({
    actor: actor(input.role),
    action: input.action,
    resource: input.resource,
    attributes: input.attributes ?? baseAttrs,
  });
}

// ---------------------------------------------------------------------
// evaluation_template
// ---------------------------------------------------------------------
describe("pdp — evaluation_template", () => {
  it("allows read for any tenant role", () => {
    const roles: EmployeeRole[] = [
      "EMPLOYEE",
      "SUPERVISOR",
      "PROJECT_MANAGER",
      "LEAD_FINANCE",
      "HR_ADMIN",
      "TENANT_ADMIN",
    ];
    for (const role of roles) {
      const d = decide({ role, action: "read", resource: "evaluation_template" });
      expect(d.effect).toBe("ALLOW");
    }
  });

  it.each([
    ["TENANT_ADMIN", "ALLOW"],
    ["HEAD_MANAGER", "ALLOW"],
    ["OPERATIONS_MANAGER", "ALLOW"],
    ["HR_ADMIN", "ALLOW"],
    ["PROJECT_MANAGER", "DENY"],
    ["LEAD_FINANCE", "DENY"],
    ["EMPLOYEE", "DENY"],
  ] as const)("gates create for %s → %s", (role, expected) => {
    const d = decide({
      role: role as EmployeeRole,
      action: "create",
      resource: "evaluation_template",
    });
    expect(d.effect).toBe(expected);
  });

  it("denies update / delete for a non-writer role", () => {
    expect(
      decide({
        role: "EMPLOYEE",
        action: "update",
        resource: "evaluation_template",
      }).effect,
    ).toBe("DENY");
    expect(
      decide({
        role: "EMPLOYEE",
        action: "delete",
        resource: "evaluation_template",
      }).effect,
    ).toBe("DENY");
  });

  it("returns DENY for unsupported action (non-admin reaches switch default)", () => {
    // TENANT_ADMIN short-circuits with a global override at the top of
    // `authorize()`, so we use PROJECT_MANAGER to reach the resource
    // helper's default: DENY branch.
    const d = decide({
      role: "PROJECT_MANAGER",
      action: "approve",
      resource: "evaluation_template",
    });
    expect(d.effect).toBe("DENY");
  });
});

// ---------------------------------------------------------------------
// evaluation
// ---------------------------------------------------------------------
describe("pdp — evaluation", () => {
  it("read is broadly ALLOWed (RLS narrows)", () => {
    expect(
      decide({ role: "EMPLOYEE", action: "read", resource: "evaluation" }).effect,
    ).toBe("ALLOW");
  });

  it.each([
    ["SUPERVISOR", "ALLOW"],
    ["PROJECT_MANAGER", "ALLOW"],
    ["TENANT_ADMIN", "ALLOW"],
    ["HR_ADMIN", "ALLOW"],
    ["EMPLOYEE", "DENY"],
    ["LEAD_FINANCE", "DENY"],
  ] as const)("create/update for %s → %s", (role, expected) => {
    for (const action of ["create", "update"] as const) {
      const d = decide({
        role: role as EmployeeRole,
        action,
        resource: "evaluation",
      });
      expect(d.effect).toBe(expected);
    }
  });

  it.each([
    ["SUPERVISOR", "ALLOW"],
    ["HR_ADMIN", "ALLOW"],
    ["PROJECT_MANAGER", "DENY"],
    ["EMPLOYEE", "DENY"],
  ] as const)("submit for %s → %s", (role, expected) => {
    const d = decide({
      role: role as EmployeeRole,
      action: "submit",
      resource: "evaluation",
    });
    expect(d.effect).toBe(expected);
  });

  it.each([
    ["PROJECT_MANAGER", "ALLOW"],
    ["HR_ADMIN", "ALLOW"],
    ["TENANT_ADMIN", "ALLOW"],
    ["SUPERVISOR", "DENY"],
    ["EMPLOYEE", "DENY"],
  ] as const)("approve/reject for %s → %s", (role, expected) => {
    for (const action of ["approve", "reject"] as const) {
      const d = decide({
        role: role as EmployeeRole,
        action,
        resource: "evaluation",
      });
      expect(d.effect).toBe(expected);
    }
  });

  it("delete/cancel restricted to HR/Admin", () => {
    for (const action of ["delete", "cancel"] as const) {
      expect(
        decide({
          role: "HR_ADMIN",
          action,
          resource: "evaluation",
        }).effect,
      ).toBe("ALLOW");
      expect(
        decide({
          role: "PROJECT_MANAGER",
          action,
          resource: "evaluation",
        }).effect,
      ).toBe("DENY");
    }
  });

  it("DENYs unsupported evaluation action", () => {
    // `disburse` is not a valid evaluation verb. Use EMPLOYEE to skip
    // the TENANT_ADMIN global override and land in the switch default.
    expect(
      decide({
        role: "EMPLOYEE",
        action: "disburse",
        resource: "evaluation",
      }).effect,
    ).toBe("DENY");
  });
});

// ---------------------------------------------------------------------
// upk_note
// ---------------------------------------------------------------------
describe("pdp — upk_note", () => {
  it("read gated by RLS (always ALLOW at PDP layer)", () => {
    expect(
      decide({ role: "EMPLOYEE", action: "read", resource: "upk_note" }).effect,
    ).toBe("ALLOW");
  });

  it.each([
    ["PROJECT_MANAGER", "ALLOW"],
    ["OPERATIONS_MANAGER", "ALLOW"],
    ["LEAD_FINANCE", "ALLOW"],
    ["HR_ADMIN", "ALLOW"],
    ["TENANT_ADMIN", "ALLOW"],
    ["EMPLOYEE", "DENY"],
    ["SUPERVISOR", "DENY"],
  ] as const)("create/update for %s → %s", (role, expected) => {
    for (const action of ["create", "update"] as const) {
      const d = decide({
        role: role as EmployeeRole,
        action,
        resource: "upk_note",
      });
      expect(d.effect).toBe(expected);
    }
  });

  it("submit — PM/OM/HR yes, Finance/EMP no", () => {
    expect(
      decide({
        role: "PROJECT_MANAGER",
        action: "submit",
        resource: "upk_note",
      }).effect,
    ).toBe("ALLOW");
    expect(
      decide({
        role: "OPERATIONS_MANAGER",
        action: "submit",
        resource: "upk_note",
      }).effect,
    ).toBe("ALLOW");
    expect(
      decide({
        role: "TENANT_ADMIN",
        action: "submit",
        resource: "upk_note",
      }).effect,
    ).toBe("ALLOW");
    expect(
      decide({
        role: "LEAD_FINANCE",
        action: "submit",
        resource: "upk_note",
      }).effect,
    ).toBe("DENY");
    expect(
      decide({ role: "EMPLOYEE", action: "submit", resource: "upk_note" }).effect,
    ).toBe("DENY");
  });

  it("approve/reject — Finance + mgmt + OM allowed", () => {
    for (const role of [
      "LEAD_FINANCE",
      "HR_ADMIN",
      "TENANT_ADMIN",
      "OPERATIONS_MANAGER",
    ] as EmployeeRole[]) {
      for (const action of ["approve", "reject"] as const) {
        expect(
          decide({ role, action, resource: "upk_note" }).effect,
        ).toBe("ALLOW");
      }
    }
    for (const role of ["EMPLOYEE", "SUPERVISOR", "PROJECT_MANAGER"] as EmployeeRole[]) {
      expect(
        decide({ role, action: "approve", resource: "upk_note" }).effect,
      ).toBe("DENY");
    }
  });

  it("cancel restricted to HR/Admin", () => {
    expect(
      decide({ role: "HR_ADMIN", action: "cancel", resource: "upk_note" }).effect,
    ).toBe("ALLOW");
    expect(
      decide({
        role: "PROJECT_MANAGER",
        action: "cancel",
        resource: "upk_note",
      }).effect,
    ).toBe("DENY");
  });

  it("DENYs unsupported action (non-admin path)", () => {
    expect(
      decide({
        role: "PROJECT_MANAGER",
        action: "disburse",
        resource: "upk_note",
      }).effect,
    ).toBe("DENY");
  });
});

// ---------------------------------------------------------------------
// monthly_report
// ---------------------------------------------------------------------
describe("pdp — monthly_report", () => {
  it("read always ALLOW (RLS narrows)", () => {
    expect(
      decide({ role: "EMPLOYEE", action: "read", resource: "monthly_report" }).effect,
    ).toBe("ALLOW");
  });

  it.each([
    ["SUPERVISOR", "ALLOW"],
    ["PROJECT_MANAGER", "ALLOW"],
    ["OPERATIONS_MANAGER", "ALLOW"],
    ["HEAD_MANAGER", "ALLOW"],
    ["GENERAL_MANAGER", "ALLOW"],
    ["TENANT_ADMIN", "ALLOW"],
    ["EMPLOYEE", "DENY"],
    ["LEAD_FINANCE", "DENY"],
    ["HR_ADMIN", "DENY"],
  ] as const)("create/update/submit for %s → %s", (role, expected) => {
    for (const action of ["create", "update", "submit"] as const) {
      const d = decide({
        role: role as EmployeeRole,
        action,
        resource: "monthly_report",
      });
      expect(d.effect).toBe(expected);
    }
  });

  it("approve/reject includes Finance (BA-gen fallback)", () => {
    expect(
      decide({
        role: "LEAD_FINANCE",
        action: "approve",
        resource: "monthly_report",
      }).effect,
    ).toBe("ALLOW");
    expect(
      decide({
        role: "PROJECT_MANAGER",
        action: "reject",
        resource: "monthly_report",
      }).effect,
    ).toBe("ALLOW");
    expect(
      decide({
        role: "EMPLOYEE",
        action: "approve",
        resource: "monthly_report",
      }).effect,
    ).toBe("DENY");
  });

  it("cancel restricted to management (OM/HM/GM/Admin)", () => {
    expect(
      decide({
        role: "OPERATIONS_MANAGER",
        action: "cancel",
        resource: "monthly_report",
      }).effect,
    ).toBe("ALLOW");
    expect(
      decide({
        role: "PROJECT_MANAGER",
        action: "cancel",
        resource: "monthly_report",
      }).effect,
    ).toBe("DENY");
    expect(
      decide({
        role: "LEAD_FINANCE",
        action: "cancel",
        resource: "monthly_report",
      }).effect,
    ).toBe("DENY");
  });

  it("DENYs unsupported action (non-admin path)", () => {
    expect(
      decide({
        role: "PROJECT_MANAGER",
        action: "disburse",
        resource: "monthly_report",
      }).effect,
    ).toBe("DENY");
  });
});

// ---------------------------------------------------------------------
// import_job
// ---------------------------------------------------------------------
describe("pdp — import_job", () => {
  it("read/create for admin roles", () => {
    for (const role of ["TENANT_ADMIN", "HR_ADMIN"] as EmployeeRole[]) {
      expect(
        decide({ role, action: "read", resource: "import_job" }).effect,
      ).toBe("ALLOW");
      expect(
        decide({ role, action: "create", resource: "import_job" }).effect,
      ).toBe("ALLOW");
    }
  });

  it("EMPLOYEE cannot manage import jobs", () => {
    expect(
      decide({
        role: "EMPLOYEE",
        action: "create",
        resource: "import_job",
      }).effect,
    ).toBe("DENY");
  });
});

// ---------------------------------------------------------------------
// Integration / admin config surfaces (telegram_bot_config,
// whatsapp_config, calendar_sync, lookup_option, user_admin, coa).
// These are compact resources whose decision helpers were previously
// uncovered — each contributes a few branches to the security folder
// coverage floor.
// ---------------------------------------------------------------------

describe("pdp — telegram_bot_config", () => {
  it("admin/GM may read + mutate", () => {
    for (const role of ["GENERAL_MANAGER", "TENANT_ADMIN"] as EmployeeRole[]) {
      for (const action of ["read", "create", "update", "delete"] as const) {
        expect(
          decide({ role, action, resource: "telegram_bot_config" }).effect,
        ).toBe("ALLOW");
      }
    }
  });
  it("non-admin roles are denied", () => {
    for (const action of ["read", "create", "update", "delete"] as const) {
      expect(
        decide({
          role: "PROJECT_MANAGER",
          action,
          resource: "telegram_bot_config",
        }).effect,
      ).toBe("DENY");
    }
  });
  it("unsupported action → DENY", () => {
    expect(
      decide({
        role: "GENERAL_MANAGER",
        action: "submit",
        resource: "telegram_bot_config",
      }).effect,
    ).toBe("DENY");
  });
});

describe("pdp — whatsapp_config", () => {
  it("admin/GM may read + mutate", () => {
    for (const role of ["GENERAL_MANAGER", "TENANT_ADMIN"] as EmployeeRole[]) {
      for (const action of ["read", "create", "update", "delete"] as const) {
        expect(
          decide({ role, action, resource: "whatsapp_config" }).effect,
        ).toBe("ALLOW");
      }
    }
  });
  it("EMPLOYEE denied for every WA config verb", () => {
    for (const action of ["read", "create", "update", "delete"] as const) {
      expect(
        decide({
          role: "EMPLOYEE",
          action,
          resource: "whatsapp_config",
        }).effect,
      ).toBe("DENY");
    }
  });
  it("unsupported action → DENY", () => {
    expect(
      decide({
        role: "GENERAL_MANAGER",
        action: "submit",
        resource: "whatsapp_config",
      }).effect,
    ).toBe("DENY");
  });
});

describe("pdp — calendar_sync", () => {
  it("admin/GM can read + update sync outbox (only two supported verbs)", () => {
    for (const role of ["GENERAL_MANAGER", "TENANT_ADMIN"] as EmployeeRole[]) {
      for (const action of ["read", "update"] as const) {
        expect(
          decide({ role, action, resource: "calendar_sync" }).effect,
        ).toBe("ALLOW");
      }
    }
  });
  it("PM cannot read/update calendar sync", () => {
    for (const action of ["read", "update"] as const) {
      expect(
        decide({
          role: "PROJECT_MANAGER",
          action,
          resource: "calendar_sync",
        }).effect,
      ).toBe("DENY");
    }
  });
  it("delete is intentionally unsupported (rows kept for audit history)", () => {
    expect(
      decide({
        role: "GENERAL_MANAGER",
        action: "delete",
        resource: "calendar_sync",
      }).effect,
    ).toBe("DENY");
  });
});

describe("pdp — lookup_option", () => {
  it("everyone can read lookup options", () => {
    for (const role of [
      "EMPLOYEE",
      "SUPERVISOR",
      "PROJECT_MANAGER",
      "HR_ADMIN",
      "LEAD_FINANCE",
    ] as EmployeeRole[]) {
      expect(
        decide({ role, action: "read", resource: "lookup_option" }).effect,
      ).toBe("ALLOW");
    }
  });
  it("only TENANT_ADMIN + GM may curate; others denied", () => {
    for (const action of ["create", "update", "delete"] as const) {
      expect(
        decide({
          role: "GENERAL_MANAGER",
          action,
          resource: "lookup_option",
        }).effect,
      ).toBe("ALLOW");
      expect(
        decide({
          role: "EMPLOYEE",
          action,
          resource: "lookup_option",
        }).effect,
      ).toBe("DENY");
    }
  });
  it("unsupported action → DENY", () => {
    expect(
      decide({
        role: "GENERAL_MANAGER",
        action: "submit",
        resource: "lookup_option",
      }).effect,
    ).toBe("DENY");
  });
});

describe("pdp — user_admin", () => {
  it("TENANT_ADMIN / HR_ADMIN may list users", () => {
    for (const role of ["TENANT_ADMIN", "HR_ADMIN"] as EmployeeRole[]) {
      expect(
        decide({ role, action: "read", resource: "user_admin" }).effect,
      ).toBe("ALLOW");
    }
  });
  it("only TENANT_ADMIN may mutate", () => {
    for (const action of ["create", "update", "delete"] as const) {
      // HR_ADMIN can read but NOT mutate — proves the reader/writer split.
      expect(
        decide({ role: "HR_ADMIN", action, resource: "user_admin" }).effect,
      ).toBe("DENY");
    }
  });
  it("non-admin roles denied on read + mutations", () => {
    for (const action of ["read", "create", "update", "delete"] as const) {
      expect(
        decide({
          role: "PROJECT_MANAGER",
          action,
          resource: "user_admin",
        }).effect,
      ).toBe("DENY");
    }
  });
  it("unsupported action → DENY", () => {
    expect(
      decide({
        role: "HR_ADMIN",
        action: "submit",
        resource: "user_admin",
      }).effect,
    ).toBe("DENY");
  });
});

describe("pdp — coa (chart of accounts)", () => {
  it("LEAD_FINANCE may create/update", () => {
    for (const action of ["create", "update"] as const) {
      expect(
        decide({ role: "LEAD_FINANCE", action, resource: "coa" }).effect,
      ).toBe("ALLOW");
    }
  });
  it("non-finance roles denied on mutations", () => {
    for (const action of ["create", "update"] as const) {
      expect(
        decide({
          role: "PROJECT_MANAGER",
          action,
          resource: "coa",
        }).effect,
      ).toBe("DENY");
    }
  });
  it("delete is never allowed (deactivate-only policy)", () => {
    expect(
      decide({
        role: "LEAD_FINANCE",
        action: "delete",
        resource: "coa",
      }).effect,
    ).toBe("DENY");
  });
});

describe("pdp — secret_rotation", () => {
  it("only admin roles can read the rotation dashboard", () => {
    for (const role of ["TENANT_ADMIN", "GENERAL_MANAGER"] as EmployeeRole[]) {
      expect(
        decide({ role, action: "read", resource: "secret_rotation" }).effect,
      ).toBe("ALLOW");
    }
    // A non-admin like PROJECT_MANAGER goes through the generic
    // "allowReadWithinTenant" and lands on the resource's DENY branch.
    expect(
      decide({
        role: "PROJECT_MANAGER",
        action: "read",
        resource: "secret_rotation",
      }).effect,
    ).toBe("DENY");
  });
  it("only TENANT_ADMIN can mark rotation via update (GM read-only)", () => {
    expect(
      decide({
        role: "GENERAL_MANAGER",
        action: "update",
        resource: "secret_rotation",
      }).effect,
    ).toBe("DENY");
    expect(
      decide({
        role: "LEAD_FINANCE",
        action: "update",
        resource: "secret_rotation",
      }).effect,
    ).toBe("DENY");
  });
  it("unsupported verbs (create / delete) fall to DENY", () => {
    for (const action of ["create", "delete"] as const) {
      expect(
        decide({
          role: "GENERAL_MANAGER",
          action,
          resource: "secret_rotation",
        }).effect,
      ).toBe("DENY");
    }
  });
});

describe("pdp — data_archive", () => {
  it("only admin roles may act on data archive", () => {
    for (const action of ["read", "create", "delete"] as const) {
      expect(
        decide({
          role: "TENANT_ADMIN",
          action,
          resource: "data_archive",
        }).effect,
      ).toBe("ALLOW");
      expect(
        decide({
          role: "PROJECT_MANAGER",
          action,
          resource: "data_archive",
        }).effect,
      ).toBe("DENY");
    }
  });
});

describe("pdp — audit_log", () => {
  it("compliance readers can list audit rows", () => {
    for (const role of [
      "TENANT_ADMIN",
      "GENERAL_MANAGER",
      "LEAD_FINANCE",
      "HR_ADMIN",
    ] as EmployeeRole[]) {
      expect(
        decide({ role, action: "read", resource: "audit_log" }).effect,
      ).toBe("ALLOW");
    }
    expect(
      decide({
        role: "EMPLOYEE",
        action: "read",
        resource: "audit_log",
      }).effect,
    ).toBe("DENY");
  });
  it("audit rows are immutable — no create/update/delete", () => {
    for (const action of ["create", "update", "delete"] as const) {
      expect(
        decide({
          role: "TENANT_ADMIN",
          action,
          resource: "audit_log",
        }).effect,
      ).toBe("ALLOW"); // admin override at authorize() top-level bypasses helper.
      expect(
        decide({
          role: "LEAD_FINANCE",
          action,
          resource: "audit_log",
        }).effect,
      ).toBe("DENY");
    }
  });
});

// ---------------------------------------------------------------------
// petty_cash_fund + petty_cash_replenishment coverage sweep
// ---------------------------------------------------------------------
describe("pdp — petty_cash_fund", () => {
  it.each([
    ["LEAD_FINANCE", "ALLOW"],
    ["PROJECT_MANAGER", "DENY"],
    ["PETTY_CASH_CUSTODIAN", "DENY"],
    ["EMPLOYEE", "DENY"],
  ] as const)("gates create for %s → %s", (role, expected) => {
    for (const action of ["create", "update", "delete"] as const) {
      expect(
        decide({
          role: role as EmployeeRole,
          action,
          resource: "petty_cash_fund",
        }).effect,
      ).toBe(expected);
    }
  });
  it("denies unsupported actions", () => {
    expect(
      decide({
        role: "LEAD_FINANCE",
        action: "settle",
        resource: "petty_cash_fund",
      }).effect,
    ).toBe("DENY");
  });
});

describe("pdp — petty_cash_replenishment", () => {
  it("only custodian may create/submit", () => {
    for (const action of ["create", "submit"] as const) {
      expect(
        decide({
          role: "PETTY_CASH_CUSTODIAN",
          action,
          resource: "petty_cash_replenishment",
        }).effect,
      ).toBe("ALLOW");
      expect(
        decide({
          role: "LEAD_FINANCE",
          action,
          resource: "petty_cash_replenishment",
        }).effect,
      ).toBe("DENY");
      expect(
        decide({
          role: "EMPLOYEE",
          action,
          resource: "petty_cash_replenishment",
        }).effect,
      ).toBe("DENY");
    }
  });
  it("custodian and finance may manage docs (update/delete)", () => {
    for (const action of ["update", "delete"] as const) {
      expect(
        decide({
          role: "PETTY_CASH_CUSTODIAN",
          action,
          resource: "petty_cash_replenishment",
        }).effect,
      ).toBe("ALLOW");
      expect(
        decide({
          role: "LEAD_FINANCE",
          action,
          resource: "petty_cash_replenishment",
        }).effect,
      ).toBe("ALLOW");
      expect(
        decide({
          role: "EMPLOYEE",
          action,
          resource: "petty_cash_replenishment",
        }).effect,
      ).toBe("DENY");
    }
  });
  it("only finance may approve/reject/disburse", () => {
    for (const action of ["approve", "reject", "disburse"] as const) {
      expect(
        decide({
          role: "LEAD_FINANCE",
          action,
          resource: "petty_cash_replenishment",
        }).effect,
      ).toBe("ALLOW");
      expect(
        decide({
          role: "PETTY_CASH_CUSTODIAN",
          action,
          resource: "petty_cash_replenishment",
        }).effect,
      ).toBe("DENY");
    }
  });
  it("denies unsupported actions", () => {
    expect(
      decide({
        role: "LEAD_FINANCE",
        action: "settle",
        resource: "petty_cash_replenishment",
      }).effect,
    ).toBe("DENY");
  });
});

// ---------------------------------------------------------------------
// pm_handover — status-driven approval matrix (rules §13)
// ---------------------------------------------------------------------
describe("pdp — pm_handover", () => {
  it("only OM+ may initiate", () => {
    for (const action of ["create", "submit"] as const) {
      expect(
        decide({
          role: "OPERATIONS_MANAGER",
          action,
          resource: "pm_handover",
        }).effect,
      ).toBe("ALLOW");
      expect(
        decide({
          role: "HEAD_MANAGER",
          action,
          resource: "pm_handover",
        }).effect,
      ).toBe("ALLOW");
      expect(
        decide({
          role: "PROJECT_MANAGER",
          action,
          resource: "pm_handover",
        }).effect,
      ).toBe("DENY");
      expect(
        decide({
          role: "EMPLOYEE",
          action,
          resource: "pm_handover",
        }).effect,
      ).toBe("DENY");
    }
  });
  it("initiator (owner) can cancel their own handover", () => {
    const meId = "e-PROJECT_MANAGER";
    // owner match — PM (not OM+) can cancel because they're the owner.
    const d = authorize({
      actor: {
        userId: "u-PM",
        employeeId: meId,
        role: "PROJECT_MANAGER",
        tenantId: TENANT,
      },
      action: "cancel",
      resource: "pm_handover",
      attributes: { tenantId: TENANT, ownerEmployeeId: meId },
    });
    expect(d.effect).toBe("ALLOW");
  });
  it("non-owner PM cannot cancel handover; OM+ still may", () => {
    const nonOwnerPm = decide({
      role: "PROJECT_MANAGER",
      action: "cancel",
      resource: "pm_handover",
      attributes: { tenantId: TENANT, ownerEmployeeId: "e-someone-else" },
    });
    expect(nonOwnerPm.effect).toBe("DENY");
    const om = decide({
      role: "OPERATIONS_MANAGER",
      action: "cancel",
      resource: "pm_handover",
      attributes: { tenantId: TENANT, ownerEmployeeId: "e-someone-else" },
    });
    expect(om.effect).toBe("ALLOW");
  });
  it("approve requires the correct pending-status role", () => {
    // PENDING_OM → OPERATIONS_MANAGER
    expect(
      decide({
        role: "OPERATIONS_MANAGER",
        action: "approve",
        resource: "pm_handover",
        attributes: { tenantId: TENANT, status: "PENDING_OM" },
      }).effect,
    ).toBe("ALLOW");
    // PENDING_OM w/ HEAD_MANAGER → DENY
    expect(
      decide({
        role: "HEAD_MANAGER",
        action: "approve",
        resource: "pm_handover",
        attributes: { tenantId: TENANT, status: "PENDING_OM" },
      }).effect,
    ).toBe("DENY");
    // PENDING_HM → HEAD_MANAGER
    expect(
      decide({
        role: "HEAD_MANAGER",
        action: "reject",
        resource: "pm_handover",
        attributes: { tenantId: TENANT, status: "PENDING_HM" },
      }).effect,
    ).toBe("ALLOW");
    expect(
      decide({
        role: "OPERATIONS_MANAGER",
        action: "reject",
        resource: "pm_handover",
        attributes: { tenantId: TENANT, status: "PENDING_HM" },
      }).effect,
    ).toBe("DENY");
    // Unknown status → DENY
    expect(
      decide({
        role: "OPERATIONS_MANAGER",
        action: "approve",
        resource: "pm_handover",
        attributes: { tenantId: TENANT, status: "SETTLED" },
      }).effect,
    ).toBe("DENY");
  });
  it("only OM+ may execute (settle) approved handover", () => {
    expect(
      decide({
        role: "OPERATIONS_MANAGER",
        action: "settle",
        resource: "pm_handover",
      }).effect,
    ).toBe("ALLOW");
    expect(
      decide({
        role: "PROJECT_MANAGER",
        action: "settle",
        resource: "pm_handover",
      }).effect,
    ).toBe("DENY");
  });
  it("denies unsupported action on pm_handover", () => {
    expect(
      decide({
        role: "OPERATIONS_MANAGER",
        action: "disburse",
        resource: "pm_handover",
      }).effect,
    ).toBe("DENY");
  });
});

// ---------------------------------------------------------------------
// ai_insight — coverage for both allowed-role and denied-role branches
// ---------------------------------------------------------------------
describe("pdp — ai_insight", () => {
  it("ai_insight reads pass through allowReadWithinTenant → ALLOW for any tenant member", () => {
    // Note: read gates for ai_insight actually bypass decideAiInsight
    // because authorize() short-circuits reads via allowReadWithinTenant
    // (which falls to the generic tenant-scoped ALLOW). Enforcement of
    // "who may see AI results" happens in the surface (route / RSC) via
    // reportsForRole and the AI Insight route guard, not via PDP read.
    for (const role of [
      "TENANT_ADMIN",
      "PROJECT_MANAGER",
      "EMPLOYEE",
      "SUPERVISOR",
      "HR_ADMIN",
    ] as EmployeeRole[]) {
      expect(
        decide({ role, action: "read", resource: "ai_insight" }).effect,
      ).toBe("ALLOW");
    }
  });
  it.each([
    ["PROJECT_MANAGER", "ALLOW"],
    ["EMPLOYEE", "DENY"],
    ["HR_ADMIN", "DENY"],
  ] as const)("gates create (trigger) for %s → %s", (role, expected) => {
    expect(
      decide({
        role: role as EmployeeRole,
        action: "create",
        resource: "ai_insight",
      }).effect,
    ).toBe(expected);
  });
  it("denies unsupported ai_insight action", () => {
    expect(
      decide({
        role: "PROJECT_MANAGER",
        action: "delete",
        resource: "ai_insight",
      }).effect,
    ).toBe("DENY");
  });
});

// ---------------------------------------------------------------------
// report — pure read gate
// ---------------------------------------------------------------------
describe("pdp — report", () => {
  it("only PM+ / Finance / Custodian tiers may read reports", () => {
    for (const role of [
      "PROJECT_MANAGER",
      "OPERATIONS_MANAGER",
      "HEAD_MANAGER",
      "GENERAL_MANAGER",
      "LEAD_FINANCE",
      "HR_ADMIN",
      "TENANT_ADMIN",
      "PETTY_CASH_CUSTODIAN",
    ] as EmployeeRole[]) {
      expect(
        decide({ role, action: "read", resource: "report" }).effect,
      ).toBe("ALLOW");
    }
    for (const role of ["EMPLOYEE", "SUPERVISOR"] as EmployeeRole[]) {
      expect(
        decide({ role, action: "read", resource: "report" }).effect,
      ).toBe("DENY");
    }
  });
  it("denies all non-read actions on report", () => {
    for (const action of ["create", "update", "delete"] as const) {
      expect(
        decide({
          role: "PROJECT_MANAGER",
          action,
          resource: "report",
        }).effect,
      ).toBe("DENY");
    }
  });
});

// ---------------------------------------------------------------------
// import_job — role-gated bulk mutation
// ---------------------------------------------------------------------
describe("pdp — import_job branches", () => {
  it("bulk_import + create share the same allow-list", () => {
    for (const action of ["bulk_import", "create"] as const) {
      expect(
        decide({
          role: "HR_ADMIN",
          action,
          resource: "import_job",
        }).effect,
      ).toBe("ALLOW");
      expect(
        decide({
          role: "PROJECT_MANAGER",
          action,
          resource: "import_job",
        }).effect,
      ).toBe("DENY");
    }
  });
  it("denies unsupported actions (delete)", () => {
    expect(
      decide({
        role: "HR_ADMIN",
        action: "delete",
        resource: "import_job",
      }).effect,
    ).toBe("DENY");
  });
});

// ---------------------------------------------------------------------
// coa — reads via allowReadWithinTenant; writes gated to LEAD_FINANCE
// ---------------------------------------------------------------------
describe("pdp — coa branches", () => {
  it("read is allowed for any tenant member (delegated to allowRead)", () => {
    for (const role of [
      "EMPLOYEE",
      "SUPERVISOR",
      "PROJECT_MANAGER",
      "LEAD_FINANCE",
    ] as EmployeeRole[]) {
      expect(decide({ role, action: "read", resource: "coa" }).effect).toBe(
        "ALLOW",
      );
    }
  });
  it("only LEAD_FINANCE (or TENANT_ADMIN via top-level override) may curate CoA", () => {
    for (const action of ["create", "update"] as const) {
      expect(
        decide({ role: "LEAD_FINANCE", action, resource: "coa" }).effect,
      ).toBe("ALLOW");
      expect(
        decide({ role: "PROJECT_MANAGER", action, resource: "coa" }).effect,
      ).toBe("DENY");
    }
  });
  it("delete is denied — CoA rows must be deactivated", () => {
    // Even the top-level admin override does not bypass this because
    // the switch enforces DENY regardless of role. But the top-level
    // authorize() short-circuits admin at line ~150 before reaching
    // here — so we probe with a non-admin.
    expect(
      decide({ role: "LEAD_FINANCE", action: "delete", resource: "coa" })
        .effect,
    ).toBe("DENY");
  });
  it("denies unsupported action on coa", () => {
    expect(
      decide({ role: "LEAD_FINANCE", action: "submit", resource: "coa" })
        .effect,
    ).toBe("DENY");
  });
});
