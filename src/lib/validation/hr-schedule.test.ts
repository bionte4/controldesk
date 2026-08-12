import { describe, expect, it } from "vitest";

import {
  approveTimesheetSchema,
  createWorkShiftSchema,
  deleteWorkShiftSchema,
  generatePayrollPeriodSchema,
  rejectTimesheetSchema,
  submitTimesheetSchema,
  updateWorkShiftSchema,
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

    it("uppercases lower-case codes so DB uniqueness is stable", () => {
      const res = createWorkShiftSchema.safeParse({
        code: "day",
        name: "Day",
        start_time: "08:00",
        end_time: "17:00",
        duration_hours: 8,
      });
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.code).toBe("DAY");
    });

    it("defaults allowance to 0 when omitted", () => {
      const res = createWorkShiftSchema.safeParse({
        code: "DAY",
        name: "Day",
        start_time: "08:00",
        end_time: "17:00",
        duration_hours: 8,
      });
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.shift_allowance_idr).toBe(0);
    });

    it("accepts optional project_id for scope tagging", () => {
      const res = createWorkShiftSchema.safeParse({
        code: "DAY_SITE_A",
        name: "Day at site A",
        start_time: "08:00",
        end_time: "17:00",
        duration_hours: 8,
        project_id: UUID,
      });
      expect(res.success).toBe(true);
      if (res.success) expect(res.data.project_id).toBe(UUID);
    });

    it("rejects invalid project_id (not a UUID)", () => {
      const res = createWorkShiftSchema.safeParse({
        code: "DAY",
        name: "Day",
        start_time: "08:00",
        end_time: "17:00",
        duration_hours: 8,
        project_id: "not-a-uuid",
      });
      expect(res.success).toBe(false);
    });
  });

  describe("updateWorkShiftSchema", () => {
    it("requires id", () => {
      const res = updateWorkShiftSchema.safeParse({
        code: "DAY",
        name: "Day",
        start_time: "08:00",
        end_time: "17:00",
        duration_hours: 8,
      });
      expect(res.success).toBe(false);
    });

    it("accepts id + rest of the shape", () => {
      const res = updateWorkShiftSchema.safeParse({
        id: UUID,
        code: "DAY",
        name: "Day",
        start_time: "08:00",
        end_time: "17:00",
        duration_hours: 8,
        shift_allowance_idr: 25000,
        is_night: false,
      });
      expect(res.success).toBe(true);
    });
  });

  describe("deleteWorkShiftSchema", () => {
    it("requires id", () => {
      expect(deleteWorkShiftSchema.safeParse({}).success).toBe(false);
    });
    it("accepts id", () => {
      expect(
        deleteWorkShiftSchema.safeParse({ id: UUID }).success,
      ).toBe(true);
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
