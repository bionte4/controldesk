import { describe, expect, it } from "vitest";

import {
  acceptCanonicalSettlementSchema,
  approveCanonicalCashAdvanceSchema,
  cancelCanonicalCashAdvanceSchema,
  cashAdvanceTypeSchema,
  CASH_ADVANCE_TYPES,
  CANONICAL_CA_STATUS_INPUTS,
  canonicalCaStatusSchema,
  disburseCanonicalCashAdvanceSchema,
  rejectCanonicalCashAdvanceSchema,
  returnCanonicalSettlementSchema,
  submitCanonicalCashAdvanceSchema,
  submitCanonicalSettlementSchema,
} from "./cash-advance-canonical";

const UUID = "00000000-0000-4000-8000-000000000001";
const UUID_2 = "00000000-0000-4000-8000-000000000002";

describe("enum schemas", () => {
  it("accepts every declared cash_advance_type", () => {
    for (const t of CASH_ADVANCE_TYPES) {
      expect(cashAdvanceTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("rejects legacy CA type strings", () => {
    expect(cashAdvanceTypeSchema.safeParse("REGULAR").success).toBe(false);
    expect(cashAdvanceTypeSchema.safeParse("FIELD").success).toBe(false);
  });

  it("accepts every canonical CA status", () => {
    for (const s of CANONICAL_CA_STATUS_INPUTS) {
      expect(canonicalCaStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects legacy L* statuses", () => {
    expect(canonicalCaStatusSchema.safeParse("PENDING_L1_SUPERVISOR").success)
      .toBe(false);
    expect(canonicalCaStatusSchema.safeParse("PENDING_L2_5_FINANCE").success)
      .toBe(false);
  });
});

describe("submitCanonicalCashAdvanceSchema", () => {
  const valid = {
    ca_type: "GENERAL" as const,
    project_id: UUID,
    amount_idr: 500_000,
    purpose: "Field visit — Bandung branch onboarding.",
  };

  it("accepts a well-formed GENERAL submission", () => {
    expect(submitCanonicalCashAdvanceSchema.safeParse(valid).success).toBe(
      true,
    );
  });

  it("accepts a FIELD_OPS submission with needed_by", () => {
    expect(
      submitCanonicalCashAdvanceSchema.safeParse({
        ...valid,
        ca_type: "FIELD_OPS",
        needed_by: "2026-08-15",
      }).success,
    ).toBe(true);
  });

  it("rejects zero or negative amounts", () => {
    expect(
      submitCanonicalCashAdvanceSchema.safeParse({ ...valid, amount_idr: 0 })
        .success,
    ).toBe(false);
    expect(
      submitCanonicalCashAdvanceSchema.safeParse({
        ...valid,
        amount_idr: -100,
      }).success,
    ).toBe(false);
  });

  it("rejects decimal amounts", () => {
    expect(
      submitCanonicalCashAdvanceSchema.safeParse({
        ...valid,
        amount_idr: 100.5,
      }).success,
    ).toBe(false);
  });

  it("rejects amounts above the sanity ceiling", () => {
    expect(
      submitCanonicalCashAdvanceSchema.safeParse({
        ...valid,
        amount_idr: 1_000_000_000_000,
      }).success,
    ).toBe(false);
  });

  it("rejects too-short purpose", () => {
    expect(
      submitCanonicalCashAdvanceSchema.safeParse({ ...valid, purpose: "ok" })
        .success,
    ).toBe(false);
  });

  it("trims and enforces purpose length", () => {
    const parsed = submitCanonicalCashAdvanceSchema.parse({
      ...valid,
      purpose: "  operational petty visit.  ",
    });
    expect(parsed.purpose).toBe("operational petty visit.");
  });

  it("rejects an invalid needed_by", () => {
    expect(
      submitCanonicalCashAdvanceSchema.safeParse({
        ...valid,
        needed_by: "August 15, 2026",
      }).success,
    ).toBe(false);
  });

  it("rejects an invalid ca_type", () => {
    expect(
      submitCanonicalCashAdvanceSchema.safeParse({
        ...valid,
        ca_type: "OTHER",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-UUID project_id", () => {
    expect(
      submitCanonicalCashAdvanceSchema.safeParse({
        ...valid,
        project_id: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});

describe("approveCanonicalCashAdvanceSchema", () => {
  it("accepts id only", () => {
    expect(approveCanonicalCashAdvanceSchema.safeParse({ id: UUID }).success)
      .toBe(true);
  });

  it("accepts id + comment", () => {
    const parsed = approveCanonicalCashAdvanceSchema.parse({
      id: UUID,
      comment: "  looks good.  ",
    });
    expect(parsed.comment).toBe("looks good.");
  });

  it("coerces empty comment to undefined", () => {
    const parsed = approveCanonicalCashAdvanceSchema.parse({
      id: UUID,
      comment: "",
    });
    expect(parsed.comment).toBeUndefined();
  });

  it("rejects an over-long comment", () => {
    expect(
      approveCanonicalCashAdvanceSchema.safeParse({
        id: UUID,
        comment: "x".repeat(2001),
      }).success,
    ).toBe(false);
  });
});

describe("rejectCanonicalCashAdvanceSchema", () => {
  it("requires reason ≥ 4 chars", () => {
    expect(
      rejectCanonicalCashAdvanceSchema.safeParse({ id: UUID, reason: "no" })
        .success,
    ).toBe(false);
    expect(
      rejectCanonicalCashAdvanceSchema.safeParse({
        id: UUID,
        reason: "budget breach.",
      }).success,
    ).toBe(true);
  });

  it("caps reason length at 1000", () => {
    expect(
      rejectCanonicalCashAdvanceSchema.safeParse({
        id: UUID,
        reason: "x".repeat(1001),
      }).success,
    ).toBe(false);
  });
});

describe("cancelCanonicalCashAdvanceSchema", () => {
  it("allows optional reason", () => {
    expect(cancelCanonicalCashAdvanceSchema.safeParse({ id: UUID }).success)
      .toBe(true);
    expect(
      cancelCanonicalCashAdvanceSchema.safeParse({
        id: UUID,
        reason: "changed my mind",
      }).success,
    ).toBe(true);
  });

  it("coerces empty reason to undefined", () => {
    const parsed = cancelCanonicalCashAdvanceSchema.parse({
      id: UUID,
      reason: "",
    });
    expect(parsed.reason).toBeUndefined();
  });
});

describe("disburseCanonicalCashAdvanceSchema", () => {
  it("requires a non-empty disbursement_ref", () => {
    expect(
      disburseCanonicalCashAdvanceSchema.safeParse({
        id: UUID,
        disbursement_ref: "",
      }).success,
    ).toBe(false);
    expect(
      disburseCanonicalCashAdvanceSchema.safeParse({
        id: UUID,
        disbursement_ref: "BCA-2026-0812-001",
      }).success,
    ).toBe(true);
  });

  it("caps disbursement_ref length", () => {
    expect(
      disburseCanonicalCashAdvanceSchema.safeParse({
        id: UUID,
        disbursement_ref: "x".repeat(201),
      }).success,
    ).toBe(false);
  });

  it("allows an optional note", () => {
    const parsed = disburseCanonicalCashAdvanceSchema.parse({
      id: UUID,
      disbursement_ref: "BCA-1",
      note: "  disbursed manually  ",
    });
    expect(parsed.note).toBe("disbursed manually");
  });
});

describe("submitCanonicalSettlementSchema", () => {
  it("accepts a non-negative spent amount", () => {
    expect(
      submitCanonicalSettlementSchema.safeParse({
        cash_advance_id: UUID,
        total_spent_idr: 0,
      }).success,
    ).toBe(true);
    expect(
      submitCanonicalSettlementSchema.safeParse({
        cash_advance_id: UUID,
        total_spent_idr: 250_000,
      }).success,
    ).toBe(true);
  });

  it("rejects negative spent", () => {
    expect(
      submitCanonicalSettlementSchema.safeParse({
        cash_advance_id: UUID,
        total_spent_idr: -1,
      }).success,
    ).toBe(false);
  });

  it("rejects non-integer spent", () => {
    expect(
      submitCanonicalSettlementSchema.safeParse({
        cash_advance_id: UUID,
        total_spent_idr: 1.5,
      }).success,
    ).toBe(false);
  });
});

describe("acceptCanonicalSettlementSchema / returnCanonicalSettlementSchema", () => {
  it("accepts a valid settlement id", () => {
    expect(
      acceptCanonicalSettlementSchema.safeParse({ settlement_id: UUID })
        .success,
    ).toBe(true);
  });

  it("return requires a reason", () => {
    expect(
      returnCanonicalSettlementSchema.safeParse({
        settlement_id: UUID,
        reason: "no",
      }).success,
    ).toBe(false);
    expect(
      returnCanonicalSettlementSchema.safeParse({
        settlement_id: UUID,
        reason: "receipts mismatch total_spent",
      }).success,
    ).toBe(true);
  });

  it("rejects non-UUID settlement_id", () => {
    expect(
      returnCanonicalSettlementSchema.safeParse({
        settlement_id: "not-a-uuid",
        reason: "receipts mismatch total_spent",
      }).success,
    ).toBe(false);
  });

  it("distinguishes multiple UUIDs", () => {
    expect(
      acceptCanonicalSettlementSchema.parse({ settlement_id: UUID_2 })
        .settlement_id,
    ).toBe(UUID_2);
  });
});
