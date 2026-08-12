/**
 * ControlDesk — Business-hours SLA calculator (Fase 2, rules §26).
 *
 * Rules §26 requires SLA computed against BUSINESS hours, not wall-clock:
 *   Critical  1h   High  4h   Medium  8h   Low  24h
 *
 * Default working calendar:
 *   - Days:  Monday – Friday  (weekend excluded)
 *   - Hours: 09:00 – 17:00 (8 business hours / day) in tenant timezone
 *   - Timezone: `Asia/Jakarta` (rules §18)
 *
 * The calendar is a *pure function* input so tenants can override it later
 * (via `tenants.working_calendar` when the schema lands). No external service
 * calls — everything is deterministic given (`startedAt`, `severity`,
 * `calendar`).
 *
 * KEY GUARANTEES:
 *   1. Return value is always a UTC `Date` (safe to store in `timestamptz`).
 *   2. Input `startedAt` outside the working window is *snapped forward* to
 *      the next window opening before consumption begins.
 *   3. Weekends (Saturday=6, Sunday=0) are skipped entirely.
 *   4. Fractional business hours (Critical 1h + a 15 min offset) are
 *      handled correctly to the minute.
 */

import { toZonedTime, fromZonedTime } from "date-fns-tz";

import { ISSUE_SLA_HOURS_BUSINESS } from "./state";
import { DEFAULT_TIMEZONE } from "@/lib/format/date";
import type { ProjectIssueSeverity } from "@/types/database";

// ---------------------------------------------------------------------------
// Calendar model.
// ---------------------------------------------------------------------------

/** 0=Sunday … 6=Saturday. Same convention as `Date.prototype.getDay()`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type WorkingCalendar = {
  timezone: string;
  /** Business-day weekdays (default Mon-Fri). */
  workDays: readonly Weekday[];
  /** Work-window start hour in local time [0..23]. */
  startHour: number;
  /** Work-window end hour in local time (exclusive) [1..24]. */
  endHour: number;
};

export const DEFAULT_WORKING_CALENDAR: WorkingCalendar = {
  timezone: DEFAULT_TIMEZONE,
  workDays: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 17,
};

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * Compute the SLA due date for an issue of the given severity that was
 * opened at `startedAt`. Returns a UTC `Date` suitable for `timestamptz`.
 */
export function computeIssueSlaDueAt(
  startedAt: Date,
  severity: ProjectIssueSeverity,
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): Date {
  const hours = ISSUE_SLA_HOURS_BUSINESS[severity];
  return addBusinessHours(startedAt, hours, calendar);
}

/**
 * Add `hours` of BUSINESS time to `startedAt`. Consumes only minutes that
 * fall inside a working window; skips weekends + non-working days.
 */
export function addBusinessHours(
  startedAt: Date,
  hours: number,
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): Date {
  if (!Number.isFinite(hours) || hours <= 0) {
    return startedAt;
  }
  const dailyMinutes = (calendar.endHour - calendar.startHour) * 60;
  if (dailyMinutes <= 0) {
    throw new Error(
      `Invalid working calendar: startHour=${calendar.startHour} >= endHour=${calendar.endHour}`,
    );
  }

  let remainingMinutes = Math.round(hours * 60);
  let cursor = snapToNextWorkingMinute(startedAt, calendar);

  while (remainingMinutes > 0) {
    const localCursor = toZonedTime(cursor, calendar.timezone);
    const endOfWindow = setLocalTime(
      localCursor,
      calendar.endHour,
      0,
      0,
      calendar.timezone,
    );
    const minutesLeftInWindow = Math.floor(
      (endOfWindow.getTime() - cursor.getTime()) / 60000,
    );

    if (remainingMinutes <= minutesLeftInWindow) {
      return new Date(cursor.getTime() + remainingMinutes * 60000);
    }

    remainingMinutes -= minutesLeftInWindow;
    // Jump to the start of the next working day.
    cursor = snapToNextWorkingMinute(
      new Date(endOfWindow.getTime() + 60000),
      calendar,
    );
  }

  return cursor;
}

/**
 * Convenience: how many business MINUTES have elapsed between `from` and
 * `to`. Negative if `to` is before `from`.
 */
export function businessMinutesBetween(
  from: Date,
  to: Date,
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): number {
  if (to.getTime() < from.getTime()) {
    return -businessMinutesBetween(to, from, calendar);
  }
  let cursor = snapToNextWorkingMinute(from, calendar);
  if (cursor.getTime() >= to.getTime()) return 0;

  let minutes = 0;
  while (cursor.getTime() < to.getTime()) {
    const localCursor = toZonedTime(cursor, calendar.timezone);
    const endOfWindow = setLocalTime(
      localCursor,
      calendar.endHour,
      0,
      0,
      calendar.timezone,
    );
    const windowEndOrTarget = Math.min(endOfWindow.getTime(), to.getTime());
    minutes += Math.max(
      0,
      Math.floor((windowEndOrTarget - cursor.getTime()) / 60000),
    );
    if (windowEndOrTarget >= to.getTime()) break;
    cursor = snapToNextWorkingMinute(
      new Date(endOfWindow.getTime() + 60000),
      calendar,
    );
  }
  return minutes;
}

/**
 * SLA status snapshot. Useful for badge tone + KPI cards.
 *   `remainingMinutes < 0` → breached.
 *   0 ≤ remainingMinutes ≤ 60 → "at risk" (< 1 business hour left).
 */
export type IssueSlaSnapshot = {
  slaDueAt: Date;
  now: Date;
  remainingMinutes: number;
  breached: boolean;
  atRisk: boolean;
};

export function issueSlaSnapshot(
  slaDueAt: Date,
  now: Date = new Date(),
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): IssueSlaSnapshot {
  const remainingMinutes = businessMinutesBetween(now, slaDueAt, calendar);
  return {
    slaDueAt,
    now,
    remainingMinutes,
    breached: remainingMinutes < 0,
    atRisk: remainingMinutes >= 0 && remainingMinutes <= 60,
  };
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

function isWorkDay(local: Date, calendar: WorkingCalendar): boolean {
  return calendar.workDays.includes(local.getDay() as Weekday);
}

/**
 * If `d` is already inside a working window on a work day, return it.
 * Otherwise return the UTC instant of the next window opening.
 */
function snapToNextWorkingMinute(d: Date, calendar: WorkingCalendar): Date {
  let cursor = d;
  // Guard against infinite loop if calendar has no work days.
  if (calendar.workDays.length === 0) return d;

  for (let i = 0; i < 8; i++) {
    const local = toZonedTime(cursor, calendar.timezone);
    if (isWorkDay(local, calendar)) {
      const hour = local.getHours();
      const min = local.getMinutes();
      const startMin = calendar.startHour * 60;
      const endMin = calendar.endHour * 60;
      const curMin = hour * 60 + min;

      if (curMin < startMin) {
        return setLocalTime(local, calendar.startHour, 0, 0, calendar.timezone);
      }
      if (curMin >= endMin) {
        // roll into next calendar day at start
        const nextDay = new Date(local);
        nextDay.setDate(nextDay.getDate() + 1);
        nextDay.setHours(calendar.startHour, 0, 0, 0);
        cursor = fromZonedTime(nextDay, calendar.timezone);
        continue;
      }
      return cursor;
    }
    // non-work day → advance to next day at window start
    const nextDay = new Date(local);
    nextDay.setDate(nextDay.getDate() + 1);
    nextDay.setHours(calendar.startHour, 0, 0, 0);
    cursor = fromZonedTime(nextDay, calendar.timezone);
  }
  return cursor;
}

/** Build a UTC `Date` for a specific wall-clock time in `timezone` on the
 * same local calendar day as `localDate`. */
function setLocalTime(
  localDate: Date,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): Date {
  const target = new Date(localDate);
  target.setHours(hour, minute, second, 0);
  return fromZonedTime(target, timezone);
}
