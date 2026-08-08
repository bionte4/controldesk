import { describe, expect, it } from "vitest";

import {
  createEmployeeSchema,
  NON_PERMANENT_TYPES,
} from "./employee";

const base = {
  first_name: "Sinta",
  last_name: "Putri",
  email: "sinta@example.com",
  phone: "+62 812 3456 7890",
  department: "Operations",
  position_title: "Analyst",
  role: "EMPLOYEE" as const,
  join_date: "2026-01-15",
  availability: "AVAILABLE" as const,
};

describe("createEmployeeSchema", () => {
  it("accepts a valid PERMANENT without end date", () => {
    const result = createEmployeeSchema.safeParse({
      ...base,
      employment_type: "PERMANENT",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid PERMANENT with dob (trigger will compute end date at DB)", () => {
    const result = createEmployeeSchema.safeParse({
      ...base,
      employment_type: "PERMANENT",
      date_of_birth: "1990-05-10",
    });
    expect(result.success).toBe(true);
  });

  it.each(NON_PERMANENT_TYPES)(
    "rejects %s without contract_end_date",
    (kind) => {
      const result = createEmployeeSchema.safeParse({
        ...base,
        employment_type: kind,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message);
        expect(messages.some((m) => m.includes("End date is required"))).toBe(
          true,
        );
      }
    },
  );

  it.each(NON_PERMANENT_TYPES)(
    "accepts %s when contract_end_date is provided",
    (kind) => {
      const result = createEmployeeSchema.safeParse({
        ...base,
        employment_type: kind,
        contract_end_date: "2027-01-14",
      });
      expect(result.success).toBe(true);
    },
  );

  it("rejects end date earlier than join date", () => {
    const result = createEmployeeSchema.safeParse({
      ...base,
      employment_type: "CONTRACT",
      contract_end_date: "2025-12-31",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes("End date must be on or after"),
        ),
      ).toBe(true);
    }
  });

  it("rejects clearly implausible DOB (age < 17)", () => {
    const currentYear = new Date().getFullYear();
    const tooYoung = `${currentYear - 10}-01-01`;
    const result = createEmployeeSchema.safeParse({
      ...base,
      employment_type: "PERMANENT",
      date_of_birth: tooYoung,
    });
    expect(result.success).toBe(false);
  });

  it("normalizes email to lowercase and trims", () => {
    const result = createEmployeeSchema.safeParse({
      ...base,
      email: "  MIXED.Case@Example.COM  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("mixed.case@example.com");
    }
  });

  it("collapses blank optional fields to undefined", () => {
    const result = createEmployeeSchema.safeParse({
      ...base,
      last_name: "   ",
      phone: undefined,
      department: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.last_name).toBeUndefined();
      expect(result.data.department).toBeUndefined();
    }
  });
});
