import { describe, expect, it } from "vitest";

import {
  MILESTONE_STATUS_LABEL,
  MILESTONE_STATUS_TONE,
  WEIGHT_BPS_MAX,
  bpsToPercent,
  nextAllowedMilestoneStatuses,
  percentToBps,
  remainingWeightBps,
  sumDoneWeightBps,
  sumWeightBps,
  weightFitsBudget,
} from "./state";

describe("milestone constants", () => {
  it("WEIGHT_BPS_MAX equals 10 000", () => {
    expect(WEIGHT_BPS_MAX).toBe(10_000);
  });

  it("label + tone maps cover every enum value", () => {
    for (const s of [
      "PLANNED",
      "IN_PROGRESS",
      "AT_RISK",
      "DONE",
      "CANCELLED",
    ] as const) {
      expect(MILESTONE_STATUS_LABEL[s]).toBeTruthy();
      expect(MILESTONE_STATUS_TONE[s]).toBeTruthy();
    }
  });
});

describe("bps ↔ percent helpers", () => {
  it("bpsToPercent converts basis points to human percent", () => {
    expect(bpsToPercent(0)).toBe(0);
    expect(bpsToPercent(100)).toBe(1);
    expect(bpsToPercent(2550)).toBe(25.5);
    expect(bpsToPercent(10_000)).toBe(100);
  });

  it("percentToBps rounds half-up", () => {
    expect(percentToBps(0)).toBe(0);
    expect(percentToBps(25.5)).toBe(2550);
    expect(percentToBps(25.505)).toBe(2551);
    expect(percentToBps(100)).toBe(10_000);
  });

  it("percentToBps clamps out-of-range inputs", () => {
    expect(percentToBps(-5)).toBe(0);
    expect(percentToBps(200)).toBe(10_000);
  });

  it("percentToBps ↔ bpsToPercent round-trip for clean values", () => {
    for (const p of [0, 12.5, 25, 33.33, 66.67, 100]) {
      expect(bpsToPercent(percentToBps(p))).toBeCloseTo(p, 2);
    }
  });
});

describe("weight aggregation", () => {
  const sample = [
    { weight_bps: 3000, status: "DONE" as const },
    { weight_bps: 2000, status: "IN_PROGRESS" as const },
    { weight_bps: 1500, status: "AT_RISK" as const },
    { weight_bps: 500, status: "CANCELLED" as const },
    { weight_bps: 3000, status: "PLANNED" as const },
  ];

  it("sumWeightBps totals every row regardless of status", () => {
    expect(sumWeightBps(sample)).toBe(10_000);
  });

  it("sumDoneWeightBps counts only DONE rows", () => {
    expect(sumDoneWeightBps(sample)).toBe(3000);
  });

  it("sumWeightBps handles empty list", () => {
    expect(sumWeightBps([])).toBe(0);
  });

  it("sumDoneWeightBps handles list with no DONE rows", () => {
    expect(
      sumDoneWeightBps([{ weight_bps: 5000, status: "PLANNED" }]),
    ).toBe(0);
  });
});

describe("remainingWeightBps + weightFitsBudget", () => {
  const existing = [{ weight_bps: 4000 }, { weight_bps: 3000 }];

  it("returns positive remaining capacity when proposal fits", () => {
    expect(remainingWeightBps(existing, 2000)).toBe(1000);
    expect(weightFitsBudget(existing, 2000)).toBe(true);
  });

  it("returns zero when proposal fills exactly the remainder", () => {
    expect(remainingWeightBps(existing, 3000)).toBe(0);
    expect(weightFitsBudget(existing, 3000)).toBe(true);
  });

  it("returns negative when proposal overflows", () => {
    expect(remainingWeightBps(existing, 5000)).toBe(-2000);
    expect(weightFitsBudget(existing, 5000)).toBe(false);
  });

  it("handles empty existing rows (full budget available)", () => {
    expect(remainingWeightBps([], 5000)).toBe(5000);
    expect(weightFitsBudget([], 10_000)).toBe(true);
    expect(weightFitsBudget([], 10_001)).toBe(false);
  });
});

describe("nextAllowedMilestoneStatuses", () => {
  it("PLANNED can move to IN_PROGRESS, AT_RISK, CANCELLED", () => {
    expect(nextAllowedMilestoneStatuses("PLANNED")).toEqual([
      "IN_PROGRESS",
      "AT_RISK",
      "CANCELLED",
    ]);
  });

  it("IN_PROGRESS can move to AT_RISK, DONE, CANCELLED", () => {
    expect(nextAllowedMilestoneStatuses("IN_PROGRESS")).toEqual([
      "AT_RISK",
      "DONE",
      "CANCELLED",
    ]);
  });

  it("AT_RISK can move to IN_PROGRESS, DONE, CANCELLED", () => {
    expect(nextAllowedMilestoneStatuses("AT_RISK")).toEqual([
      "IN_PROGRESS",
      "DONE",
      "CANCELLED",
    ]);
  });

  it("DONE has no forward transitions", () => {
    expect(nextAllowedMilestoneStatuses("DONE")).toEqual([]);
  });

  it("CANCELLED can be reopened to PLANNED", () => {
    expect(nextAllowedMilestoneStatuses("CANCELLED")).toEqual(["PLANNED"]);
  });
});
