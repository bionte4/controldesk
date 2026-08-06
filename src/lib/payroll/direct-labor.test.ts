import { describe, expect, it } from "vitest";

import { aggregateDirectLaborCost } from "./direct-labor";

const EMP_A = "aaaaaaaa-0000-0000-0000-000000000001";
const EMP_B = "aaaaaaaa-0000-0000-0000-000000000002";

const rateA = 50_000; // Rp 50k/hr
const rateB = 75_000; // Rp 75k/hr

const employees = [
  { id: EMP_A, full_name: "Alpha", hourly_rate: rateA },
  { id: EMP_B, full_name: "Bravo", hourly_rate: rateB },
];

describe("aggregateDirectLaborCost — base math", () => {
  it("empty inputs → zero everything", () => {
    const r = aggregateDirectLaborCost({ timesheets: [], employees });
    expect(r.total_cost).toBe(0);
    expect(r.employees).toEqual([]);
    expect(r.provenance).toEqual({
      weekly_hours: 0,
      daily_only_hours: 0,
      weekly_share_pct: 0,
    });
  });

  it("single employee, no overtime", () => {
    const r = aggregateDirectLaborCost({
      timesheets: [
        {
          employee_id: EMP_A,
          project_id: "p1",
          hours_worked: 40,
          hours_overtime: 0,
          approved_via_weekly: true,
        },
      ],
      employees,
    });
    // 40 * 50k = 2 000 000
    expect(r.base_cost).toBe(2_000_000);
    expect(r.overtime_cost).toBe(0);
    expect(r.total_cost).toBe(2_000_000);
    expect(r.employees).toHaveLength(1);
    expect(r.employees[0].total_cost).toBe(2_000_000);
    expect(r.employees[0].hours_worked).toBe(40);
  });

  it("single employee with overtime uses 1.5x multiplier", () => {
    const r = aggregateDirectLaborCost({
      timesheets: [
        {
          employee_id: EMP_A,
          project_id: "p1",
          hours_worked: 40,
          hours_overtime: 4,
          approved_via_weekly: true,
        },
      ],
      employees,
    });
    // base: 40 * 50k = 2 000 000
    // ot:   4  * 50k * 1.5 = 300 000
    expect(r.base_cost).toBe(2_000_000);
    expect(r.overtime_cost).toBe(300_000);
    expect(r.total_cost).toBe(2_300_000);
  });

  it("two employees summed correctly and sorted by total desc", () => {
    const r = aggregateDirectLaborCost({
      timesheets: [
        {
          employee_id: EMP_A,
          project_id: "p1",
          hours_worked: 40,
          hours_overtime: 0,
          approved_via_weekly: true,
        },
        {
          employee_id: EMP_B,
          project_id: "p1",
          hours_worked: 40,
          hours_overtime: 0,
          approved_via_weekly: true,
        },
      ],
      employees,
    });
    expect(r.total_cost).toBe(2_000_000 + 3_000_000); // A + B
    expect(r.employees[0].employee_id).toBe(EMP_B); // Bravo first (bigger rate)
    expect(r.employees[1].employee_id).toBe(EMP_A);
  });

  it("aggregates multiple daily rows per employee", () => {
    const r = aggregateDirectLaborCost({
      timesheets: Array.from({ length: 5 }, (_) => ({
        employee_id: EMP_A,
        project_id: "p1",
        hours_worked: 8,
        hours_overtime: 0,
        approved_via_weekly: true,
      })),
      employees,
    });
    expect(r.total_hours).toBe(40);
    expect(r.total_cost).toBe(2_000_000);
  });
});

describe("aggregateDirectLaborCost — provenance", () => {
  it("weekly vs daily share computed correctly", () => {
    const r = aggregateDirectLaborCost({
      timesheets: [
        // 3 daily-only rows, 30h total
        ...Array.from({ length: 3 }, (_) => ({
          employee_id: EMP_A,
          project_id: "p1",
          hours_worked: 8,
          hours_overtime: 2,
          approved_via_weekly: false,
        })),
        // 2 weekly rows, 16h total
        ...Array.from({ length: 2 }, (_) => ({
          employee_id: EMP_A,
          project_id: "p1",
          hours_worked: 8,
          hours_overtime: 0,
          approved_via_weekly: true,
        })),
      ],
      employees,
    });
    // Daily: 3 * (8+2) = 30. Weekly: 2 * (8+0) = 16. Total = 46.
    expect(r.provenance.weekly_hours).toBe(16);
    expect(r.provenance.daily_only_hours).toBe(30);
    expect(r.provenance.weekly_share_pct).toBe(34.8);
  });

  it("employee-level provenance sums cleanly", () => {
    const r = aggregateDirectLaborCost({
      timesheets: [
        {
          employee_id: EMP_A,
          project_id: "p1",
          hours_worked: 8,
          hours_overtime: 0,
          approved_via_weekly: true,
        },
        {
          employee_id: EMP_A,
          project_id: "p1",
          hours_worked: 8,
          hours_overtime: 2,
          approved_via_weekly: false,
        },
      ],
      employees,
    });
    const row = r.employees[0];
    expect(row.weekly_hours).toBe(8);
    expect(row.daily_only_hours).toBe(10);
  });
});

describe("aggregateDirectLaborCost — payroll invariance (GAS §27)", () => {
  it("switching a set of rows from daily-only to weekly-approved does not change the cost", () => {
    const rowsDaily = Array.from({ length: 5 }, (_) => ({
      employee_id: EMP_A,
      project_id: "p1",
      hours_worked: 8,
      hours_overtime: 1,
      approved_via_weekly: false,
    }));
    const rowsWeekly = rowsDaily.map((r) => ({
      ...r,
      approved_via_weekly: true,
    }));
    const a = aggregateDirectLaborCost({
      timesheets: rowsDaily,
      employees,
    });
    const b = aggregateDirectLaborCost({
      timesheets: rowsWeekly,
      employees,
    });
    expect(a.total_cost).toBe(b.total_cost);
    expect(a.base_cost).toBe(b.base_cost);
    expect(a.overtime_cost).toBe(b.overtime_cost);
    // Only provenance metadata differs.
    expect(a.provenance.weekly_share_pct).toBe(0);
    expect(b.provenance.weekly_share_pct).toBe(100);
  });
});

describe("aggregateDirectLaborCost — safety", () => {
  it("skips negative and NaN hours", () => {
    const r = aggregateDirectLaborCost({
      timesheets: [
        {
          employee_id: EMP_A,
          project_id: "p1",
          hours_worked: -8,
          hours_overtime: Number.NaN,
          approved_via_weekly: true,
        },
      ],
      employees,
    });
    expect(r.total_cost).toBe(0);
    expect(r.employees).toEqual([]);
  });

  it("unknown employee id → row still emitted with rate 0 and '(unknown)' name", () => {
    const r = aggregateDirectLaborCost({
      timesheets: [
        {
          employee_id: "no-such-employee",
          project_id: "p1",
          hours_worked: 8,
          hours_overtime: 0,
          approved_via_weekly: false,
        },
      ],
      employees,
    });
    expect(r.employees).toHaveLength(1);
    expect(r.employees[0].full_name).toBe("(unknown)");
    expect(r.total_cost).toBe(0);
  });

  it("negative hourly rate defensively treated as 0", () => {
    const r = aggregateDirectLaborCost({
      timesheets: [
        {
          employee_id: EMP_A,
          project_id: "p1",
          hours_worked: 8,
          hours_overtime: 0,
          approved_via_weekly: true,
        },
      ],
      employees: [{ id: EMP_A, full_name: "A", hourly_rate: -5000 }],
    });
    expect(r.total_cost).toBe(0);
  });
});
