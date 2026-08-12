import { describe, expect, it } from "vitest";

import {
  OVERTIME_MULTIPLIER,
  computePayroll,
  directLabourCost,
} from "./compute";

describe("payroll compute", () => {
  it("uses 1.5x overtime multiplier by default", () => {
    expect(OVERTIME_MULTIPLIER).toBe(1.5);
  });

  it("computes gross = base + overtime + allowance", () => {
    const res = computePayroll({
      monthly_salary: 10_000_000,
      hourly_rate: 100_000,
      hours_worked: 160,
      hours_overtime: 4,
      shift_allowance_total: 200_000,
    });
    expect(res.base_salary).toBe(10_000_000);
    // 4h × 100k × 1.5 = 600k
    expect(res.overtime_pay).toBe(600_000);
    expect(res.shift_allowance).toBe(200_000);
    expect(res.gross_pay).toBe(10_800_000);
    expect(res.net_pay).toBe(10_800_000);
  });

  it("subtracts deductions from net", () => {
    const res = computePayroll({
      monthly_salary: 5_000_000,
      hourly_rate: 50_000,
      hours_worked: 0,
      hours_overtime: 0,
      shift_allowance_total: 0,
      deductions: 350_000,
    });
    expect(res.deductions).toBe(350_000);
    expect(res.net_pay).toBe(4_650_000);
  });

  it("clamps negative inputs to 0", () => {
    const res = computePayroll({
      monthly_salary: -1000,
      hourly_rate: -100,
      hours_worked: -1,
      hours_overtime: -1,
      shift_allowance_total: -50,
    });
    expect(res.base_salary).toBe(0);
    expect(res.overtime_pay).toBe(0);
    expect(res.shift_allowance).toBe(0);
    expect(res.gross_pay).toBe(0);
    expect(res.net_pay).toBe(0);
  });

  it("handles Infinity / NaN safely", () => {
    const res = computePayroll({
      monthly_salary: Number.NaN,
      hourly_rate: Number.POSITIVE_INFINITY,
      hours_worked: 8,
      hours_overtime: 1,
      shift_allowance_total: 0,
    });
    expect(res.base_salary).toBe(0);
    expect(Number.isFinite(res.overtime_pay)).toBe(true);
  });

  it("directLabourCost matches SQL formula", () => {
    // 100h × 80k = 8jt; 5h × 80k × 1.5 = 600k; allowance 300k = 8.9jt.
    expect(
      directLabourCost({
        hours_worked: 100,
        hours_overtime: 5,
        hourly_rate: 80_000,
        shift_allowance_total: 300_000,
      }),
    ).toBe(8_900_000);
  });
});
