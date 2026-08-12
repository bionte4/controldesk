import { z } from "zod";

import { uuidSchema } from "./common";

/**
 * Zod schemas for monthly reports (rules §26). Slice A only —
 * SPV draft + PM approval. Later slices add client sign-off, BA
 * generation, and collection handoff.
 */

export const MONTHLY_REPORT_STATUSES = [
  "DRAFT_BY_SPV",
  "SUBMITTED_TO_PM",
  "APPROVED_BY_PM",
  "RETURNED_TO_SPV",
  "REJECTED_BY_PM",
  "SENT_TO_CLIENT",
  "APPROVED_BY_CLIENT",
  "BA_GENERATED",
  "HANDED_OFF_TO_COLLECTION",
  "CANCELLED",
] as const;
export const monthlyReportStatusSchema = z.enum(MONTHLY_REPORT_STATUSES);
export type MonthlyReportStatus = z.infer<typeof monthlyReportStatusSchema>;

export const MONTHLY_REPORT_SECTION_KINDS = [
  "EXECUTIVE_SUMMARY",
  "MILESTONE_PROGRESS",
  "HOURS_LOGGED",
  "COSTS_INCURRED",
  "BLOCKERS",
  "NEXT_MONTH_PLAN",
] as const;
export const monthlyReportSectionKindSchema = z.enum(
  MONTHLY_REPORT_SECTION_KINDS,
);
export type MonthlyReportSectionKind = z.infer<
  typeof monthlyReportSectionKindSchema
>;

/**
 * Period is stored as `YYYY-MM-01` at rest. Zod validates the raw
 * `YYYY-MM` input (from the UI) and normalises to the first-of-month
 * ISO date inside the server action.
 */
const yearMonthSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Format YYYY-MM.");

export const createMonthlyReportSchema = z.object({
  project_id: uuidSchema,
  period_month: yearMonthSchema,
});
export type CreateMonthlyReportInput = z.infer<
  typeof createMonthlyReportSchema
>;

export const upsertMonthlyReportSectionSchema = z.object({
  report_id: uuidSchema,
  kind: monthlyReportSectionKindSchema,
  content: z
    .string()
    .trim()
    .max(8000)
    .optional()
    .transform((v) => (v ? v : undefined)),
  // Server can pass a pre-computed snapshot (hours, costs, milestones)
  // that will be persisted verbatim into `metrics` jsonb.
  metrics: z.record(z.string(), z.unknown()).optional(),
});
export type UpsertMonthlyReportSectionInput = z.infer<
  typeof upsertMonthlyReportSectionSchema
>;

export const submitMonthlyReportSchema = z.object({
  id: uuidSchema,
  spv_notes: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type SubmitMonthlyReportInput = z.infer<
  typeof submitMonthlyReportSchema
>;

export const decideMonthlyReportByPmSchema = z
  .object({
    id: uuidSchema,
    decision: z.enum(["APPROVE", "RETURN", "REJECT"]),
    pm_notes: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine(
    (v) =>
      v.decision === "APPROVE" ||
      (v.pm_notes !== undefined && v.pm_notes.length > 0),
    {
      path: ["pm_notes"],
      message:
        "Notes are required when returning or rejecting a monthly report.",
    },
  );
export type DecideMonthlyReportByPmInput = z.infer<
  typeof decideMonthlyReportByPmSchema
>;

export const cancelMonthlyReportSchema = z.object({ id: uuidSchema });

// ---------------------------------------------------------------------
// Slice B — client sign-off + Berita Acara.
// ---------------------------------------------------------------------

/**
 * PM dispatches the approved report to the client. `client_email` is
 * optional at this step — some tenants send via WhatsApp / print — we
 * only record it for future auto-email hooks.
 */
export const sendMonthlyReportToClientSchema = z.object({
  id: uuidSchema,
  client_email: z
    .string()
    .trim()
    .email("Format email tidak valid.")
    .optional()
    .transform((v) => (v ? v : undefined)),
  send_notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type SendMonthlyReportToClientInput = z.infer<
  typeof sendMonthlyReportToClientSchema
>;

/**
 * PM records the client's decision after receiving feedback out-of-band
 * (email, WhatsApp, phone call). On APPROVE the report moves to
 * `APPROVED_BY_CLIENT`; on REJECT it loops back to `APPROVED_BY_PM`
 * so PM can revise / resend without reopening the SPV draft. Notes
 * are required on reject so the PM captures what the client asked
 * for.
 *
 * `client_signature_path` is a Supabase Storage path — the actual
 * upload happens in a separate action-driven flow before this schema
 * is invoked. Kept as a plain string so the caller can pass either a
 * freshly-uploaded path or leave it null for verbal approvals.
 */
export const recordClientDecisionSchema = z
  .object({
    id: uuidSchema,
    decision: z.enum(["APPROVE", "REJECT"]),
    reviewer_name: z.string().trim().min(1).max(160),
    reviewer_email: z
      .string()
      .trim()
      .email("Format email tidak valid.")
      .optional()
      .transform((v) => (v ? v : undefined)),
    decided_at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
      .optional(),
    notes: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .transform((v) => (v ? v : undefined)),
    signature_path: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .optional()
      .transform((v) => (v === "" ? null : v)),
    signature_file_name: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional()
      .transform((v) => (v === "" ? null : v)),
  })
  .refine(
    (v) =>
      v.decision !== "REJECT" ||
      (v.notes !== undefined && v.notes.length > 0),
    {
      path: ["notes"],
      message: "Notes are required when recording a client rejection.",
    },
  );
export type RecordClientDecisionInput = z.infer<
  typeof recordClientDecisionSchema
>;

/**
 * Generate the Berita Acara after client approval. Period fields
 * default to the report's `period_month` on the server side when the
 * client hasn't overridden them. `ba_number` is generated server-side
 * via `public.next_ba_number()` — never accepted from the client.
 */
export const generateBeritaAcaraSchema = z
  .object({
    id: uuidSchema,
    period_start: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
      .optional(),
    period_end: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
      .optional(),
    ba_notes: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine(
    (v) =>
      !v.period_start ||
      !v.period_end ||
      v.period_end >= v.period_start,
    {
      path: ["period_end"],
      message: "period_end must be on or after period_start.",
    },
  );
export type GenerateBeritaAcaraInput = z.infer<
  typeof generateBeritaAcaraSchema
>;

/**
 * Convert `YYYY-MM` from the UI into `YYYY-MM-01` (first of that
 * month, UTC) for DB storage. Kept as a pure helper so both the
 * action and unit tests can pin the transformation.
 */
export function periodMonthToDbDate(periodMonth: string): string {
  return `${periodMonth}-01`;
}
