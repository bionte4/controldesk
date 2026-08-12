import { describe, expect, it } from "vitest";

import {
  WARN_WINDOW_DAYS,
  computeAll,
  computeStatus,
  filterAttention,
  summarize,
  type SecretRotationRow,
} from "./rotation";

const NOW = new Date("2026-08-05T00:00:00.000Z");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

function baseRow(overrides: Partial<SecretRotationRow> = {}): SecretRotationRow {
  return {
    name: "TEST_SECRET",
    priority: "P0",
    purpose: "unit test",
    last_rotated_at: daysAgo(10),
    rotation_interval_days: 90,
    ...overrides,
  };
}

describe("computeStatus", () => {
  it("returns OK when the secret was rotated recently", () => {
    const r = computeStatus(baseRow({ last_rotated_at: daysAgo(1) }), NOW);
    expect(r.severity).toBe("OK");
    expect(r.days_since_rotation).toBe(1);
    expect(r.days_until_due).toBe(89);
  });

  it("flips to WARN exactly at the 14-day warning threshold", () => {
    // 90 - 14 = 76 days since rotation → 14 days until due → WARN
    const atThreshold = computeStatus(
      baseRow({ last_rotated_at: daysAgo(90 - WARN_WINDOW_DAYS) }),
      NOW,
    );
    expect(atThreshold.severity).toBe("WARN");
    expect(atThreshold.days_until_due).toBe(WARN_WINDOW_DAYS);
  });

  it("stays OK one day before the WARN threshold", () => {
    const r = computeStatus(
      baseRow({ last_rotated_at: daysAgo(90 - WARN_WINDOW_DAYS - 1) }),
      NOW,
    );
    expect(r.severity).toBe("OK");
    expect(r.days_until_due).toBe(WARN_WINDOW_DAYS + 1);
  });

  it("flips to OVERDUE when the interval elapses", () => {
    const r = computeStatus(baseRow({ last_rotated_at: daysAgo(91) }), NOW);
    expect(r.severity).toBe("OVERDUE");
    expect(r.days_until_due).toBe(-1);
    expect(r.days_since_rotation).toBe(91);
  });

  it("respects a custom rotation_interval_days (60-day P0)", () => {
    const r = computeStatus(
      baseRow({
        rotation_interval_days: 60,
        last_rotated_at: daysAgo(50),
      }),
      NOW,
    );
    expect(r.severity).toBe("WARN");
    expect(r.days_until_due).toBe(10);
  });

  it("treats unparseable timestamps as OVERDUE (safe default)", () => {
    const r = computeStatus(baseRow({ last_rotated_at: "not-a-date" }), NOW);
    expect(r.severity).toBe("OVERDUE");
    expect(r.days_since_rotation).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("computeAll", () => {
  it("sorts OVERDUE → WARN → OK, then by days_until_due asc", () => {
    const rows: SecretRotationRow[] = [
      baseRow({ name: "OK_ROTATED_TODAY", last_rotated_at: daysAgo(0) }),
      baseRow({ name: "OVERDUE_1", last_rotated_at: daysAgo(120) }),
      baseRow({ name: "WARN_5", last_rotated_at: daysAgo(85) }),
      baseRow({ name: "OVERDUE_2", last_rotated_at: daysAgo(200) }),
      baseRow({ name: "WARN_1", last_rotated_at: daysAgo(89) }),
      baseRow({ name: "OK_45D", last_rotated_at: daysAgo(45) }),
    ];

    const sorted = computeAll(rows, NOW);
    expect(sorted.map((r) => r.name)).toEqual([
      "OVERDUE_2", // -110 days until due
      "OVERDUE_1", // -30
      "WARN_1", // 1
      "WARN_5", // 5
      "OK_45D", // 45
      "OK_ROTATED_TODAY", // 90
    ]);
  });
});

describe("filterAttention", () => {
  it("keeps only WARN + OVERDUE rows", () => {
    const rows = computeAll(
      [
        baseRow({ name: "OK", last_rotated_at: daysAgo(0) }),
        baseRow({ name: "WARN", last_rotated_at: daysAgo(85) }),
        baseRow({ name: "OVERDUE", last_rotated_at: daysAgo(120) }),
      ],
      NOW,
    );

    const attn = filterAttention(rows);
    expect(attn.map((r) => r.name).sort()).toEqual(["OVERDUE", "WARN"]);
  });
});

describe("summarize", () => {
  it("produces bucket counts", () => {
    const rows = computeAll(
      [
        baseRow({ name: "A", last_rotated_at: daysAgo(0) }),
        baseRow({ name: "B", last_rotated_at: daysAgo(1) }),
        baseRow({ name: "C", last_rotated_at: daysAgo(80) }),
        baseRow({ name: "D", last_rotated_at: daysAgo(200) }),
      ],
      NOW,
    );
    expect(summarize(rows)).toEqual({
      ok: 2,
      warn: 1,
      overdue: 1,
      total: 4,
    });
  });
});
