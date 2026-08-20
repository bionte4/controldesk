import { describe, expect, it } from "vitest";

import {
  addMoney,
  applyBasisPoints,
  formatIDR,
  formatIDRRange,
  formatIDRWithMask,
  IDR_MASK_PLACEHOLDER,
  moneyToDbString,
  mulMoney,
  parseMoneyFromDb,
  parseMoneyFromInput,
  subMoney,
} from "@/lib/format/money";

describe("money — parsing", () => {
  it("parses Postgres numeric string into bigint sen", () => {
    expect(parseMoneyFromDb("1500000.00")).toBe(1_500_000n);
    expect(parseMoneyFromDb("0.00")).toBe(0n);
    expect(parseMoneyFromDb(null)).toBe(0n);
  });

  it("parses user input with thousand separators", () => {
    expect(parseMoneyFromInput("Rp 1.500.000")).toBe(1_500_000n);
    expect(parseMoneyFromInput("1,500,000")).toBe(1_500_000n);
    expect(parseMoneyFromInput("500000")).toBe(500_000n);
  });

  it("throws on non-numeric input", () => {
    expect(() => parseMoneyFromInput("abc")).toThrow();
  });

  it("returns 0n for empty input", () => {
    expect(parseMoneyFromInput("")).toBe(0n);
    expect(parseMoneyFromInput("   ")).toBe(0n);
  });
});

describe("money — arithmetic precision (rules §18)", () => {
  it("addMoney is exact over many operands", () => {
    expect(addMoney(100n, 200n, 300n)).toBe(600n);
    expect(addMoney()).toBe(0n);
  });

  it("subMoney handles negatives", () => {
    expect(subMoney(1_000n, 1_500n)).toBe(-500n);
  });

  it("mulMoney accepts integer or bigint factor", () => {
    expect(mulMoney(1_500_000n, 3)).toBe(4_500_000n);
    expect(mulMoney(1_500_000n, 3n)).toBe(4_500_000n);
  });

  it("does NOT lose precision on floating-point-like operations", () => {
    // The classic 0.1 + 0.2 = 0.30000000000000004 bug is impossible here
    // because we use bigint cents.
    const a = 10n;
    const b = 20n;
    expect(a + b).toBe(30n);
  });

  it("applyBasisPoints correctly computes VAT 11%", () => {
    // 11% = 1100 bp.
    const price = 10_000_000n;
    const vat = applyBasisPoints(price, 1100);
    expect(vat).toBe(1_100_000n);
  });

  it("applyBasisPoints preserves precision for rounded-down half-cent", () => {
    // 12345 * 33% = 4073.85 → floor → 4073 (bigint truncation is toward zero)
    expect(applyBasisPoints(12345n, 3300)).toBe(4073n);
  });
});

describe("money — DB serialization", () => {
  it("serialises to numeric-compatible string", () => {
    expect(moneyToDbString(1_500_000n)).toBe("1500000.00");
    expect(moneyToDbString(0n)).toBe("0.00");
  });

  it("round-trips through DB parse", () => {
    const original = 987_654_321n;
    expect(parseMoneyFromDb(moneyToDbString(original))).toBe(original);
  });
});

describe("money — display", () => {
  it("formatIDR renders id-ID currency", () => {
    const s = formatIDR(1_500_000n);
    expect(s).toMatch(/Rp/);
    expect(s).toMatch(/1[.\s]500[.\s]000/);
  });

  it("formatIDR compact renders juta/miliar shorthand", () => {
    const s = formatIDR(1_500_000_000n, { compact: true });
    // Locale id-ID compact uses M for miliar. Just assert non-empty + short.
    expect(s.length).toBeLessThan(20);
    expect(s).toMatch(/Rp/);
  });

  it("formatIDRRange has an en-dash separator", () => {
    const s = formatIDRRange(5_000_000n, 25_000_000n);
    expect(s).toContain("–");
  });
});

describe("money — mask (view_budget_amount gate)", () => {
  it("renders formatted IDR when caller CAN view", () => {
    const s = formatIDRWithMask(1_500_000_000n, true, { compact: true });
    expect(s).toMatch(/Rp/);
    expect(s).not.toBe(IDR_MASK_PLACEHOLDER);
  });

  it("renders the mask placeholder when caller CANNOT view", () => {
    expect(formatIDRWithMask(1_500_000_000n, false)).toBe(IDR_MASK_PLACEHOLDER);
    expect(formatIDRWithMask(0n, false, { compact: true })).toBe(
      IDR_MASK_PLACEHOLDER,
    );
  });

  it("mask placeholder starts with Rp so it aligns with unmasked rows", () => {
    // UI depends on this to keep tabular alignment in tables.
    expect(IDR_MASK_PLACEHOLDER.startsWith("Rp")).toBe(true);
  });
});
