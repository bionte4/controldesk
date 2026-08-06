import { describe, expect, it } from "vitest";

import {
  approveExpenseSchema,
  cancelExpenseSchema,
  EXPENSE_CATEGORIES,
  rejectExpenseSchema,
  submitExpenseSchema,
} from "./expense";

const VALID_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("submitExpenseSchema", () => {
  it("accepts a well-formed submission", () => {
    const parsed = submitExpenseSchema.safeParse({
      project_id: VALID_UUID,
      amount_idr: 1_250_000,
      category: "TRAVEL",
      description: "Grab ke kantor klien",
      incurred_on: "2026-08-01",
      receipt_url: "https://example.com/receipt.pdf",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects negative or zero amount", () => {
    const zero = submitExpenseSchema.safeParse({
      project_id: VALID_UUID,
      amount_idr: 0,
      category: "TRAVEL",
      description: "test",
      incurred_on: "2026-08-01",
    });
    expect(zero.success).toBe(false);

    const negative = submitExpenseSchema.safeParse({
      project_id: VALID_UUID,
      amount_idr: -1000,
      category: "TRAVEL",
      description: "test",
      incurred_on: "2026-08-01",
    });
    expect(negative.success).toBe(false);
  });

  it("rejects non-integer amount", () => {
    const parsed = submitExpenseSchema.safeParse({
      project_id: VALID_UUID,
      amount_idr: 1500.5,
      category: "TRAVEL",
      description: "test",
      incurred_on: "2026-08-01",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects invalid category", () => {
    const parsed = submitExpenseSchema.safeParse({
      project_id: VALID_UUID,
      amount_idr: 1000,
      category: "PERSONAL", // not in EXPENSE_CATEGORIES
      description: "test",
      incurred_on: "2026-08-01",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects invalid ISO date format", () => {
    const parsed = submitExpenseSchema.safeParse({
      project_id: VALID_UUID,
      amount_idr: 1000,
      category: "TRAVEL",
      description: "test",
      incurred_on: "08/01/2026",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects too-short description", () => {
    const parsed = submitExpenseSchema.safeParse({
      project_id: VALID_UUID,
      amount_idr: 1000,
      category: "TRAVEL",
      description: "abc",
      incurred_on: "2026-08-01",
    });
    expect(parsed.success).toBe(false);
  });

  it("treats an empty receipt_url string as undefined", () => {
    const parsed = submitExpenseSchema.safeParse({
      project_id: VALID_UUID,
      amount_idr: 1000,
      category: "TRAVEL",
      description: "test entry",
      incurred_on: "2026-08-01",
      receipt_url: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.receipt_url).toBeUndefined();
    }
  });

  it("rejects amounts above the sanity ceiling", () => {
    const parsed = submitExpenseSchema.safeParse({
      project_id: VALID_UUID,
      amount_idr: 999_999_999_999_999,
      category: "TRAVEL",
      description: "test entry",
      incurred_on: "2026-08-01",
    });
    expect(parsed.success).toBe(false);
  });

  it("has the expected list of categories", () => {
    expect(EXPENSE_CATEGORIES).toContain("TRAVEL");
    expect(EXPENSE_CATEGORIES).toContain("MISC");
    expect(EXPENSE_CATEGORIES.length).toBeGreaterThanOrEqual(5);
  });
});

describe("approveExpenseSchema / rejectExpenseSchema / cancelExpenseSchema", () => {
  it("approve schema only needs id + optional comment", () => {
    expect(
      approveExpenseSchema.safeParse({ id: VALID_UUID }).success,
    ).toBe(true);
    expect(
      approveExpenseSchema.safeParse({ id: VALID_UUID, comment: "OK" })
        .success,
    ).toBe(true);
  });

  it("approve schema rejects invalid uuid", () => {
    expect(approveExpenseSchema.safeParse({ id: "not-a-uuid" }).success).toBe(
      false,
    );
  });

  it("reject schema requires a reason of at least 4 characters", () => {
    expect(
      rejectExpenseSchema.safeParse({ id: VALID_UUID, reason: "OK" }).success,
    ).toBe(false);
    expect(
      rejectExpenseSchema.safeParse({
        id: VALID_UUID,
        reason: "Over budget",
      }).success,
    ).toBe(true);
  });

  it("cancel schema allows omitted reason", () => {
    expect(cancelExpenseSchema.safeParse({ id: VALID_UUID }).success).toBe(true);
  });
});
