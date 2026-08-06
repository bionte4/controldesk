import { describe, expect, it } from "vitest";

import {
  MILESTONE_STATUSES,
  createMilestoneSchema,
  deleteMilestoneSchema,
  milestoneStatusSchema,
  setMilestoneStatusSchema,
  updateMilestoneSchema,
  weightBpsSchema,
} from "./milestone";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("milestone validation — enums", () => {
  it("MILESTONE_STATUSES lists the five known values", () => {
    expect(MILESTONE_STATUSES).toEqual([
      "PLANNED",
      "IN_PROGRESS",
      "AT_RISK",
      "DONE",
      "CANCELLED",
    ]);
  });

  it("milestoneStatusSchema rejects unknown value", () => {
    expect(milestoneStatusSchema.safeParse("FROZEN").success).toBe(false);
  });
});

describe("weightBpsSchema", () => {
  it("accepts full range 1–10 000", () => {
    expect(weightBpsSchema.safeParse(1).success).toBe(true);
    expect(weightBpsSchema.safeParse(5_000).success).toBe(true);
    expect(weightBpsSchema.safeParse(10_000).success).toBe(true);
  });

  it("rejects 0 and negatives", () => {
    expect(weightBpsSchema.safeParse(0).success).toBe(false);
    expect(weightBpsSchema.safeParse(-100).success).toBe(false);
  });

  it("rejects > 10 000", () => {
    expect(weightBpsSchema.safeParse(10_001).success).toBe(false);
  });

  it("rejects non-integers", () => {
    expect(weightBpsSchema.safeParse(2500.5).success).toBe(false);
  });
});

describe("createMilestoneSchema", () => {
  it("accepts a minimal payload", () => {
    const r = createMilestoneSchema.safeParse({
      project_id: UUID_A,
      seq: 1,
      name: "Alpha",
      weight_bps: 2500,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a full payload", () => {
    const r = createMilestoneSchema.safeParse({
      project_id: UUID_A,
      seq: 2,
      name: "UAT",
      description: "User acceptance testing",
      weight_bps: 2000,
      planned_start_date: "2026-01-15",
      planned_end_date: "2026-02-15",
      owner_employee_id: UUID_B,
    });
    expect(r.success).toBe(true);
  });

  it("rejects planned_end_date before planned_start_date", () => {
    const r = createMilestoneSchema.safeParse({
      project_id: UUID_A,
      seq: 1,
      name: "Bad dates",
      weight_bps: 100,
      planned_start_date: "2026-03-15",
      planned_end_date: "2026-01-01",
    });
    expect(r.success).toBe(false);
  });

  it("allows equal start + end dates (single-day milestone)", () => {
    const r = createMilestoneSchema.safeParse({
      project_id: UUID_A,
      seq: 1,
      name: "Same day",
      weight_bps: 100,
      planned_start_date: "2026-01-15",
      planned_end_date: "2026-01-15",
    });
    expect(r.success).toBe(true);
  });

  it("rejects name shorter than 2 chars", () => {
    const r = createMilestoneSchema.safeParse({
      project_id: UUID_A,
      seq: 1,
      name: "a",
      weight_bps: 100,
    });
    expect(r.success).toBe(false);
  });

  it("rejects seq ≤ 0", () => {
    const r = createMilestoneSchema.safeParse({
      project_id: UUID_A,
      seq: 0,
      name: "Zero seq",
      weight_bps: 100,
    });
    expect(r.success).toBe(false);
  });

  it("coerces empty description to undefined", () => {
    const r = createMilestoneSchema.safeParse({
      project_id: UUID_A,
      seq: 1,
      name: "Alpha",
      description: "",
      weight_bps: 100,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.description).toBeUndefined();
  });
});

describe("updateMilestoneSchema", () => {
  it("accepts a partial update", () => {
    const r = updateMilestoneSchema.safeParse({
      id: UUID_A,
      weight_bps: 3000,
    });
    expect(r.success).toBe(true);
  });

  it("accepts nullable dates for clearing", () => {
    const r = updateMilestoneSchema.safeParse({
      id: UUID_A,
      planned_start_date: null,
      planned_end_date: null,
    });
    expect(r.success).toBe(true);
  });

  it("accepts nullable owner", () => {
    const r = updateMilestoneSchema.safeParse({
      id: UUID_A,
      owner_employee_id: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects end date before start date", () => {
    const r = updateMilestoneSchema.safeParse({
      id: UUID_A,
      planned_start_date: "2026-06-01",
      planned_end_date: "2026-05-01",
    });
    expect(r.success).toBe(false);
  });
});

describe("setMilestoneStatusSchema", () => {
  it("accepts status only", () => {
    const r = setMilestoneStatusSchema.safeParse({
      id: UUID_A,
      status: "DONE",
    });
    expect(r.success).toBe(true);
  });

  it("accepts status with actual dates", () => {
    const r = setMilestoneStatusSchema.safeParse({
      id: UUID_A,
      status: "DONE",
      actual_start_date: "2026-02-01",
      actual_end_date: "2026-03-01",
    });
    expect(r.success).toBe(true);
  });

  it("rejects actual_end_date before actual_start_date", () => {
    const r = setMilestoneStatusSchema.safeParse({
      id: UUID_A,
      status: "DONE",
      actual_start_date: "2026-03-01",
      actual_end_date: "2026-02-01",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown status", () => {
    const r = setMilestoneStatusSchema.safeParse({
      id: UUID_A,
      status: "FROZEN",
    });
    expect(r.success).toBe(false);
  });
});

describe("deleteMilestoneSchema", () => {
  it("accepts a well-formed id", () => {
    expect(deleteMilestoneSchema.safeParse({ id: UUID_A }).success).toBe(true);
  });

  it("rejects invalid id", () => {
    expect(deleteMilestoneSchema.safeParse({ id: "nope" }).success).toBe(false);
  });
});
