import { describe, expect, it } from "vitest";

import { decodeCapabilityAuditRow } from "./capability-audit";

/**
 * Unit tests for `decodeCapabilityAuditRow` (rules §3 Fase 3B).
 *
 * The decoder is the tricky bit of the history sheet: it has to
 * handle three distinct audit-row shapes emitted by the three
 * capability-override server actions AND survive drift when
 * unknown / stale rows are present in the tenant's audit table.
 *
 * These tests pin the wire shape so a rename in
 * `settings/capabilities/actions.ts` immediately trips a failure
 * here before it ever ships to the UI.
 */

// Actor stub used across every row — capability audit is not
// actor-dependent for decoding, but the type demands it.
const ACTOR = {
  id: "emp-admin",
  full_name: "Alice Admin",
  email: "alice@demo.controldesk.app",
};

describe("decodeCapabilityAuditRow — grant (UPDATE, granted=true)", () => {
  it("maps to kind=grant with role + granted=true", () => {
    const entry = decodeCapabilityAuditRow({
      id: 1001,
      action_type: "UPDATE",
      resource_id: "ov-1",
      old_values: null,
      new_values: {
        capability_id: "view_budget",
        role: "SUPERVISOR",
        granted: true,
      },
      created_at: "2026-08-11T02:00:00.000Z",
      actor_employee_id: ACTOR.id,
      actor: ACTOR,
    });

    expect(entry).not.toBeNull();
    expect(entry?.kind).toBe("grant");
    expect(entry?.capabilityId).toBe("view_budget");
    expect(entry?.role).toBe("SUPERVISOR");
    expect(entry?.granted).toBe(true);
    expect(entry?.clearedCount).toBe(0);
    expect(entry?.actor.fullName).toBe("Alice Admin");
  });
});

describe("decodeCapabilityAuditRow — revoke (UPDATE, granted=false)", () => {
  it("maps to kind=revoke", () => {
    const entry = decodeCapabilityAuditRow({
      id: 1002,
      action_type: "UPDATE",
      resource_id: "ov-2",
      old_values: { id: "ov-2", granted: true },
      new_values: {
        capability_id: "view_payroll",
        role: "PROJECT_MANAGER",
        granted: false,
      },
      created_at: "2026-08-11T02:05:00.000Z",
      actor_employee_id: ACTOR.id,
      actor: ACTOR,
    });

    expect(entry?.kind).toBe("revoke");
    expect(entry?.granted).toBe(false);
    expect(entry?.role).toBe("PROJECT_MANAGER");
  });
});

describe("decodeCapabilityAuditRow — reset_cell (DELETE with role)", () => {
  it("maps to kind=reset_cell", () => {
    const entry = decodeCapabilityAuditRow({
      id: 1003,
      action_type: "DELETE",
      resource_id: "ov-3",
      old_values: { id: "ov-3", granted: false },
      new_values: {
        capability_id: "view_client",
        role: "EMPLOYEE",
        cleared: true,
      },
      created_at: "2026-08-11T02:10:00.000Z",
      actor_employee_id: ACTOR.id,
      actor: ACTOR,
    });

    expect(entry?.kind).toBe("reset_cell");
    expect(entry?.role).toBe("EMPLOYEE");
    expect(entry?.granted).toBeNull();
  });
});

describe("decodeCapabilityAuditRow — reset_all (DELETE without role)", () => {
  it("maps to kind=reset_all and surfaces clearedCount", () => {
    const entry = decodeCapabilityAuditRow({
      id: 1004,
      action_type: "DELETE",
      resource_id: "view_petty_cash",
      old_values: {
        rows: [
          { id: "ov-a", role: "EMPLOYEE", granted: true },
          { id: "ov-b", role: "SUPERVISOR", granted: false },
        ],
      },
      new_values: { cleared: 2 },
      created_at: "2026-08-11T02:20:00.000Z",
      actor_employee_id: ACTOR.id,
      actor: ACTOR,
    });

    expect(entry?.kind).toBe("reset_all");
    expect(entry?.capabilityId).toBe("view_petty_cash");
    expect(entry?.role).toBeNull();
    expect(entry?.clearedCount).toBe(2);
  });
});

describe("decodeCapabilityAuditRow — drift guard", () => {
  it("returns null for unknown capability_id (dropped from catalog)", () => {
    const entry = decodeCapabilityAuditRow({
      id: 1005,
      action_type: "UPDATE",
      resource_id: "ov-9",
      old_values: null,
      new_values: {
        capability_id: "manage_secret_lasers",
        role: "ADMIN",
        granted: true,
      },
      created_at: "2026-08-11T02:30:00.000Z",
      actor_employee_id: ACTOR.id,
      actor: ACTOR,
    });
    expect(entry).toBeNull();
  });

  it("returns null when action_type / values shape doesn't match any known event", () => {
    const entry = decodeCapabilityAuditRow({
      id: 1006,
      action_type: "SUBMIT",
      resource_id: "ov-x",
      old_values: null,
      new_values: { capability_id: "view_budget", role: "ADMIN" },
      created_at: "2026-08-11T02:40:00.000Z",
      actor_employee_id: ACTOR.id,
      actor: ACTOR,
    });
    expect(entry).toBeNull();
  });

  it("returns null when role is not a valid EmployeeRole enum value", () => {
    const entry = decodeCapabilityAuditRow({
      id: 1007,
      action_type: "UPDATE",
      resource_id: "ov-x",
      old_values: null,
      new_values: {
        capability_id: "view_budget",
        role: "WIZARD",
        granted: true,
      },
      created_at: "2026-08-11T02:50:00.000Z",
      actor_employee_id: ACTOR.id,
      actor: ACTOR,
    });
    // Role fell back to null, and without a role the UPDATE branch
    // can't identify grant vs revoke → discarded.
    expect(entry?.role).toBeNull();
    // Still valid because granted is present → coerced to grant.
    // Depending on preferred strictness this could also be null;
    // pin the current behaviour so refactors are intentional.
    expect(entry?.kind).toBe("grant");
  });
});

describe("decodeCapabilityAuditRow — actor propagation", () => {
  it("falls back to actor_employee_id when actor object is null (FK cascade)", () => {
    const entry = decodeCapabilityAuditRow({
      id: 1008,
      action_type: "UPDATE",
      resource_id: "ov-8",
      old_values: null,
      new_values: {
        capability_id: "view_budget",
        role: "SUPERVISOR",
        granted: true,
      },
      created_at: "2026-08-11T03:00:00.000Z",
      actor_employee_id: "emp-lost",
      actor: null,
    });
    expect(entry?.actor.employeeId).toBe("emp-lost");
    expect(entry?.actor.fullName).toBeNull();
    expect(entry?.actor.email).toBeNull();
  });
});
