import { describe, expect, it } from "vitest";

import { computePlannedDeltas, sumDeltas } from "./apply";

const A = "detail-a";
const B = "detail-b";

describe("computePlannedDeltas — INCREASE", () => {
  it("returns +delta on the target line", () => {
    const deltas = computePlannedDeltas({
      kind: "INCREASE",
      lines: [{ budget_detail_id: A, direction: "TO", delta_amount: 5_000_000n }],
    });
    expect(deltas).toEqual([{ budget_detail_id: A, delta: 5_000_000n }]);
    expect(sumDeltas(deltas)).toBe(5_000_000n);
  });

  it("rejects a FROM line", () => {
    expect(() =>
      computePlannedDeltas({
        kind: "INCREASE",
        lines: [
          { budget_detail_id: A, direction: "FROM", delta_amount: 5_000_000n },
        ],
      }),
    ).toThrow();
  });

  it("rejects multiple lines", () => {
    expect(() =>
      computePlannedDeltas({
        kind: "INCREASE",
        lines: [
          { budget_detail_id: A, direction: "TO", delta_amount: 1n },
          { budget_detail_id: B, direction: "TO", delta_amount: 1n },
        ],
      }),
    ).toThrow();
  });
});

describe("computePlannedDeltas — DECREASE", () => {
  it("returns -delta on the source line", () => {
    const deltas = computePlannedDeltas({
      kind: "DECREASE",
      lines: [
        { budget_detail_id: A, direction: "FROM", delta_amount: 500_000n },
      ],
    });
    expect(deltas).toEqual([{ budget_detail_id: A, delta: -500_000n }]);
    expect(sumDeltas(deltas)).toBe(-500_000n);
  });

  it("rejects a TO line", () => {
    expect(() =>
      computePlannedDeltas({
        kind: "DECREASE",
        lines: [
          { budget_detail_id: A, direction: "TO", delta_amount: 500_000n },
        ],
      }),
    ).toThrow();
  });
});

describe("computePlannedDeltas — TRANSFER", () => {
  it("returns net-zero deltas across FROM and TO", () => {
    const deltas = computePlannedDeltas({
      kind: "TRANSFER",
      lines: [
        { budget_detail_id: A, direction: "FROM", delta_amount: 2_000_000n },
        { budget_detail_id: B, direction: "TO", delta_amount: 2_000_000n },
      ],
    });
    expect(deltas).toContainEqual({ budget_detail_id: A, delta: -2_000_000n });
    expect(deltas).toContainEqual({ budget_detail_id: B, delta: 2_000_000n });
    expect(sumDeltas(deltas)).toBe(0n);
  });

  it("rejects mismatched deltas", () => {
    expect(() =>
      computePlannedDeltas({
        kind: "TRANSFER",
        lines: [
          { budget_detail_id: A, direction: "FROM", delta_amount: 2_000_000n },
          { budget_detail_id: B, direction: "TO", delta_amount: 1_000_000n },
        ],
      }),
    ).toThrow(/deltas must match/i);
  });

  it("rejects missing FROM or TO", () => {
    expect(() =>
      computePlannedDeltas({
        kind: "TRANSFER",
        lines: [
          { budget_detail_id: A, direction: "TO", delta_amount: 1n },
          { budget_detail_id: B, direction: "TO", delta_amount: 1n },
        ],
      }),
    ).toThrow();
  });

  it("rejects same-line FROM/TO", () => {
    expect(() =>
      computePlannedDeltas({
        kind: "TRANSFER",
        lines: [
          { budget_detail_id: A, direction: "FROM", delta_amount: 1n },
          { budget_detail_id: A, direction: "TO", delta_amount: 1n },
        ],
      }),
    ).toThrow(/different lines/i);
  });

  it("rejects != 2 lines", () => {
    expect(() =>
      computePlannedDeltas({
        kind: "TRANSFER",
        lines: [
          { budget_detail_id: A, direction: "FROM", delta_amount: 1n },
        ],
      }),
    ).toThrow();
  });
});

describe("computePlannedDeltas — invariants", () => {
  it("rejects empty lines", () => {
    expect(() =>
      computePlannedDeltas({ kind: "INCREASE", lines: [] }),
    ).toThrow();
  });

  it("rejects non-positive delta_amount", () => {
    expect(() =>
      computePlannedDeltas({
        kind: "INCREASE",
        lines: [
          { budget_detail_id: A, direction: "TO", delta_amount: 0n },
        ],
      }),
    ).toThrow();
  });
});
