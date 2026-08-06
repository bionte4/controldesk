/**
 * ControlDesk — Weekly Timesheet Zod schemas (GAS §27).
 *
 * The submit schema accepts the whole 7-day packet in one payload. The action
 * layer explodes it into upserts on `public.timesheets` + a header row on
 * `public.timesheet_weeks`. Approve / reject / resubmit share the header id.
 */

import { z } from "zod";

import { isoDateSchema, uuidSchema } from "./common";

// A single day's row inside the weekly grid. `hours_worked` + `hours_overtime`
// are numeric with 2-decimal precision; the DB enforces the 0..24 bound.
const dayEntrySchema = z.object({
  work_date: isoDateSchema,
  project_id: uuidSchema.optional().nullable(),
  hours_worked: z
    .number({ message: "Hours worked must be a number." })
    .min(0, "Hours worked must be ≥ 0.")
    .max(24, "Hours worked cannot exceed 24 per day.")
    .refine(
      (v) => Number((v * 100).toFixed(0)) / 100 === v,
      "Use at most 2 decimals for hours.",
    ),
  hours_overtime: z
    .number({ message: "Hours overtime must be a number." })
    .min(0, "Overtime must be ≥ 0.")
    .max(24, "Overtime cannot exceed 24 per day.")
    .refine(
      (v) => Number((v * 100).toFixed(0)) / 100 === v,
      "Use at most 2 decimals for hours.",
    ),
  notes: z.string().trim().max(500).optional().nullable(),
});

export type WeeklyDayEntryInput = z.infer<typeof dayEntrySchema>;

/**
 * Submit the whole week. `week_start_date` MUST be an ISO Monday (Server
 * Action re-verifies via `weekStartFromDate` for defence-in-depth). `days`
 * length must be 7, one entry per day starting at Monday.
 */
export const submitWeeklyTimesheetSchema = z
  .object({
    employee_id: uuidSchema,
    week_start_date: isoDateSchema,
    days: z
      .array(dayEntrySchema)
      .length(7, "A weekly packet must include exactly 7 daily entries."),
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .superRefine((input, ctx) => {
    // Days must be Mon..Sun starting at week_start_date and unique.
    const seen = new Set<string>();
    for (let i = 0; i < input.days.length; i += 1) {
      const expected = addDays(input.week_start_date, i);
      const actual = input.days[i].work_date;
      if (actual !== expected) {
        ctx.addIssue({
          code: "custom",
          path: ["days", i, "work_date"],
          message: `Expected ${expected} at position ${i}, got ${actual}.`,
        });
      }
      if (seen.has(actual)) {
        ctx.addIssue({
          code: "custom",
          path: ["days", i, "work_date"],
          message: `Duplicate day ${actual}.`,
        });
      }
      seen.add(actual);
    }
  });

export type SubmitWeeklyTimesheetInput = z.infer<
  typeof submitWeeklyTimesheetSchema
>;

export const approveWeeklyTimesheetSchema = z.object({
  id: uuidSchema,
  comment: z.string().trim().max(500).optional().nullable(),
});
export type ApproveWeeklyTimesheetInput = z.infer<
  typeof approveWeeklyTimesheetSchema
>;

export const rejectWeeklyTimesheetSchema = z.object({
  id: uuidSchema,
  reason: z
    .string()
    .trim()
    .min(
      10,
      "Rejection reason must be at least 10 characters so the requester can fix the packet.",
    )
    .max(500),
});
export type RejectWeeklyTimesheetInput = z.infer<
  typeof rejectWeeklyTimesheetSchema
>;

// ---------------------------------------------------------------------------
// Internal date helper (kept private to avoid a circular dep with week-state).
// ---------------------------------------------------------------------------
function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
