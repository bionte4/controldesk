import { describe, expect, it } from "vitest";

import {
  approveWeeklyTimesheetSchema,
  rejectWeeklyTimesheetSchema,
  submitWeeklyTimesheetSchema,
} from "./timesheet-week";

const EMP = "11111111-1111-4111-8111-111111111111";
const PROJ = "22222222-2222-4222-8222-222222222222";

function validDays(weekStart: string) {
  const days: {
    work_date: string;
    project_id: string | null;
    hours_worked: number;
    hours_overtime: number;
    notes?: string | null;
  }[] = [];
  const start = new Date(`${weekStart}T00:00:00Z`);
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start.getTime());
    d.setUTCDate(start.getUTCDate() + i);
    const ymd = d.toISOString().slice(0, 10);
    days.push({
      work_date: ymd,
      project_id: PROJ,
      hours_worked: 8,
      hours_overtime: 0,
      notes: null,
    });
  }
  return days;
}

describe("submitWeeklyTimesheetSchema", () => {
  it("accepts a valid Mon..Sun packet", () => {
    const r = submitWeeklyTimesheetSchema.safeParse({
      employee_id: EMP,
      week_start_date: "2026-08-03",
      days: validDays("2026-08-03"),
    });
    expect(r.success).toBe(true);
  });

  it("rejects packet shorter than 7 days", () => {
    const r = submitWeeklyTimesheetSchema.safeParse({
      employee_id: EMP,
      week_start_date: "2026-08-03",
      days: validDays("2026-08-03").slice(0, 6),
    });
    expect(r.success).toBe(false);
  });

  it("rejects mis-aligned dates (position vs date)", () => {
    const days = validDays("2026-08-03");
    days[2].work_date = "2026-08-06"; // should be 08-05
    const r = submitWeeklyTimesheetSchema.safeParse({
      employee_id: EMP,
      week_start_date: "2026-08-03",
      days,
    });
    expect(r.success).toBe(false);
  });

  it("rejects duplicate dates", () => {
    const days = validDays("2026-08-03");
    days[3] = { ...days[3], work_date: days[2].work_date };
    const r = submitWeeklyTimesheetSchema.safeParse({
      employee_id: EMP,
      week_start_date: "2026-08-03",
      days,
    });
    expect(r.success).toBe(false);
  });

  it("rejects hours > 24", () => {
    const days = validDays("2026-08-03");
    days[0].hours_worked = 25;
    const r = submitWeeklyTimesheetSchema.safeParse({
      employee_id: EMP,
      week_start_date: "2026-08-03",
      days,
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative hours", () => {
    const days = validDays("2026-08-03");
    days[0].hours_overtime = -1;
    const r = submitWeeklyTimesheetSchema.safeParse({
      employee_id: EMP,
      week_start_date: "2026-08-03",
      days,
    });
    expect(r.success).toBe(false);
  });

  it("rejects >2-decimal hours", () => {
    const days = validDays("2026-08-03");
    days[0].hours_worked = 8.001;
    const r = submitWeeklyTimesheetSchema.safeParse({
      employee_id: EMP,
      week_start_date: "2026-08-03",
      days,
    });
    expect(r.success).toBe(false);
  });

  it("allows null project (unassigned day)", () => {
    const days = validDays("2026-08-03");
    days[2].project_id = null;
    days[2].hours_worked = 0;
    const r = submitWeeklyTimesheetSchema.safeParse({
      employee_id: EMP,
      week_start_date: "2026-08-03",
      days,
    });
    expect(r.success).toBe(true);
  });
});

describe("approveWeeklyTimesheetSchema", () => {
  it("accepts a bare id + optional comment", () => {
    expect(
      approveWeeklyTimesheetSchema.safeParse({ id: EMP }).success,
    ).toBe(true);
    expect(
      approveWeeklyTimesheetSchema.safeParse({ id: EMP, comment: "ok" })
        .success,
    ).toBe(true);
  });

  it("rejects bad UUID", () => {
    expect(
      approveWeeklyTimesheetSchema.safeParse({ id: "not-a-uuid" }).success,
    ).toBe(false);
  });
});

describe("rejectWeeklyTimesheetSchema", () => {
  it("requires ≥10-char reason", () => {
    expect(
      rejectWeeklyTimesheetSchema.safeParse({ id: EMP, reason: "too short" })
        .success,
    ).toBe(false);
    expect(
      rejectWeeklyTimesheetSchema.safeParse({
        id: EMP,
        reason: "Missing lunch hours on Wednesday",
      }).success,
    ).toBe(true);
  });
});
