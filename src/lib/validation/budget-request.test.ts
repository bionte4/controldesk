import { describe, expect, it } from "vitest";

import {
  applyBudgetRequestSchema,
  approveBudgetRequestSchema,
  cancelBudgetRequestSchema,
  rejectBudgetRequestSchema,
  submitBudgetRequestSchema,
} from "./budget-request";

const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";
const JUSTIFICATION = "Realokasi anggaran untuk kebutuhan onsite ekstra klien.";

describe("submitBudgetRequestSchema — INCREASE", () => {
  it("accepts a valid increase", () => {
    const r = submitBudgetRequestSchema.safeParse({
      kind: "INCREASE",
      budget_id: A,
      amount_idr: 5_000_000,
      justification: JUSTIFICATION,
      target_detail_id: B,
    });
    expect(r.success).toBe(true);
  });

  it("rejects justification shorter than 20 chars", () => {
    const r = submitBudgetRequestSchema.safeParse({
      kind: "INCREASE",
      budget_id: A,
      amount_idr: 1_000_000,
      justification: "too short",
      target_detail_id: B,
    });
    expect(r.success).toBe(false);
  });

  it("rejects zero or negative amount", () => {
    for (const amount_idr of [0, -1]) {
      const r = submitBudgetRequestSchema.safeParse({
        kind: "INCREASE",
        budget_id: A,
        amount_idr,
        justification: JUSTIFICATION,
        target_detail_id: B,
      });
      expect(r.success).toBe(false);
    }
  });

  it("rejects missing target_detail_id", () => {
    const r = submitBudgetRequestSchema.safeParse({
      kind: "INCREASE",
      budget_id: A,
      amount_idr: 1_000_000,
      justification: JUSTIFICATION,
    });
    expect(r.success).toBe(false);
  });
});

describe("submitBudgetRequestSchema — DECREASE", () => {
  it("accepts a valid decrease", () => {
    const r = submitBudgetRequestSchema.safeParse({
      kind: "DECREASE",
      budget_id: A,
      amount_idr: 500_000,
      justification: JUSTIFICATION,
      source_detail_id: B,
    });
    expect(r.success).toBe(true);
  });

  it("rejects missing source_detail_id", () => {
    const r = submitBudgetRequestSchema.safeParse({
      kind: "DECREASE",
      budget_id: A,
      amount_idr: 500_000,
      justification: JUSTIFICATION,
    });
    expect(r.success).toBe(false);
  });
});

describe("submitBudgetRequestSchema — TRANSFER", () => {
  it("accepts a valid transfer with different source & target", () => {
    const r = submitBudgetRequestSchema.safeParse({
      kind: "TRANSFER",
      budget_id: A,
      amount_idr: 2_000_000,
      justification: JUSTIFICATION,
      source_detail_id: B,
      target_detail_id: C,
    });
    expect(r.success).toBe(true);
  });

  it("rejects same-line transfer", () => {
    const r = submitBudgetRequestSchema.safeParse({
      kind: "TRANSFER",
      budget_id: A,
      amount_idr: 2_000_000,
      justification: JUSTIFICATION,
      source_detail_id: B,
      target_detail_id: B,
    });
    expect(r.success).toBe(false);
  });

  it("rejects missing target_detail_id", () => {
    const r = submitBudgetRequestSchema.safeParse({
      kind: "TRANSFER",
      budget_id: A,
      amount_idr: 2_000_000,
      justification: JUSTIFICATION,
      source_detail_id: B,
    });
    expect(r.success).toBe(false);
  });
});

describe("approve / reject / cancel / apply schemas", () => {
  it("approve accepts id-only", () => {
    expect(approveBudgetRequestSchema.safeParse({ id: A }).success).toBe(true);
  });

  it("reject requires a reason", () => {
    expect(
      rejectBudgetRequestSchema.safeParse({ id: A }).success,
    ).toBe(false);
    expect(
      rejectBudgetRequestSchema.safeParse({ id: A, reason: "duplicate" })
        .success,
    ).toBe(true);
  });

  it("cancel accepts optional comment", () => {
    expect(cancelBudgetRequestSchema.safeParse({ id: A }).success).toBe(true);
    expect(
      cancelBudgetRequestSchema.safeParse({ id: A, comment: "no longer needed" })
        .success,
    ).toBe(true);
  });

  it("apply accepts id-only", () => {
    expect(applyBudgetRequestSchema.safeParse({ id: A }).success).toBe(true);
  });

  it("all reject invalid UUID", () => {
    expect(approveBudgetRequestSchema.safeParse({ id: "nope" }).success).toBe(false);
    expect(rejectBudgetRequestSchema.safeParse({ id: "nope", reason: "x" }).success).toBe(false);
    expect(cancelBudgetRequestSchema.safeParse({ id: "nope" }).success).toBe(false);
    expect(applyBudgetRequestSchema.safeParse({ id: "nope" }).success).toBe(false);
  });
});
