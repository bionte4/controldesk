import { describe, expect, it } from "vitest";

import {
  computeUpkAmount,
  createUpkNoteSchema,
  decideUpkNoteSchema,
  UPK_DIRECTOR_THRESHOLD_IDR,
} from "./upk";

describe("computeUpkAmount", () => {
  it("returns 0 when any input is non-positive", () => {
    expect(computeUpkAmount({ baseSalaryIdr: 0, serviceMonths: 12, multiplier: 1 })).toBe(0);
    expect(computeUpkAmount({ baseSalaryIdr: 10, serviceMonths: 0, multiplier: 1 })).toBe(0);
    expect(computeUpkAmount({ baseSalaryIdr: 10, serviceMonths: 12, multiplier: 0 })).toBe(0);
  });

  it("applies base × multiplier × years", () => {
    // 5M × 1× × (24 / 12) = 10M
    expect(
      computeUpkAmount({ baseSalaryIdr: 5_000_000, serviceMonths: 24, multiplier: 1 }),
    ).toBe(10_000_000);
  });

  it("supports fractional multipliers", () => {
    // 8M × 0.5 × 1 year = 4M
    expect(
      computeUpkAmount({ baseSalaryIdr: 8_000_000, serviceMonths: 12, multiplier: 0.5 }),
    ).toBe(4_000_000);
  });

  it("rounds to whole rupiah", () => {
    expect(
      computeUpkAmount({ baseSalaryIdr: 3_333_333, serviceMonths: 5, multiplier: 1 }),
    ).toBeGreaterThan(0);
    expect(
      Number.isInteger(
        computeUpkAmount({ baseSalaryIdr: 3_333_333, serviceMonths: 5, multiplier: 1 }),
      ),
    ).toBe(true);
  });
});

describe("createUpkNoteSchema", () => {
  const base = {
    employee_id: "00000000-0000-4000-8000-000000000001",
    contract_end_date: "2026-12-31",
    service_months: 12,
    base_salary_idr: 5_000_000,
    multiplier: 1,
  };

  it("accepts a minimal valid payload", () => {
    const res = createUpkNoteSchema.safeParse(base);
    expect(res.success).toBe(true);
  });

  it("rejects negative base salary", () => {
    const res = createUpkNoteSchema.safeParse({ ...base, base_salary_idr: -100 });
    expect(res.success).toBe(false);
  });

  it("rejects service > 50 years", () => {
    const res = createUpkNoteSchema.safeParse({ ...base, service_months: 601 });
    expect(res.success).toBe(false);
  });

  it("rejects malformed date", () => {
    const res = createUpkNoteSchema.safeParse({
      ...base,
      contract_end_date: "31/12/2026",
    });
    expect(res.success).toBe(false);
  });
});

describe("decideUpkNoteSchema", () => {
  it("requires notes when rejecting", () => {
    const res = decideUpkNoteSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      decision: "REJECT",
    });
    expect(res.success).toBe(false);
  });

  it("allows approve without notes", () => {
    const res = decideUpkNoteSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      decision: "APPROVE",
    });
    expect(res.success).toBe(true);
  });
});

describe("UPK_DIRECTOR_THRESHOLD_IDR", () => {
  it("is 50 million rupiah", () => {
    expect(UPK_DIRECTOR_THRESHOLD_IDR).toBe(50_000_000);
  });
});
