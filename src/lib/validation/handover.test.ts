import { describe, expect, it } from "vitest";

import {
  approvePmHandoverSchema,
  cancelPmHandoverSchema,
  executePmHandoverSchema,
  rejectPmHandoverSchema,
  submitPmHandoverSchema,
} from "./handover";

const uuidA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const uuidB = "11111111-2222-4333-8444-555555555555";
const uuidC = "22222222-3333-4444-8555-666666666666";
const uuidD = "33333333-4444-4555-8666-777777777777";

describe("submitPmHandoverSchema", () => {
  it("accepts a valid payload", () => {
    const res = submitPmHandoverSchema.safeParse({
      project_id: uuidA,
      from_pm_employee_id: uuidB,
      to_pm_employee_id: uuidC,
      effective_at: "2026-08-15T09:00:00Z",
      reason: "Rotation cycle Q3",
      handover_notes: "",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.handover_notes).toBeUndefined();
    }
  });

  it("rejects when from_pm and to_pm are identical", () => {
    const res = submitPmHandoverSchema.safeParse({
      project_id: uuidA,
      from_pm_employee_id: uuidB,
      to_pm_employee_id: uuidB,
      effective_at: "2026-08-15T09:00:00Z",
      reason: "Bad payload",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      const paths = res.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("to_pm_employee_id");
    }
  });

  it("rejects a blank or too-short reason", () => {
    expect(
      submitPmHandoverSchema.safeParse({
        project_id: uuidA,
        from_pm_employee_id: uuidB,
        to_pm_employee_id: uuidC,
        effective_at: "2026-08-15T09:00:00Z",
        reason: "  ",
      }).success,
    ).toBe(false);
    expect(
      submitPmHandoverSchema.safeParse({
        project_id: uuidA,
        from_pm_employee_id: uuidB,
        to_pm_employee_id: uuidC,
        effective_at: "2026-08-15T09:00:00Z",
        reason: "ok",
      }).success,
    ).toBe(false);
  });

  it("rejects non-ISO effective_at", () => {
    expect(
      submitPmHandoverSchema.safeParse({
        project_id: uuidA,
        from_pm_employee_id: uuidB,
        to_pm_employee_id: uuidC,
        effective_at: "not-a-date",
        reason: "Legit reason",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-UUID project", () => {
    expect(
      submitPmHandoverSchema.safeParse({
        project_id: "not-a-uuid",
        from_pm_employee_id: uuidB,
        to_pm_employee_id: uuidC,
        effective_at: "2026-08-15T09:00:00Z",
        reason: "Legit reason",
      }).success,
    ).toBe(false);
  });
});

describe("approvePmHandoverSchema", () => {
  it("accepts valid id and optional comment", () => {
    expect(
      approvePmHandoverSchema.safeParse({ id: uuidD }).success,
    ).toBe(true);
    expect(
      approvePmHandoverSchema.safeParse({ id: uuidD, comment: "OK" }).success,
    ).toBe(true);
  });

  it("rejects invalid UUID", () => {
    expect(
      approvePmHandoverSchema.safeParse({ id: "nope" }).success,
    ).toBe(false);
  });
});

describe("rejectPmHandoverSchema", () => {
  it("requires a substantive reason", () => {
    expect(
      rejectPmHandoverSchema.safeParse({ id: uuidD, reason: "Insufficient docs" })
        .success,
    ).toBe(true);
    expect(
      rejectPmHandoverSchema.safeParse({ id: uuidD, reason: "" }).success,
    ).toBe(false);
    expect(
      rejectPmHandoverSchema.safeParse({ id: uuidD, reason: "no" }).success,
    ).toBe(false);
  });
});

describe("cancelPmHandoverSchema", () => {
  it("accepts optional reason", () => {
    expect(cancelPmHandoverSchema.safeParse({ id: uuidD }).success).toBe(true);
    expect(
      cancelPmHandoverSchema.safeParse({ id: uuidD, reason: "Scope changed" })
        .success,
    ).toBe(true);
  });
});

describe("executePmHandoverSchema", () => {
  it("requires a valid UUID", () => {
    expect(executePmHandoverSchema.safeParse({ id: uuidD }).success).toBe(true);
    expect(executePmHandoverSchema.safeParse({ id: "" }).success).toBe(false);
  });
});
