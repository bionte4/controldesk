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
      code: "ACME-01",
      name: "Onboarding Wave 1",
    });
    expect(parsed.code).toBe("ACME-01");
    expect(parsed.status).toBe("PLANNING");
  });

  it("rejects project codes with invalid characters", () => {
    expect(() =>
      createProjectSchema.parse({
        client_id: UUID_A,
        code: "acme 01",
        name: "Test",
      }),
    ).toThrow();
  });

  it("rejects end_date earlier than start_date", () => {
    expect(() =>
      createProjectSchema.parse({
        client_id: UUID_A,
        code: "ACME-02",
        name: "Test",
        start_date: "2026-06-01",
        end_date: "2026-05-01",
      }),
    ).toThrow(/End date/i);
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
