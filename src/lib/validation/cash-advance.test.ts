import { describe, expect, it } from "vitest";

import {
  approveCashAdvanceSchema,
  disburseCashAdvanceSchema,
  rejectCashAdvanceSchema,
  submitCashAdvanceSchema,
  submitSettlementSchema,
} from "./cash-advance";

const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("submitCashAdvanceSchema", () => {
  it("accepts a valid request", () => {
    const parsed = submitCashAdvanceSchema.safeParse({
      project_id: uuid,
      amount_idr: 5_000_000,
      purpose: "Site inspection travel",
      needed_by: "2026-05-01",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects non-integer amount", () => {
    const parsed = submitCashAdvanceSchema.safeParse({
      project_id: uuid,
      amount_idr: 1_500_000.5,
      purpose: "Deploy",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects negative amount", () => {
    const parsed = submitCashAdvanceSchema.safeParse({
      project_id: uuid,
      amount_idr: -1,
      purpose: "Deploy",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects short purpose", () => {
    const parsed = submitCashAdvanceSchema.safeParse({
      project_id: uuid,
      amount_idr: 100_000,
      purpose: "ab",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects malformed needed_by", () => {
    const parsed = submitCashAdvanceSchema.safeParse({
      project_id: uuid,
      amount_idr: 100_000,
      purpose: "Site visit",
      needed_by: "not-a-date",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("approve / reject / disburse schemas", () => {
  it("approve accepts id + optional comment", () => {
    expect(approveCashAdvanceSchema.safeParse({ id: uuid }).success).toBe(true);
  });

  it("reject requires a reason", () => {
    expect(rejectCashAdvanceSchema.safeParse({ id: uuid }).success).toBe(false);
    expect(
      rejectCashAdvanceSchema.safeParse({ id: uuid, reason: "Not eligible" })
        .success,
    ).toBe(true);
  });

  it("disburse requires a disbursement_ref", () => {
    expect(disburseCashAdvanceSchema.safeParse({ id: uuid }).success).toBe(
      false,
    );
    expect(
      disburseCashAdvanceSchema.safeParse({
        id: uuid,
        disbursement_ref: "TRX-2026-0001",
      }).success,
    ).toBe(true);
  });
});

describe("submitSettlementSchema", () => {
  it("accepts a valid settlement (zero allowed)", () => {
    const parsed = submitSettlementSchema.safeParse({
      cash_advance_id: uuid,
      total_spent_idr: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a non-integer total", () => {
    const parsed = submitSettlementSchema.safeParse({
      cash_advance_id: uuid,
      total_spent_idr: 1.5,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a negative total", () => {
    const parsed = submitSettlementSchema.safeParse({
      cash_advance_id: uuid,
      total_spent_idr: -100,
    });
    expect(parsed.success).toBe(false);
  });
});
