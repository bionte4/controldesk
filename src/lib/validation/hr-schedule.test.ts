import { describe, expect, it } from "vitest";

import {
  approveTimesheetSchema,
  createWorkShiftSchema,
  generatePayrollPeriodSchema,
  rejectTimesheetSchema,
  submitTimesheetSchema,
  upsertRosterEntrySchema,
} from "./hr-schedule";

const UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("hr-schedule validation", () => {
  describe("createWorkShiftSchema", () => {
    it("accepts a happy path shift", () => {
      const res = createWorkShiftSchema.safeParse({
        code: "DAY",
        name: "Day shift 08–17",
        start_time: "08:00",
        end_time: "17:00",
        duration_hours: 8,
        shift_allowance_idr: 25000,
        is_night: false,
      });
      expect(res.success).toBe(true);
    });

    it("rejects bad time format", () => {
      const res = createWorkShiftSchema.safeParse({
        code: "DAY",
        name: "Day",
        start_time: "8am",
        end_time: "17:00",
        duration_hours: 8,
      });
      expect(res.success).toBe(false);
    });

    it("rejects duration outside 0.5..24", () => {
      const bad = createWorkShiftSchema.safeParse({
        code: "DAY",
        name: "Day",
        start_time: "08:00",
        end_time: "17:00",
        duration_hours: 30,
      });
      expect(bad.success).toBe(false);
    });
  });

  describe("upsertRosterEntrySchema", () => {
    it("normalises empty notes to undefined", () => {
      const res = upsertRosterEntrySchema.safeParse({
        employee_id: UUID,
        shift_id: UUID,
        work_date: "2026-08-05",
        status: "PLANNED",
        notes: "   ",
      });
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.notes).toBeUndefined();
    });

    it("rejects bad iso date", () => {
      const res = upsertRosterEntrySchema.safeParse({
        employee_id: UUID,
        shift_id: UUID,
        work_date: "05-08-2026",
      });
      expect(res.success).toBe(false);
    });
  });

  describe("submitTimesheetSchema", () => {
    it("caps hours to 24", () => {
      const res = submitTimesheetSchema.safeParse({
        employee_id: UUID,
        work_date: "2026-08-05",
        hours_worked: 25,
      });
      expect(res.success).toBe(false);
    });

    it("defaults overtime to 0", () => {
      const res = submitTimesheetSchema.safeParse({
        employee_id: UUID,
        work_date: "2026-08-05",
        hours_worked: 8,
      });
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.hours_overtime).toBe(0);
    });
  });

  describe("approve/reject", () => {
    it("approve accepts empty comment", () => {
      expect(
        approveTimesheetSchema.safeParse({ id: UUID }).success,
      ).toBe(true);
    });
    it("reject requires a reason with ≥4 chars", () => {
      expect(
        rejectTimesheetSchema.safeParse({ id: UUID, reason: "no" }).success,
      ).toBe(false);
      expect(
        rejectTimesheetSchema.safeParse({ id: UUID, reason: "typo" }).success,
      ).toBe(true);
    });
  });

  describe("generatePayrollPeriodSchema", () => {
    it("accepts valid month range", () => {
      expect(
        generatePayrollPeriodSchema.safeParse({
          period_year: 2026,
          period_month: 8,
        }).success,
      ).toBe(true);
    });
    it("rejects month out of range", () => {
      expect(
        generatePayrollPeriodSchema.safeParse({
          period_year: 2026,
          period_month: 13,
        }).success,
      ).toBe(false);
    });
  });
});
