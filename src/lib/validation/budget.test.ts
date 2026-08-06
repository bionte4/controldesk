import { describe, expect, it } from "vitest";

import {
  addBudgetLineItemSchema,
  approveBudgetSchema,
  BUDGET_CATEGORIES,
  BUDGET_STATUSES,
  budgetStatusSchema,
  cancelBudgetSchema,
  createBudgetSchema,
  deleteBudgetLineItemSchema,
  rejectBudgetSchema,
  submitBudgetSchema,
  updateBudgetLineItemSchema,
} from "./budget";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("budget validation — enums", () => {
  it("BUDGET_STATUSES includes the six known statuses", () => {
    expect(BUDGET_STATUSES).toEqual([
      "DRAFT",
      "PENDING_FINANCE",
      "PENDING_DIRECTOR",
      "APPROVED",
      "REVISED",
      "CANCELLED",
    ]);
  });

  it("budgetStatusSchema rejects unknown status", () => {
    const r = budgetStatusSchema.safeParse("PENDING_PM");
    expect(r.success).toBe(false);
  });

  it("BUDGET_CATEGORIES contains at least 10 canonical labels", () => {
    expect(BUDGET_CATEGORIES.length).toBeGreaterThanOrEqual(10);
    expect(BUDGET_CATEGORIES).toContain("DIRECT_LABOUR");
    expect(BUDGET_CATEGORIES).toContain("CONTINGENCY");
  });
});

describe("createBudgetSchema", () => {
  it("accepts a well-formed create payload", () => {
    const r = createBudgetSchema.safeParse({
      project_id: UUID_A,
      fiscal_year: 2026,
      title: "FY2026 pilot",
      notes: "seed comment",
    });
    expect(r.success).toBe(true);
  });

  it("coerces empty notes to undefined", () => {
    const r = createBudgetSchema.safeParse({
      project_id: UUID_A,
      fiscal_year: 2026,
      title: "FY2026",
      notes: "",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.notes).toBeUndefined();
  });

  it("rejects fiscal_year outside 2000–2100", () => {
    const low = createBudgetSchema.safeParse({
      project_id: UUID_A,
      fiscal_year: 1999,
      title: "Old",
    });
    expect(low.success).toBe(false);

    const high = createBudgetSchema.safeParse({
      project_id: UUID_A,
      fiscal_year: 2101,
      title: "Future",
    });
    expect(high.success).toBe(false);
  });

  it("rejects title shorter than 4 chars", () => {
    const r = createBudgetSchema.safeParse({
      project_id: UUID_A,
      fiscal_year: 2026,
      title: "abc",
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid UUID project_id", () => {
    const r = createBudgetSchema.safeParse({
      project_id: "not-a-uuid",
      fiscal_year: 2026,
      title: "FY2026",
    });
    expect(r.success).toBe(false);
  });
});

describe("addBudgetLineItemSchema", () => {
  it("accepts a well-formed line item", () => {
    const r = addBudgetLineItemSchema.safeParse({
      budget_id: UUID_A,
      seq: 1,
      category: "OPERATIONS",
      description: "Ops cost",
      planned_amount: 1_000_000,
    });
    expect(r.success).toBe(true);
  });

  it("rejects seq ≤ 0", () => {
    const r = addBudgetLineItemSchema.safeParse({
      budget_id: UUID_A,
      seq: 0,
      category: "OPERATIONS",
      planned_amount: 1_000_000,
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative planned_amount", () => {
    const r = addBudgetLineItemSchema.safeParse({
      budget_id: UUID_A,
      seq: 1,
      category: "OPERATIONS",
      planned_amount: -1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-integer planned_amount", () => {
    const r = addBudgetLineItemSchema.safeParse({
      budget_id: UUID_A,
      seq: 1,
      category: "OPERATIONS",
      planned_amount: 1.5,
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown category", () => {
    const r = addBudgetLineItemSchema.safeParse({
      budget_id: UUID_A,
      seq: 1,
      category: "MYSTERY",
      planned_amount: 1000,
    });
    expect(r.success).toBe(false);
  });
});

describe("updateBudgetLineItemSchema", () => {
  it("accepts a partial update with only planned_amount", () => {
    const r = updateBudgetLineItemSchema.safeParse({
      id: UUID_B,
      planned_amount: 500_000,
    });
    expect(r.success).toBe(true);
  });

  it("accepts an update with realized + outstanding but not planned", () => {
    const r = updateBudgetLineItemSchema.safeParse({
      id: UUID_B,
      realized_amount: 100_000,
      outstanding_amount: 50_000,
    });
    expect(r.success).toBe(true);
  });

  it("requires id", () => {
    const r = updateBudgetLineItemSchema.safeParse({
      planned_amount: 1000,
    });
    expect(r.success).toBe(false);
  });
});

describe("deleteBudgetLineItemSchema", () => {
  it("accepts a well-formed id", () => {
    const r = deleteBudgetLineItemSchema.safeParse({ id: UUID_B });
    expect(r.success).toBe(true);
  });

  it("rejects invalid UUID", () => {
    const r = deleteBudgetLineItemSchema.safeParse({ id: "bad" });
    expect(r.success).toBe(false);
  });
});

describe("lifecycle schemas", () => {
  it("submitBudgetSchema requires id only", () => {
    const r = submitBudgetSchema.safeParse({ id: UUID_A });
    expect(r.success).toBe(true);
  });

  it("approveBudgetSchema accepts optional comment", () => {
    const r1 = approveBudgetSchema.safeParse({ id: UUID_A });
    expect(r1.success).toBe(true);
    const r2 = approveBudgetSchema.safeParse({
      id: UUID_A,
      comment: "LGTM",
    });
    expect(r2.success).toBe(true);
  });

  it("rejectBudgetSchema requires a reason ≥ 4 chars", () => {
    const missing = rejectBudgetSchema.safeParse({ id: UUID_A });
    expect(missing.success).toBe(false);

    const tooShort = rejectBudgetSchema.safeParse({
      id: UUID_A,
      reason: "no",
    });
    expect(tooShort.success).toBe(false);

    const ok = rejectBudgetSchema.safeParse({
      id: UUID_A,
      reason: "Over allocated headcount",
    });
    expect(ok.success).toBe(true);
  });

  it("cancelBudgetSchema accepts optional reason", () => {
    const r1 = cancelBudgetSchema.safeParse({ id: UUID_A });
    expect(r1.success).toBe(true);
    const r2 = cancelBudgetSchema.safeParse({
      id: UUID_A,
      reason: "no longer needed",
    });
    expect(r2.success).toBe(true);
  });
});
