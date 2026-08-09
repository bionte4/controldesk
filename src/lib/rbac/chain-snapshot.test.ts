/**
 * Unit tests for chain-snapshot serialisation + read helpers (Option B,
 * rules §22). Every snapshot writer is exercised alongside the polymorphic
 * `thresholdsFromSnapshot()` reader to guarantee a round-trip contract:
 *   input → snapshot → read back → same thresholds
 *
 * These tests intentionally avoid the DB — the helpers are pure and their
 * value is the schema contract, not persistence. DB behaviour is
 * exercised in the sql-tests suite.
 */

import { describe, expect, it } from "vitest";

import {
  isChainSnapshot,
  snapshotBudgetChain,
  snapshotBudgetRequestChain,
  snapshotCaFieldOpsChain,
  snapshotCaGeneralChain,
  snapshotExpenseChain,
  thresholdsFromSnapshot,
} from "./chain-snapshot";

describe("chain-snapshot — Expense", () => {
  it("freezes the resolved chain + thresholds at the time of submit", () => {
    const s = snapshotExpenseChain({
      amountIDR: 12_000_000,
      thresholds: { PM_THRESHOLD: 5_000_000, DIRECTOR_THRESHOLD: 50_000_000 },
    });
    expect(s.kind).toBe("EXPENSE");
    expect(s.amount_idr).toBe(12_000_000);
    expect(s.slots).toEqual(["PM", "FINANCE"]);
    expect(s.thresholds).toEqual({
      PM_THRESHOLD: 5_000_000,
      DIRECTOR_THRESHOLD: 50_000_000,
    });
    expect(typeof s.snapshot_at).toBe("string");
    // ISO-8601 sanity check — must parse back to a finite date.
    expect(new Date(s.snapshot_at).getTime()).toBeGreaterThan(0);
  });

  it("respects custom thresholds when picking slots", () => {
    // With PM=1M, a 2M expense crosses PM but not Director.
    const s = snapshotExpenseChain({
      amountIDR: 2_000_000,
      thresholds: { PM_THRESHOLD: 1_000_000, DIRECTOR_THRESHOLD: 50_000_000 },
    });
    expect(s.slots).toEqual(["PM", "FINANCE"]);
  });
});

describe("chain-snapshot — Budget", () => {
  it("only ever contains FINANCE + optional DIRECTOR", () => {
    const s = snapshotBudgetChain({
      totalPlannedIDR: 100_000_000,
      thresholds: { DIRECTOR_THRESHOLD: 50_000_000 },
    });
    expect(s.slots).toEqual(["FINANCE", "DIRECTOR"]);
  });

  it("stamps only the DIRECTOR threshold in the snapshot", () => {
    const s = snapshotBudgetChain({
      totalPlannedIDR: 10_000_000,
      thresholds: { DIRECTOR_THRESHOLD: 100_000_000 },
    });
    expect(s.thresholds).toEqual({ DIRECTOR_THRESHOLD: 100_000_000 });
    expect(s.slots).toEqual(["FINANCE"]);
  });
});

describe("chain-snapshot — Cash Advance", () => {
  it("General branch mirrors Expense pattern (no Supervisor)", () => {
    const s = snapshotCaGeneralChain({
      amountIDR: 25_000_000,
      thresholds: { PM_THRESHOLD: 2_000_000, DIRECTOR_THRESHOLD: 20_000_000 },
    });
    expect(s.kind).toBe("CASH_ADVANCE_GENERAL");
    expect(s.slots).toEqual(["PM", "FINANCE", "DIRECTOR"]);
  });

  it("Field Ops always starts at SUPERVISOR", () => {
    const s = snapshotCaFieldOpsChain({
      amountIDR: 500_000,
      thresholds: {
        PM_THRESHOLD: 5_000_000,
        OM_THRESHOLD: 20_000_000,
        DIRECTOR_THRESHOLD: 50_000_000,
      },
    });
    expect(s.slots[0]).toBe("SUPERVISOR");
    expect(s.slots).toContain("FINANCE");
  });

  it("Field Ops escalates through PM / OM / Director as amount climbs", () => {
    const th = {
      PM_THRESHOLD: 5_000_000,
      OM_THRESHOLD: 20_000_000,
      DIRECTOR_THRESHOLD: 50_000_000,
    };
    const s = snapshotCaFieldOpsChain({ amountIDR: 50_000_000, thresholds: th });
    expect(s.slots).toEqual([
      "SUPERVISOR",
      "PM",
      "OM",
      "FINANCE",
      "DIRECTOR",
    ]);
  });
});

describe("chain-snapshot — Budget Request", () => {
  it("mirrors Expense chain (Finance always in, PM + Director gated by amount)", () => {
    const s = snapshotBudgetRequestChain({
      amountIDR: 5_000_000,
      thresholds: { PM_THRESHOLD: 5_000_000, DIRECTOR_THRESHOLD: 50_000_000 },
    });
    expect(s.slots).toEqual(["PM", "FINANCE"]);
  });
});

describe("chain-snapshot — isChainSnapshot() guard", () => {
  it("accepts a well-formed snapshot payload", () => {
    const s = snapshotExpenseChain({
      amountIDR: 1000,
      thresholds: { PM_THRESHOLD: 500, DIRECTOR_THRESHOLD: 10_000 },
    });
    expect(isChainSnapshot(s)).toBe(true);
  });

  it("rejects null / undefined / primitives", () => {
    expect(isChainSnapshot(null)).toBe(false);
    expect(isChainSnapshot(undefined)).toBe(false);
    expect(isChainSnapshot(42)).toBe(false);
    expect(isChainSnapshot("string")).toBe(false);
    expect(isChainSnapshot([])).toBe(false);
  });

  it("rejects partial objects missing required fields", () => {
    expect(isChainSnapshot({ kind: "EXPENSE" })).toBe(false);
    expect(
      isChainSnapshot({
        kind: "EXPENSE",
        slots: ["FINANCE"],
        // missing snapshot_at + amount_idr
      }),
    ).toBe(false);
  });
});

describe("chain-snapshot — thresholdsFromSnapshot() reader", () => {
  it("returns null for missing / malformed snapshots (legacy pre-B row)", () => {
    expect(thresholdsFromSnapshot(null, "EXPENSE")).toBeNull();
    expect(thresholdsFromSnapshot({}, "EXPENSE")).toBeNull();
    expect(thresholdsFromSnapshot("not an object", "EXPENSE")).toBeNull();
  });

  it("returns null when snapshot kind differs from expected", () => {
    // A caller reading Budget row expects BUDGET; if the row somehow
    // carries an EXPENSE snapshot, we must not silently mis-narrow.
    const wrongKind = snapshotExpenseChain({
      amountIDR: 1000,
      thresholds: { PM_THRESHOLD: 500, DIRECTOR_THRESHOLD: 10_000 },
    });
    expect(thresholdsFromSnapshot(wrongKind, "BUDGET")).toBeNull();
  });

  it("extracts the expected threshold branch when kind matches", () => {
    const snap = snapshotCaFieldOpsChain({
      amountIDR: 1_000_000,
      thresholds: {
        PM_THRESHOLD: 5_000_000,
        OM_THRESHOLD: 20_000_000,
        DIRECTOR_THRESHOLD: 50_000_000,
      },
    });
    const back = thresholdsFromSnapshot(snap, "CASH_ADVANCE_FIELD_OPS");
    expect(back).toEqual({
      PM_THRESHOLD: 5_000_000,
      OM_THRESHOLD: 20_000_000,
      DIRECTOR_THRESHOLD: 50_000_000,
    });
  });

  it("round-trip preserves values across all five kinds", () => {
    const cases = [
      snapshotExpenseChain({
        amountIDR: 1,
        thresholds: { PM_THRESHOLD: 1, DIRECTOR_THRESHOLD: 2 },
      }),
      snapshotBudgetChain({
        totalPlannedIDR: 1,
        thresholds: { DIRECTOR_THRESHOLD: 3 },
      }),
      snapshotCaGeneralChain({
        amountIDR: 1,
        thresholds: { PM_THRESHOLD: 4, DIRECTOR_THRESHOLD: 5 },
      }),
      snapshotCaFieldOpsChain({
        amountIDR: 1,
        thresholds: {
          PM_THRESHOLD: 6,
          OM_THRESHOLD: 7,
          DIRECTOR_THRESHOLD: 8,
        },
      }),
      snapshotBudgetRequestChain({
        amountIDR: 1,
        thresholds: { PM_THRESHOLD: 9, DIRECTOR_THRESHOLD: 10 },
      }),
    ];
    for (const s of cases) {
      const back = thresholdsFromSnapshot(s, s.kind);
      expect(back).toEqual(s.thresholds);
    }
  });
});
