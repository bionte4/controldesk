import { describe, it, expect } from "vitest";

import {
  addBusinessDays,
  businessDaysUntil,
  diffBusinessDays,
  isBusinessDay,
} from "./business-days";

const TZ = "Asia/Jakarta";

// Anchor times in Asia/Jakarta wall-clock:
//   2026-08-03 (Mon) 09:00 WIB  = 2026-08-03T02:00:00Z
//   2026-08-04 (Tue) 09:00 WIB  = 2026-08-04T02:00:00Z
//   2026-08-07 (Fri) 09:00 WIB  = 2026-08-07T02:00:00Z
//   2026-08-08 (Sat) 09:00 WIB  = 2026-08-08T02:00:00Z
//   2026-08-09 (Sun) 09:00 WIB
//   2026-08-10 (Mon) 09:00 WIB
const MON = "2026-08-03T02:00:00Z";
const FRI = "2026-08-07T02:00:00Z";
const SAT = "2026-08-08T02:00:00Z";
const SUN = "2026-08-09T02:00:00Z";
const NEXT_MON = "2026-08-10T02:00:00Z";

function ymd(d: Date, tz = TZ): string {
  // yyyy-MM-dd in tenant timezone
  const options: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  const parts = new Intl.DateTimeFormat("en-CA", options).format(d);
  return parts;
}

describe("business-days · isBusinessDay", () => {
  it("Monday–Friday are business days in Asia/Jakarta", () => {
    expect(isBusinessDay(MON, TZ)).toBe(true);
    expect(isBusinessDay("2026-08-04T02:00:00Z", TZ)).toBe(true);
    expect(isBusinessDay("2026-08-05T02:00:00Z", TZ)).toBe(true);
    expect(isBusinessDay("2026-08-06T02:00:00Z", TZ)).toBe(true);
    expect(isBusinessDay(FRI, TZ)).toBe(true);
  });

  it("Saturday and Sunday are not business days", () => {
    expect(isBusinessDay(SAT, TZ)).toBe(false);
    expect(isBusinessDay(SUN, TZ)).toBe(false);
  });

  it("respects the given tenant timezone (edge: Sat 23:30 WIB = Sat 16:30 UTC still Sat in WIB)", () => {
    // 2026-08-08T23:30 WIB → UTC = 2026-08-08T16:30Z
    expect(isBusinessDay("2026-08-08T16:30:00Z", TZ)).toBe(false);
  });
});

describe("business-days · addBusinessDays", () => {
  it("adds 1 wd from Monday → Tuesday (same week)", () => {
    const out = addBusinessDays(MON, 1, TZ);
    expect(ymd(out)).toBe("2026-08-04");
  });

  it("adds 5 wd from Monday → next Monday (skips weekend)", () => {
    const out = addBusinessDays(MON, 5, TZ);
    expect(ymd(out)).toBe("2026-08-10");
  });

  it("adds 7 wd from Monday → next Wednesday (5+2 across one weekend)", () => {
    const out = addBusinessDays(MON, 7, TZ);
    expect(ymd(out)).toBe("2026-08-12");
  });

  it("adds 1 wd from Friday → next Monday (skips Sat/Sun)", () => {
    const out = addBusinessDays(FRI, 1, TZ);
    expect(ymd(out)).toBe("2026-08-10");
  });

  it("adds 1 wd from Saturday → Monday (skips Sunday)", () => {
    const out = addBusinessDays(SAT, 1, TZ);
    expect(ymd(out)).toBe("2026-08-10");
  });

  it("adds 0 wd returns end-of-day of the same date in tenant tz", () => {
    const out = addBusinessDays(MON, 0, TZ);
    expect(ymd(out)).toBe("2026-08-03");
    // 23:59:59.999 WIB = 16:59:59.999 UTC
    expect(out.toISOString()).toBe("2026-08-03T16:59:59.999Z");
  });

  it("supports negative n (subtract)", () => {
    const out = addBusinessDays(NEXT_MON, -5, TZ);
    expect(ymd(out)).toBe("2026-08-03");
  });

  it("throws on non-finite n", () => {
    expect(() => addBusinessDays(MON, Number.NaN, TZ)).toThrow();
    expect(() => addBusinessDays(MON, Number.POSITIVE_INFINITY, TZ)).toThrow();
  });
});

describe("business-days · diffBusinessDays", () => {
  it("same day → 0", () => {
    expect(diffBusinessDays(MON, MON, TZ)).toBe(0);
  });

  it("Mon → Fri (same week) = 4", () => {
    expect(diffBusinessDays(MON, FRI, TZ)).toBe(4);
  });

  it("Mon → next Mon = 5 (weekend skipped)", () => {
    expect(diffBusinessDays(MON, NEXT_MON, TZ)).toBe(5);
  });

  it("Fri → next Mon = 1 (Sat/Sun skipped)", () => {
    expect(diffBusinessDays(FRI, NEXT_MON, TZ)).toBe(1);
  });

  it("reverse direction → negative", () => {
    expect(diffBusinessDays(NEXT_MON, MON, TZ)).toBe(-5);
  });

  it("Sat → Sun → 0 (both non-business)", () => {
    expect(diffBusinessDays(SAT, SUN, TZ)).toBe(0);
  });

  it("Mon → Sat = 4 (Sat itself not counted)", () => {
    expect(diffBusinessDays(MON, SAT, TZ)).toBe(4);
  });
});

describe("business-days · businessDaysUntil", () => {
  it("delegates to diffBusinessDays with now → target", () => {
    expect(businessDaysUntil(FRI, MON, TZ)).toBe(4);
  });

  it("overdue targets return negative", () => {
    expect(businessDaysUntil(MON, FRI, TZ)).toBe(-4);
  });
});
