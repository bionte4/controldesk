import { describe, expect, it } from "vitest";

import {
  ASSIGNMENT_ROLES,
  assignmentKindFromRole,
  createAssignmentSchema,
  endAssignmentSchema,
  isMemberRole,
  isPmRole,
  parseAllocationOverCap,
  PM_ASSIGNMENT_ROLES,
  PROJECT_MEMBER_ROLES,
  updateAssignmentSchema,
} from "./assignment";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

const baseValid = {
  project_id: UUID_A,
  employee_id: UUID_B,
  started_at: "2026-01-01",
};

describe("assignment role predicates", () => {
  it("PM role predicates are exhaustive & disjoint", () => {
    for (const r of PM_ASSIGNMENT_ROLES) {
      expect(isPmRole(r)).toBe(true);
      expect(isMemberRole(r)).toBe(false);
      expect(assignmentKindFromRole(r)).toBe("pm");
    }
    for (const r of PROJECT_MEMBER_ROLES) {
      expect(isPmRole(r)).toBe(false);
      expect(isMemberRole(r)).toBe(true);
      expect(assignmentKindFromRole(r)).toBe("member");
    }
  });

  it("ASSIGNMENT_ROLES is the union of PM + member roles", () => {
    expect(ASSIGNMENT_ROLES.length).toBe(
      PM_ASSIGNMENT_ROLES.length + PROJECT_MEMBER_ROLES.length,
    );
  });
});

describe("createAssignmentSchema — allocation bounds (rules §7)", () => {
  it("accepts a valid member assignment at 50%", () => {
    const parsed = createAssignmentSchema.parse({
      ...baseValid,
      role: "DEVELOPER",
      allocation_percentage: 50,
    });
    expect(parsed.allocation_percentage).toBe(50);
    expect(parsed.role).toBe("DEVELOPER");
  });

  it("rejects allocation < 1", () => {
    expect(() =>
      createAssignmentSchema.parse({
        ...baseValid,
        role: "DEVELOPER",
        allocation_percentage: 0,
      }),
    ).toThrow();
  });

  it("rejects allocation > 100", () => {
    expect(() =>
      createAssignmentSchema.parse({
        ...baseValid,
        role: "DEVELOPER",
        allocation_percentage: 101,
      }),
    ).toThrow();
  });

  it("rejects non-integer allocation", () => {
    expect(() =>
      createAssignmentSchema.parse({
        ...baseValid,
        role: "DEVELOPER",
        allocation_percentage: 50.5,
      }),
    ).toThrow();
  });

  it("requires PM assignments to be 100% allocation", () => {
    expect(() =>
      createAssignmentSchema.parse({
        ...baseValid,
        role: "PRIMARY_PM",
        allocation_percentage: 50,
      }),
    ).toThrow(/PM assignments require 100%/i);
  });

  it("accepts PM assignments at 100%", () => {
    const parsed = createAssignmentSchema.parse({
      ...baseValid,
      role: "PRIMARY_PM",
      allocation_percentage: 100,
    });
    expect(parsed.role).toBe("PRIMARY_PM");
  });

  it("rejects when ended_at precedes started_at", () => {
    expect(() =>
      createAssignmentSchema.parse({
        ...baseValid,
        role: "DEVELOPER",
        allocation_percentage: 50,
        ended_at: "2025-12-31",
      }),
    ).toThrow(/End date/);
  });

  it("accepts ended_at ≥ started_at", () => {
    const parsed = createAssignmentSchema.parse({
      ...baseValid,
      role: "DEVELOPER",
      allocation_percentage: 50,
      ended_at: "2026-06-30",
    });
    expect(parsed.ended_at).toBe("2026-06-30");
  });

  it("trims and normalises empty notes to undefined", () => {
    const parsed = createAssignmentSchema.parse({
      ...baseValid,
      role: "DEVELOPER",
      allocation_percentage: 50,
      notes: "",
    });
    expect(parsed.notes).toBeUndefined();
  });
});

describe("updateAssignmentSchema", () => {
  it("allows partial updates on member kind", () => {
    const parsed = updateAssignmentSchema.parse({
      id: UUID_A,
      kind: "member",
      allocation_percentage: 30,
    });
    expect(parsed.allocation_percentage).toBe(30);
  });

  it("rejects allocation change to non-100 on PM kind", () => {
    expect(() =>
      updateAssignmentSchema.parse({
        id: UUID_A,
        kind: "pm",
        allocation_percentage: 60,
      }),
    ).toThrow(/PM assignments require 100%/i);
  });
});

describe("endAssignmentSchema", () => {
  it("accepts id + kind only (defaults today server-side)", () => {
    const parsed = endAssignmentSchema.parse({ id: UUID_A, kind: "member" });
    expect(parsed.id).toBe(UUID_A);
    expect(parsed.kind).toBe("member");
  });

  it("accepts explicit ended_at", () => {
    const parsed = endAssignmentSchema.parse({
      id: UUID_A,
      kind: "pm",
      ended_at: "2026-12-31",
    });
    expect(parsed.ended_at).toBe("2026-12-31");
  });

  it("rejects unknown kind", () => {
    expect(() =>
      endAssignmentSchema.parse({ id: UUID_A, kind: "other" }),
    ).toThrow();
  });
});

describe("parseAllocationOverCap", () => {
  it("parses the trigger exception string", () => {
    const msg = `ALLOCATION_OVER_CAP:${UUID_A}:80:50`;
    const parsed = parseAllocationOverCap(msg);
    expect(parsed).not.toBeNull();
    expect(parsed?.employeeId).toBe(UUID_A);
    expect(parsed?.currentTotalPct).toBe(80);
    expect(parsed?.requestedPct).toBe(50);
  });

  it("returns null for unrelated errors", () => {
    expect(parseAllocationOverCap("unrelated postgres error")).toBeNull();
    expect(parseAllocationOverCap(null)).toBeNull();
    expect(parseAllocationOverCap(undefined)).toBeNull();
  });
});
