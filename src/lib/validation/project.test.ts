import { describe, expect, it } from "vitest";

import {
  createEmployeeAssignmentSchema,
  createPmAssignmentSchema,
  createProjectSchema,
  PROJECT_STATUSES,
  projectStatusSchema,
  upsertProjectBudgetSchema,
} from "@/lib/validation/project";

const UUID_A = "00000000-0000-4000-8000-00000000000a";
const UUID_B = "00000000-0000-4000-8000-00000000000b";

describe("project schema", () => {
  it("accepts a minimal valid project", () => {
    const parsed = createProjectSchema.parse({
      client_id: UUID_A,
      name: "Onboarding Wave 1",
      project_type: "FIXED_PRICE",
    });
    expect(parsed.status).toBe("DRAFT");
    expect(parsed.priority).toBe("MEDIUM");
    expect(parsed.currency).toBe("IDR");
    expect(parsed.milestones).toEqual([]);
  });

  it("rejects project codes with invalid characters", () => {
    expect(() =>
      createProjectSchema.parse({
        client_id: UUID_A,
        code: "acme 01",
        name: "Test",
        project_type: "INTERNAL",
      }),
    ).toThrow();
  });

  it("rejects end_date earlier than start_date", () => {
    expect(() =>
      createProjectSchema.parse({
        client_id: UUID_A,
        name: "Test",
        project_type: "FIXED_PRICE",
        start_date: "2026-06-01",
        end_date: "2026-05-01",
      }),
    ).toThrow(/End date/i);
  });

  it("rejects milestone weights that don't sum to 100 (unless all zero)", () => {
    expect(() =>
      createProjectSchema.parse({
        client_id: UUID_A,
        name: "Test",
        project_type: "FIXED_PRICE",
        milestones: [
          { name: "M1", weight_pct: 40 },
          { name: "M2", weight_pct: 30 },
        ],
      }),
    ).toThrow(/sum to 100/i);
  });

  it("accepts milestones summing exactly to 100", () => {
    const parsed = createProjectSchema.parse({
      client_id: UUID_A,
      name: "Test",
      project_type: "FIXED_PRICE",
      milestones: [
        { name: "M1", weight_pct: 60 },
        { name: "M2", weight_pct: 40 },
      ],
    });
    expect(parsed.milestones).toHaveLength(2);
  });

  it("accepts milestones with all-zero weights (even distribution fallback)", () => {
    const parsed = createProjectSchema.parse({
      client_id: UUID_A,
      name: "Test",
      project_type: "FIXED_PRICE",
      milestones: [
        { name: "M1", weight_pct: 0 },
        { name: "M2", weight_pct: 0 },
      ],
    });
    expect(parsed.milestones).toHaveLength(2);
  });

  it("projectStatusSchema enumerates all statuses", () => {
    for (const status of PROJECT_STATUSES) {
      expect(projectStatusSchema.parse(status)).toBe(status);
    }
  });
});

describe("assignment schemas (rules §7)", () => {
  it("PM assignment defaults to PRIMARY_PM", () => {
    const parsed = createPmAssignmentSchema.parse({
      project_id: UUID_A,
      pm_employee_id: UUID_B,
    });
    expect(parsed.assignment_role).toBe("PRIMARY_PM");
  });

  it("employee assignment rejects allocation < 1%", () => {
    expect(() =>
      createEmployeeAssignmentSchema.parse({
        project_id: UUID_A,
        employee_id: UUID_B,
        allocation_percentage: 0,
      }),
    ).toThrow();
  });

  it("employee assignment rejects allocation > 100%", () => {
    expect(() =>
      createEmployeeAssignmentSchema.parse({
        project_id: UUID_A,
        employee_id: UUID_B,
        allocation_percentage: 101,
      }),
    ).toThrow();
  });

  it("employee assignment rejects non-integer allocation", () => {
    expect(() =>
      createEmployeeAssignmentSchema.parse({
        project_id: UUID_A,
        employee_id: UUID_B,
        allocation_percentage: 50.5,
      }),
    ).toThrow();
  });
});

describe("project budget schema", () => {
  it("accepts a valid budget", () => {
    const parsed = upsertProjectBudgetSchema.parse({
      project_id: UUID_A,
      budget_amount_idr: 250_000_000,
    });
    expect(parsed.budget_amount_idr).toBe(250_000_000);
  });

  it("rejects a negative budget", () => {
    expect(() =>
      upsertProjectBudgetSchema.parse({
        project_id: UUID_A,
        budget_amount_idr: -1,
      }),
    ).toThrow();
  });
});
