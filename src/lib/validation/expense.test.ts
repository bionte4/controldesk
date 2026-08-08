import { describe, expect, it } from "vitest";

import {
  approveExpenseSchema,
  cancelExpenseSchema,
  deleteDraftExpenseSchema,
  detachReceiptSchema,
  evaluateLateSubmission,
  EXPENSE_CATEGORIES,
  EXPENSE_INCURRED_MAX_BUSINESS_DAYS,
  EXPENSE_PAYMENT_METHODS,
  rejectExpenseSchema,
  saveDraftExpenseSchema,
  submitDraftExpenseSchema,
  submitExpenseSchema,
  updateDraftExpenseSchema,
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

// ---------------------------------------------------------------------------
// DRAFT-first flow — saveDraft / updateDraft / submitDraft / deleteDraft
// (migration 0044).
// ---------------------------------------------------------------------------

const SECOND_UUID = "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb";

describe("saveDraftExpenseSchema", () => {
  it("accepts the minimum required fields (no MA, no payment method)", () => {
    const parsed = saveDraftExpenseSchema.safeParse({
      project_id: VALID_UUID,
      amount_idr: 100_000,
      description: "Grab receipt",
      incurred_on: "2026-08-01",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.budget_detail_id).toBeUndefined();
      expect(parsed.data.payment_method).toBeUndefined();
    }
  });

  it("accepts a fully-populated draft", () => {
    const parsed = saveDraftExpenseSchema.safeParse({
      project_id: VALID_UUID,
      budget_detail_id: SECOND_UUID,
      amount_idr: 250_000,
      payment_method: "BANK_TRANSFER",
      description: "Team lunch on site",
      notes: "For QA visit day 3",
      incurred_on: "2026-08-01",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an invalid payment method", () => {
    const parsed = saveDraftExpenseSchema.safeParse({
      project_id: VALID_UUID,
      amount_idr: 100_000,
      description: "Grab receipt",
      incurred_on: "2026-08-01",
      payment_method: "CRYPTO",
    });
    expect(parsed.success).toBe(false);
  });

  it("trims empty notes to undefined", () => {
    const parsed = saveDraftExpenseSchema.safeParse({
      project_id: VALID_UUID,
      amount_idr: 100_000,
      description: "Grab receipt",
      incurred_on: "2026-08-01",
      notes: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.notes).toBeUndefined();
  });
});

describe("updateDraftExpenseSchema", () => {
  it("requires an id in addition to the draft fields", () => {
    const withoutId = updateDraftExpenseSchema.safeParse({
      project_id: VALID_UUID,
      amount_idr: 100_000,
      description: "Grab receipt",
      incurred_on: "2026-08-01",
    });
    expect(withoutId.success).toBe(false);

    const withId = updateDraftExpenseSchema.safeParse({
      id: VALID_UUID,
      project_id: VALID_UUID,
      amount_idr: 100_000,
      description: "Grab receipt",
      incurred_on: "2026-08-01",
    });
    expect(withId.success).toBe(true);
  });
});

describe("submitDraftExpenseSchema", () => {
  it("requires only a valid id", () => {
    expect(submitDraftExpenseSchema.safeParse({ id: VALID_UUID }).success).toBe(
      true,
    );
    expect(submitDraftExpenseSchema.safeParse({ id: "nope" }).success).toBe(
      false,
    );
  });
});

describe("deleteDraftExpenseSchema", () => {
  it("requires only a valid id", () => {
    expect(deleteDraftExpenseSchema.safeParse({ id: VALID_UUID }).success).toBe(
      true,
    );
  });
});

describe("detachReceiptSchema", () => {
  it("requires both expense_id and attachment_id as UUIDs", () => {
    expect(
      detachReceiptSchema.safeParse({
        expense_id: VALID_UUID,
        attachment_id: SECOND_UUID,
      }).success,
    ).toBe(true);
    expect(
      detachReceiptSchema.safeParse({ expense_id: VALID_UUID }).success,
    ).toBe(false);
  });
});

describe("EXPENSE_PAYMENT_METHODS enum", () => {
  it("contains the four mockup-defined methods", () => {
    expect(EXPENSE_PAYMENT_METHODS).toEqual([
      "BANK_TRANSFER",
      "CASH",
      "REIMBURSEMENT",
      "CORPORATE_CARD",
    ]);
  });
});

describe("saveDraftExpenseSchema · late_submission_reason", () => {
  const base = {
    project_id: VALID_UUID,
    amount_idr: 100_000,
    description: "Perjalanan dinas ke Bandung",
    incurred_on: "2026-08-01",
  };

  it("allows omitting late_submission_reason (default undefined)", () => {
    const r = saveDraftExpenseSchema.parse(base);
    expect(r.late_submission_reason).toBeUndefined();
  });

  it("accepts a non-empty justification and trims it", () => {
    const r = saveDraftExpenseSchema.parse({
      ...base,
      late_submission_reason: "  Baru pulang dari site di NTT.  ",
    });
    expect(r.late_submission_reason).toBe("Baru pulang dari site di NTT.");
  });

  it("normalizes empty / whitespace-only strings to undefined", () => {
    for (const raw of ["", "   ", "\n\t"]) {
      const r = saveDraftExpenseSchema.parse({
        ...base,
        late_submission_reason: raw,
      });
      expect(r.late_submission_reason).toBeUndefined();
    }
  });

  it("rejects justification exceeding 500 characters", () => {
    const r = saveDraftExpenseSchema.safeParse({
      ...base,
      late_submission_reason: "x".repeat(501),
    });
    expect(r.success).toBe(false);
  });
});

describe("evaluateLateSubmission", () => {
  const now = new Date("2026-08-07T02:00:00Z"); // Fri 09:00 WIB

  it("returns `ok` when the receipt is within the SLA window", () => {
    const r = evaluateLateSubmission({
      incurredOn: "2026-08-06",
      now,
      reason: null,
      businessDaysOld: 5,
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.businessDaysOld).toBe(5);
  });

  it("returns `ok` at exactly the SLA boundary (7 wd)", () => {
    const r = evaluateLateSubmission({
      incurredOn: "2026-07-27",
      now,
      reason: null,
      businessDaysOld: EXPENSE_INCURRED_MAX_BUSINESS_DAYS,
    });
    expect(r.kind).toBe("ok");
  });

  it("returns `requires_reason` when SLA lewat + reason kosong", () => {
    const r = evaluateLateSubmission({
      incurredOn: "2026-07-20",
      now,
      reason: null,
      businessDaysOld: 12,
    });
    expect(r.kind).toBe("requires_reason");
    if (r.kind === "requires_reason") {
      expect(r.businessDaysOld).toBe(12);
    }
  });

  it("returns `requires_reason` kalau reason terlalu pendek (<5 char)", () => {
    const r = evaluateLateSubmission({
      incurredOn: "2026-07-20",
      now,
      reason: "ok",
      businessDaysOld: 12,
    });
    expect(r.kind).toBe("requires_reason");
  });

  it("returns `flagged` kalau reason valid + SLA lewat", () => {
    const r = evaluateLateSubmission({
      incurredOn: "2026-07-20",
      now,
      reason: "Nota terselip di dompet lapangan.",
      businessDaysOld: 12,
    });
    expect(r.kind).toBe("flagged");
    if (r.kind === "flagged") {
      expect(r.reason).toBe("Nota terselip di dompet lapangan.");
      expect(r.businessDaysOld).toBe(12);
    }
  });

  it("trims whitespace-only reason (treated as empty)", () => {
    const r = evaluateLateSubmission({
      incurredOn: "2026-07-20",
      now,
      reason: "   ",
      businessDaysOld: 12,
    });
    expect(r.kind).toBe("requires_reason");
  });

  it("keeps threshold constant at 7 business days (contract stability)", () => {
    expect(EXPENSE_INCURRED_MAX_BUSINESS_DAYS).toBe(7);
  });
});
