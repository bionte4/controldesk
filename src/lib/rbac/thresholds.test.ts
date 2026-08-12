import { describe, expect, it } from "vitest";

import { APPROVAL_CONFIG } from "@/lib/rbac/roles";
import {
  mergeThresholds,
  pickNumber,
  type ThresholdRow,
} from "@/lib/rbac/thresholds";

function row(overrides: Partial<ThresholdRow> = {}): ThresholdRow {
  return {
    supervisor_threshold: null,
    pm_threshold: null,
    om_threshold: null,
    director_threshold: null,
    petty_auto_approve_below: null,
    petty_receipt_required_above: null,
    petty_hard_ceiling: null,
    settlement_sla_days: null,
    ...overrides,
  };
}

describe("pickNumber", () => {
  it("returns null when the row is null", () => {
    expect(pickNumber(null, "pm_threshold")).toBeNull();
  });

  it("returns null when the field is null/undefined", () => {
    expect(pickNumber(row(), "pm_threshold")).toBeNull();
  });

  it("coerces Postgres numeric strings to numbers", () => {
    // supabase-js returns numeric columns as strings — this is the primary
    // shape resolveThresholds() will feed in.
    expect(pickNumber(row({ pm_threshold: "3000000" }), "pm_threshold")).toBe(
      3_000_000,
    );
  });

  it("passes through native numbers", () => {
    expect(pickNumber(row({ pm_threshold: 1_500_000 }), "pm_threshold")).toBe(
      1_500_000,
    );
  });

  it("rejects non-finite / garbage values by returning null", () => {
    expect(pickNumber(row({ pm_threshold: "not-a-number" }), "pm_threshold"))
      .toBeNull();
  });
});

describe("mergeThresholds — EXPENSE", () => {
  it("returns code defaults when row is null", () => {
    const t = mergeThresholds("EXPENSE", null);
    expect(t).toEqual({
      kind: "EXPENSE",
      PM_THRESHOLD: APPROVAL_CONFIG.EXPENSE.PM_THRESHOLD,
      DIRECTOR_THRESHOLD: APPROVAL_CONFIG.EXPENSE.DIRECTOR_THRESHOLD,
    });
  });

  it("applies pm_threshold override, keeps director default", () => {
    const t = mergeThresholds("EXPENSE", row({ pm_threshold: "3000000" }));
    expect(t).toEqual({
      kind: "EXPENSE",
      PM_THRESHOLD: 3_000_000,
      DIRECTOR_THRESHOLD: APPROVAL_CONFIG.EXPENSE.DIRECTOR_THRESHOLD,
    });
  });

  it("applies both pm and director overrides", () => {
    const t = mergeThresholds(
      "EXPENSE",
      row({ pm_threshold: 1_000_000, director_threshold: 25_000_000 }),
    );
    expect(t).toMatchObject({
      PM_THRESHOLD: 1_000_000,
      DIRECTOR_THRESHOLD: 25_000_000,
    });
  });
});

describe("mergeThresholds — BUDGET", () => {
  it("falls back when row is null", () => {
    const t = mergeThresholds("BUDGET", null);
    expect(t).toEqual({
      kind: "BUDGET",
      DIRECTOR_THRESHOLD: APPROVAL_CONFIG.BUDGET.DIRECTOR_THRESHOLD,
    });
  });

  it("only reads director_threshold, ignores unrelated pm_threshold override", () => {
    const t = mergeThresholds(
      "BUDGET",
      row({ pm_threshold: 99, director_threshold: "40000000" }),
    );
    expect(t).toEqual({ kind: "BUDGET", DIRECTOR_THRESHOLD: 40_000_000 });
  });
});

describe("mergeThresholds — CASH_ADVANCE_GENERAL", () => {
  it("falls back to code defaults", () => {
    expect(mergeThresholds("CASH_ADVANCE_GENERAL", null)).toEqual({
      kind: "CASH_ADVANCE_GENERAL",
      PM_THRESHOLD: APPROVAL_CONFIG.CASH_ADVANCE_GENERAL.PM_THRESHOLD,
      DIRECTOR_THRESHOLD:
        APPROVAL_CONFIG.CASH_ADVANCE_GENERAL.DIRECTOR_THRESHOLD,
    });
  });

  it("overrides pm and director", () => {
    const t = mergeThresholds(
      "CASH_ADVANCE_GENERAL",
      row({ pm_threshold: "500000", director_threshold: "10000000" }),
    );
    expect(t).toMatchObject({
      PM_THRESHOLD: 500_000,
      DIRECTOR_THRESHOLD: 10_000_000,
    });
  });
});

describe("mergeThresholds — CASH_ADVANCE_FIELD_OPS", () => {
  it("falls back with reminder offsets from constants", () => {
    const t = mergeThresholds("CASH_ADVANCE_FIELD_OPS", null);
    expect(t).toEqual({
      kind: "CASH_ADVANCE_FIELD_OPS",
      PM_THRESHOLD: APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.PM_THRESHOLD,
      OM_THRESHOLD: APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.OM_THRESHOLD,
      DIRECTOR_THRESHOLD:
        APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.DIRECTOR_THRESHOLD,
      SETTLEMENT_SLA_DAYS:
        APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.SETTLEMENT_SLA_DAYS,
      SETTLEMENT_REMINDER_OFFSETS:
        APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.SETTLEMENT_REMINDER_OFFSETS,
    });
  });

  it("applies a tightened settlement_sla_days without touching offsets", () => {
    const t = mergeThresholds(
      "CASH_ADVANCE_FIELD_OPS",
      row({ settlement_sla_days: 7 }),
    );
    expect(t).toMatchObject({
      SETTLEMENT_SLA_DAYS: 7,
      SETTLEMENT_REMINDER_OFFSETS:
        APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.SETTLEMENT_REMINDER_OFFSETS,
    });
  });

  it("applies pm + om + director + sla together", () => {
    const t = mergeThresholds(
      "CASH_ADVANCE_FIELD_OPS",
      row({
        pm_threshold: "3000000",
        om_threshold: "15000000",
        director_threshold: "40000000",
        settlement_sla_days: 5,
      }),
    );
    expect(t).toMatchObject({
      PM_THRESHOLD: 3_000_000,
      OM_THRESHOLD: 15_000_000,
      DIRECTOR_THRESHOLD: 40_000_000,
      SETTLEMENT_SLA_DAYS: 5,
    });
  });
});

describe("mergeThresholds — PETTY_CASH", () => {
  it("falls back to all defaults", () => {
    expect(mergeThresholds("PETTY_CASH", null)).toEqual({
      kind: "PETTY_CASH",
      AUTO_APPROVE_BELOW: APPROVAL_CONFIG.PETTY_CASH.AUTO_APPROVE_BELOW,
      RECEIPT_REQUIRED_ABOVE: APPROVAL_CONFIG.PETTY_CASH.RECEIPT_REQUIRED_ABOVE,
      HARD_CEILING: APPROVAL_CONFIG.PETTY_CASH.HARD_CEILING,
      LOW_BALANCE_RATIO: APPROVAL_CONFIG.PETTY_CASH.LOW_BALANCE_RATIO,
      RECON_OVERDUE_DAYS: APPROVAL_CONFIG.PETTY_CASH.RECON_OVERDUE_DAYS,
      VARIANCE_TOLERANCE_IDR: APPROVAL_CONFIG.PETTY_CASH.VARIANCE_TOLERANCE_IDR,
    });
  });

  it("overrides only tunable numeric fields; keeps ratios/const-only", () => {
    const t = mergeThresholds(
      "PETTY_CASH",
      row({
        petty_auto_approve_below: "150000",
        petty_receipt_required_above: "50000",
        petty_hard_ceiling: "1500000",
      }),
    );
    expect(t).toMatchObject({
      AUTO_APPROVE_BELOW: 150_000,
      RECEIPT_REQUIRED_ABOVE: 50_000,
      HARD_CEILING: 1_500_000,
      // Non-overridable knobs stay pinned to code defaults.
      LOW_BALANCE_RATIO: APPROVAL_CONFIG.PETTY_CASH.LOW_BALANCE_RATIO,
      RECON_OVERDUE_DAYS: APPROVAL_CONFIG.PETTY_CASH.RECON_OVERDUE_DAYS,
      VARIANCE_TOLERANCE_IDR: APPROVAL_CONFIG.PETTY_CASH.VARIANCE_TOLERANCE_IDR,
    });
  });
});

describe("mergeThresholds — BUDGET_REQUEST", () => {
  it("falls back to defaults + keeps MIN_JUSTIFICATION_CHARS from code", () => {
    expect(mergeThresholds("BUDGET_REQUEST", null)).toEqual({
      kind: "BUDGET_REQUEST",
      PM_THRESHOLD: APPROVAL_CONFIG.BUDGET_REQUEST.PM_THRESHOLD,
      DIRECTOR_THRESHOLD: APPROVAL_CONFIG.BUDGET_REQUEST.DIRECTOR_THRESHOLD,
      MIN_JUSTIFICATION_CHARS:
        APPROVAL_CONFIG.BUDGET_REQUEST.MIN_JUSTIFICATION_CHARS,
    });
  });

  it("applies pm and director overrides", () => {
    const t = mergeThresholds(
      "BUDGET_REQUEST",
      row({ pm_threshold: "2000000", director_threshold: "30000000" }),
    );
    expect(t).toMatchObject({
      PM_THRESHOLD: 2_000_000,
      DIRECTOR_THRESHOLD: 30_000_000,
      MIN_JUSTIFICATION_CHARS:
        APPROVAL_CONFIG.BUDGET_REQUEST.MIN_JUSTIFICATION_CHARS,
    });
  });
});

describe("mergeThresholds — discriminated union tag", () => {
  it("stamps the `kind` discriminator on every branch", () => {
    const kinds = [
      "EXPENSE",
      "BUDGET",
      "CASH_ADVANCE_GENERAL",
      "CASH_ADVANCE_FIELD_OPS",
      "PETTY_CASH",
      "BUDGET_REQUEST",
    ] as const;
    for (const k of kinds) {
      expect(mergeThresholds(k, null).kind).toBe(k);
    }
  });
});
