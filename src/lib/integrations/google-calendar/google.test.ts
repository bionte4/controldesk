import { describe, expect, it } from "vitest";

import { __internals } from "./google";
import type { CalendarEventDispatch } from "./types";

const { buildGoogleEvent, addOneDayIso, extractHttpCode } = __internals;

function dispatch(
  overrides: Partial<CalendarEventDispatch> = {},
): CalendarEventDispatch {
  return {
    tenantId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    eventId: "outbox-1",
    kind: "PROJECT_CREATED",
    calendarId: "primary",
    googleEventId: null,
    project: {
      id: "11111111-1111-4111-1111-111111111111",
      number: "PRJ-2026-0001",
      name: "Payroll Migration",
      description: "Move payroll off legacy vendor.",
      startDate: "2026-08-01",
      endDate: "2026-12-31",
      location: "Jakarta HQ",
    },
    milestone: null,
    ...overrides,
  };
}

describe("addOneDayIso", () => {
  it("returns YYYY-MM-DD advanced by one calendar day (UTC-anchored)", () => {
    // Guards against off-by-one during Google all-day event end dates,
    // which are inclusive of the *day before* the `end.date` field.
    expect(addOneDayIso("2026-01-01")).toBe("2026-01-02");
    expect(addOneDayIso("2026-12-31")).toBe("2027-01-01");
    // Leap year boundary — 2028 is a leap year.
    expect(addOneDayIso("2028-02-28")).toBe("2028-02-29");
    expect(addOneDayIso("2028-02-29")).toBe("2028-03-01");
  });
});

describe("buildGoogleEvent — project scope", () => {
  it("builds an all-day event spanning start..end+1 for PROJECT_CREATED", () => {
    const evt = buildGoogleEvent(dispatch());
    expect(evt).not.toBe("skip-no-date");
    if (evt === "skip-no-date") throw new Error("unreachable");
    expect(evt.summary).toBe("[Project] PRJ-2026-0001 — Payroll Migration");
    expect(evt.start).toEqual({ date: "2026-08-01" });
    expect(evt.end).toEqual({ date: "2027-01-01" });
    expect(evt.location).toBe("Jakarta HQ");
    expect(evt.extendedProperties.private.controldesk_kind).toBe("PROJECT_CREATED");
    expect(evt.extendedProperties.private.controldesk_project_id).toBe(
      "11111111-1111-4111-1111-111111111111",
    );
    expect(evt.extendedProperties.private.controldesk_milestone_id).toBeUndefined();
  });

  it("falls back to endDate when startDate is null", () => {
    const evt = buildGoogleEvent(
      dispatch({
        project: {
          ...dispatch().project,
          startDate: null,
          endDate: "2026-06-30",
        },
      }),
    );
    if (evt === "skip-no-date") throw new Error("unreachable");
    expect(evt.start).toEqual({ date: "2026-06-30" });
    expect(evt.end).toEqual({ date: "2026-07-01" });
  });

  it("returns skip-no-date when both dates are null", () => {
    // Rationale: a project with no timeline is not calendar-worthy.
    // Marking these SKIPPED at drain time prevents empty events polluting
    // the tenant calendar.
    const evt = buildGoogleEvent(
      dispatch({
        project: {
          ...dispatch().project,
          startDate: null,
          endDate: null,
        },
      }),
    );
    expect(evt).toBe("skip-no-date");
  });

  it("does not set location when project.location is null (Google rejects undefined location as a string)", () => {
    const evt = buildGoogleEvent(
      dispatch({ project: { ...dispatch().project, location: null } }),
    );
    if (evt === "skip-no-date") throw new Error("unreachable");
    expect(evt.location).toBeUndefined();
  });
});

describe("buildGoogleEvent — milestone scope", () => {
  it("builds a single-day event on milestone.dueDate for MILESTONE_CREATED", () => {
    const evt = buildGoogleEvent(
      dispatch({
        kind: "MILESTONE_CREATED",
        milestone: {
          id: "mmmm3333-mmmm-4mmm-mmmm-mmmmmmmmmmmm",
          name: "Cutover to new payroll vendor",
          dueDate: "2026-10-15",
        },
      }),
    );
    if (evt === "skip-no-date") throw new Error("unreachable");
    expect(evt.summary).toBe(
      "[Milestone] PRJ-2026-0001 — Cutover to new payroll vendor",
    );
    expect(evt.start).toEqual({ date: "2026-10-15" });
    // Single-day event → end is next day (Google all-day end is exclusive).
    expect(evt.end).toEqual({ date: "2026-10-16" });
    expect(evt.extendedProperties.private.controldesk_milestone_id).toBe(
      "mmmm3333-mmmm-4mmm-mmmm-mmmmmmmmmmmm",
    );
    expect(evt.extendedProperties.private.controldesk_kind).toBe("MILESTONE_CREATED");
  });

  it("returns skip-no-date when milestone.dueDate is null", () => {
    const evt = buildGoogleEvent(
      dispatch({
        kind: "MILESTONE_UPDATED",
        milestone: {
          id: "mmmm3333-mmmm-4mmm-mmmm-mmmmmmmmmmmm",
          name: "TBD",
          dueDate: null,
        },
      }),
    );
    expect(evt).toBe("skip-no-date");
  });
});

describe("extractHttpCode", () => {
  it("reads numeric `code` on the error object (googleapis top-level shape)", () => {
    expect(extractHttpCode({ code: 429, message: "Rate limited" })).toBe(429);
    expect(extractHttpCode({ code: 503 })).toBe(503);
  });

  it("coerces numeric-string `code` to a number", () => {
    expect(extractHttpCode({ code: "500" })).toBe(500);
  });

  it("falls back to response.status (axios / gaxios shape)", () => {
    expect(extractHttpCode({ response: { status: 404 } })).toBe(404);
  });

  it("returns null when no recognizable code is present", () => {
    expect(extractHttpCode({})).toBeNull();
    expect(extractHttpCode(new Error("network broken"))).toBeNull();
    expect(extractHttpCode(undefined)).toBeNull();
    expect(extractHttpCode(null)).toBeNull();
  });
});
