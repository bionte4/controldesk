import { describe, expect, it } from "vitest";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

import {
  DEFAULT_WORKING_CALENDAR,
  addBusinessHours,
  businessMinutesBetween,
  computeIssueSlaDueAt,
  issueSlaSnapshot,
  type WorkingCalendar,
} from "./sla";

// Helper — build a UTC Date that represents a specific wall-clock time in
// the DEFAULT_WORKING_CALENDAR timezone (Asia/Jakarta).
function jkt(iso: string): Date {
  // `iso` is e.g. "2026-08-05T10:30:00" (no Z) → interpret as Asia/Jakarta.
  return fromZonedTime(iso, DEFAULT_WORKING_CALENDAR.timezone);
}

function jktParts(d: Date): { day: string; hh: number; mm: number } {
  const z = toZonedTime(d, DEFAULT_WORKING_CALENDAR.timezone);
  return {
    day: `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, "0")}-${String(z.getDate()).padStart(2, "0")}`,
    hh: z.getHours(),
    mm: z.getMinutes(),
  };
}

describe("computeIssueSlaDueAt", () => {
  it("CRITICAL: 1 business hour from Wed 10:00 → Wed 11:00 same day (Asia/Jakarta)", () => {
    // 2026-08-05 is Wednesday.
    const start = jkt("2026-08-05T10:00:00");
    const due = computeIssueSlaDueAt(start, "CRITICAL");
    const p = jktParts(due);
    expect(p.day).toBe("2026-08-05");
    expect(p.hh).toBe(11);
    expect(p.mm).toBe(0);
  });

  it("HIGH: 4 business hours from Wed 14:00 → Thu 10:00 (jumps end-of-day)", () => {
    // Start 14:00, working window ends 17:00 → 3h consumed today,
    // 1h consumed tomorrow starting 09:00 → 10:00.
    const start = jkt("2026-08-05T14:00:00");
    const due = computeIssueSlaDueAt(start, "HIGH");
    const p = jktParts(due);
    expect(p.day).toBe("2026-08-06");
    expect(p.hh).toBe(10);
    expect(p.mm).toBe(0);
  });

  it("MEDIUM: 8 business hours starting at 09:00 on a work day = same-day EOB (17:00)", () => {
    const start = jkt("2026-08-05T09:00:00");
    const due = computeIssueSlaDueAt(start, "MEDIUM");
    const p = jktParts(due);
    expect(p.day).toBe("2026-08-05");
    expect(p.hh).toBe(17);
    expect(p.mm).toBe(0);
  });

  it("LOW: 24 business hours = 3 full working days at 09:00 → 17:00", () => {
    // 24h / 8h per day = 3 days. Start Mon 09:00 → due Wed 17:00.
    // 2026-08-03 = Monday.
    const start = jkt("2026-08-03T09:00:00");
    const due = computeIssueSlaDueAt(start, "LOW");
    const p = jktParts(due);
    expect(p.day).toBe("2026-08-05");
    expect(p.hh).toBe(17);
    expect(p.mm).toBe(0);
  });

  it("weekend snap: Friday 16:00 + HIGH (4h) → Monday 12:00", () => {
    // 2026-08-07 = Friday. 1h Fri (16-17), 3h Monday morning (09-12).
    const start = jkt("2026-08-07T16:00:00");
    const due = computeIssueSlaDueAt(start, "HIGH");
    const p = jktParts(due);
    // 2026-08-10 = Monday.
    expect(p.day).toBe("2026-08-10");
    expect(p.hh).toBe(12);
    expect(p.mm).toBe(0);
  });

  it("saturday snap forward: Sat 10:00 + CRITICAL (1h) → Mon 10:00", () => {
    // 2026-08-08 = Saturday. Nothing consumed until Mon 09:00; 1h → Mon 10:00.
    const start = jkt("2026-08-08T10:00:00");
    const due = computeIssueSlaDueAt(start, "CRITICAL");
    const p = jktParts(due);
    expect(p.day).toBe("2026-08-10");
    expect(p.hh).toBe(10);
    expect(p.mm).toBe(0);
  });

  it("pre-window snap: Wed 07:00 + CRITICAL → Wed 10:00", () => {
    // Before 09:00 → snap to 09:00, 1h → 10:00.
    const start = jkt("2026-08-05T07:00:00");
    const due = computeIssueSlaDueAt(start, "CRITICAL");
    const p = jktParts(due);
    expect(p.day).toBe("2026-08-05");
    expect(p.hh).toBe(10);
    expect(p.mm).toBe(0);
  });

  it("post-window snap: Wed 19:00 + CRITICAL → Thu 10:00", () => {
    // After 17:00 → snap to next day 09:00, 1h → 10:00.
    const start = jkt("2026-08-05T19:00:00");
    const due = computeIssueSlaDueAt(start, "CRITICAL");
    const p = jktParts(due);
    expect(p.day).toBe("2026-08-06");
    expect(p.hh).toBe(10);
    expect(p.mm).toBe(0);
  });

  it("fractional offset preserved: Wed 10:15 + CRITICAL → Wed 11:15", () => {
    const start = jkt("2026-08-05T10:15:00");
    const due = computeIssueSlaDueAt(start, "CRITICAL");
    const p = jktParts(due);
    expect(p.day).toBe("2026-08-05");
    expect(p.hh).toBe(11);
    expect(p.mm).toBe(15);
  });

  it("returns a UTC Date instance", () => {
    const due = computeIssueSlaDueAt(jkt("2026-08-05T10:00:00"), "CRITICAL");
    expect(due).toBeInstanceOf(Date);
    expect(Number.isFinite(due.getTime())).toBe(true);
  });
});

describe("addBusinessHours edge cases", () => {
  it("zero or negative hours returns the input unchanged", () => {
    const start = jkt("2026-08-05T10:00:00");
    expect(addBusinessHours(start, 0).getTime()).toBe(start.getTime());
    expect(addBusinessHours(start, -1).getTime()).toBe(start.getTime());
  });

  it("custom calendar (24/7) is respected", () => {
    const calendar: WorkingCalendar = {
      timezone: DEFAULT_WORKING_CALENDAR.timezone,
      workDays: [0, 1, 2, 3, 4, 5, 6],
      startHour: 0,
      endHour: 24,
    };
    // Sunday midnight + 4h → 04:00 same day (Sunday counts).
    const start = jkt("2026-08-09T00:00:00");
    const due = addBusinessHours(start, 4, calendar);
    const p = jktParts(due);
    expect(p.day).toBe("2026-08-09");
    expect(p.hh).toBe(4);
  });

  it("throws when startHour >= endHour (bogus calendar)", () => {
    const bad: WorkingCalendar = {
      timezone: DEFAULT_WORKING_CALENDAR.timezone,
      workDays: [1, 2, 3, 4, 5],
      startHour: 17,
      endHour: 9,
    };
    expect(() => addBusinessHours(jkt("2026-08-05T10:00:00"), 1, bad)).toThrow();
  });
});

describe("businessMinutesBetween", () => {
  it("same working window returns the wall-clock difference", () => {
    const from = jkt("2026-08-05T10:00:00");
    const to = jkt("2026-08-05T13:30:00");
    expect(businessMinutesBetween(from, to)).toBe(210);
  });

  it("crosses end-of-day, resumes next day at 09:00", () => {
    // 15:00 → 17:00 = 120 min today, 09:00 → 11:00 = 120 min tomorrow. Total 240.
    const from = jkt("2026-08-05T15:00:00");
    const to = jkt("2026-08-06T11:00:00");
    expect(businessMinutesBetween(from, to)).toBe(240);
  });

  it("weekend is not counted", () => {
    // Fri 16:00 → Mon 10:00 = 60 min Fri + 60 min Mon = 120 total.
    const from = jkt("2026-08-07T16:00:00");
    const to = jkt("2026-08-10T10:00:00");
    expect(businessMinutesBetween(from, to)).toBe(120);
  });

  it("returns 0 when both endpoints fall outside the working window on the same day", () => {
    const from = jkt("2026-08-05T18:00:00");
    const to = jkt("2026-08-05T20:00:00");
    // Both after 17:00 on the same work day → snap forward to Thu 09:00,
    // then measure. Snapped-from > to → 0.
    expect(businessMinutesBetween(from, to)).toBe(0);
  });

  it("negative when `to` is before `from`", () => {
    const from = jkt("2026-08-05T15:00:00");
    const to = jkt("2026-08-05T13:00:00");
    expect(businessMinutesBetween(from, to)).toBe(-120);
  });
});

describe("issueSlaSnapshot", () => {
  it("in-window, plenty of time → not breached, not at-risk", () => {
    const due = jkt("2026-08-05T15:00:00");
    const now = jkt("2026-08-05T10:00:00");
    const snap = issueSlaSnapshot(due, now);
    // 10:00 → 15:00 = 300 business min.
    expect(snap.remainingMinutes).toBe(300);
    expect(snap.breached).toBe(false);
    expect(snap.atRisk).toBe(false);
  });

  it("less than 1 business hour left → at-risk", () => {
    const due = jkt("2026-08-05T10:30:00");
    const now = jkt("2026-08-05T10:00:00");
    const snap = issueSlaSnapshot(due, now);
    expect(snap.remainingMinutes).toBe(30);
    expect(snap.atRisk).toBe(true);
    expect(snap.breached).toBe(false);
  });

  it("past due → breached", () => {
    const due = jkt("2026-08-05T10:00:00");
    const now = jkt("2026-08-05T13:00:00");
    const snap = issueSlaSnapshot(due, now);
    expect(snap.remainingMinutes).toBeLessThan(0);
    expect(snap.breached).toBe(true);
    expect(snap.atRisk).toBe(false);
  });
});
