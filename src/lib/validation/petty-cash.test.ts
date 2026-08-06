import { describe, expect, it } from "vitest";

import {
  createPettyCashFundSchema,
  createPettyCashVoucherSchema,
  disburseReplenishmentSchema,
  requestReplenishmentSchema,
  voidPettyCashVoucherSchema,
  PETTY_CASH_VOUCHER_MAX_IDR,
} from "./petty-cash";

const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("createPettyCashFundSchema", () => {
  it("accepts a valid fund", () => {
    const parsed = createPettyCashFundSchema.safeParse({
      location_name: "Jakarta HQ",
      custodian_employee_id: uuid,
      imprest_idr: 5_000_000,
      min_balance_idr: 500_000,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects min_balance > imprest", () => {
    const parsed = createPettyCashFundSchema.safeParse({
      location_name: "Jakarta HQ",
      custodian_employee_id: uuid,
      imprest_idr: 100_000,
      min_balance_idr: 500_000,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects opening_balance > imprest", () => {
    const parsed = createPettyCashFundSchema.safeParse({
      location_name: "Jakarta HQ",
      custodian_employee_id: uuid,
      imprest_idr: 100_000,
      min_balance_idr: 0,
      opening_balance_idr: 200_000,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("createPettyCashVoucherSchema", () => {
  it("accepts a valid voucher under the ceiling", () => {
    const parsed = createPettyCashVoucherSchema.safeParse({
      fund_id: uuid,
      amount_idr: 200_000,
      category: "TRANSPORT",
      description: "Ojek to client meeting",
      incurred_on: "2026-06-15",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects vouchers at or above the Rp 1.000.000 ceiling", () => {
    const parsed = createPettyCashVoucherSchema.safeParse({
      fund_id: uuid,
      amount_idr: PETTY_CASH_VOUCHER_MAX_IDR,
      category: "TRANSPORT",
      description: "Too big",
      incurred_on: "2026-06-15",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown categories", () => {
    const parsed = createPettyCashVoucherSchema.safeParse({
      fund_id: uuid,
      amount_idr: 50_000,
      category: "BRIBE",
      description: "Nope",
      incurred_on: "2026-06-15",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("replenishment schemas", () => {
  it("requestReplenishment accepts a positive amount", () => {
    const parsed = requestReplenishmentSchema.safeParse({
      fund_id: uuid,
      requested_amount_idr: 2_000_000,
      reason: "Low balance",
    });
    expect(parsed.success).toBe(true);
  });

  it("requestReplenishment rejects non-positive amount", () => {
    const parsed = requestReplenishmentSchema.safeParse({
      fund_id: uuid,
      requested_amount_idr: 0,
    });
    expect(parsed.success).toBe(false);
  });

  it("disburseReplenishment requires a reference", () => {
    expect(
      disburseReplenishmentSchema.safeParse({ id: uuid }).success,
    ).toBe(false);
    expect(
      disburseReplenishmentSchema.safeParse({
        id: uuid,
        disbursement_ref: "TRX-2026-0002",
      }).success,
    ).toBe(true);
  });
});

describe("voidPettyCashVoucherSchema", () => {
  it("requires a non-blank reason", () => {
    expect(voidPettyCashVoucherSchema.safeParse({ id: uuid }).success).toBe(
      false,
    );
    expect(
      voidPettyCashVoucherSchema.safeParse({ id: uuid, reason: "Duplicate" })
        .success,
    ).toBe(true);
  });
});
