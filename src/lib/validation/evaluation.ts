import { z } from "zod";

import { uuidSchema } from "./common";

/**
 * Zod schemas for performance evaluations (migration 0059).
 *
 * Workflow: SPV drafts → SUBMITTED_BY_SPV → PM reviews → REVIEWED_BY_PM
 * → OM decides → APPROVED_BY_OM / REJECTED_BY_OM. Optional loop back
 * via RETURNED_TO_SPV for coaching. Finalized rows can spawn a UPK
 * note when the SPV recommendation is NOT_EXTEND and OM approves.
 */

export const EVALUATION_STATUSES = [
  "DRAFT",
  "SUBMITTED_BY_SPV",
  "REVIEWED_BY_PM",
  "RETURNED_TO_SPV",
  "APPROVED_BY_OM",
  "REJECTED_BY_OM",
  "FINALIZED",
] as const;
export const evaluationStatusSchema = z.enum(EVALUATION_STATUSES);
export type EvaluationStatus = z.infer<typeof evaluationStatusSchema>;

/**
 * `CONTRACT_RECOMMENDATIONS`
 *
 * PKWT form kesimpulan (§0063):
 *   - `EXTEND_PERMANENT` → "Direkomendasikan untuk diangkat sebagai karyawan tetap"
 *   - `EXTEND_PKWT_3M`   → "Diperpanjang masa PKWT-nya selama 3 bulan"
 *   - `NOT_EXTEND`       → "Tidak direkomendasikan / diterminasi"
 *
 * Legacy values (`EXTEND`, `EXTEND_WITH_COACHING`) are kept in the enum
 * for backwards compatibility with rows written before 0063; new UI
 * paths surface only the three canonical labels above.
 */
export const CONTRACT_RECOMMENDATIONS = [
  "EXTEND",
  "EXTEND_PERMANENT",
  "EXTEND_PKWT_3M",
  "EXTEND_WITH_COACHING",
  "NOT_EXTEND",
] as const;
export const contractRecommendationSchema = z.enum(CONTRACT_RECOMMENDATIONS);
export type ContractRecommendation = z.infer<
  typeof contractRecommendationSchema
>;

/**
 * Semantic canonicalization for legacy rows — maps every historical
 * value to the simplified 2-option display set introduced in 0065:
 *   * `EXTEND`     → kontrak diperpanjang (durasi di
 *                    `contract_extension_months`)
 *   * `NOT_EXTEND` → tidak diperpanjang
 *
 * Old PKWT values still round-trip: `EXTEND_PERMANENT` and
 * `EXTEND_PKWT_3M` both collapse to `EXTEND` for the current UI. The
 * legacy `EXTEND_WITH_COACHING` also maps to `EXTEND` so historical
 * timelines stay readable.
 */
export function canonicalRecommendation(
  v: ContractRecommendation,
): "EXTEND" | "NOT_EXTEND" {
  if (v === "NOT_EXTEND") return "NOT_EXTEND";
  return "EXTEND";
}

export const QUESTION_TYPES = ["SCORE_1_5", "TEXT"] as const;
export const questionTypeSchema = z.enum(QUESTION_TYPES);
export type QuestionType = z.infer<typeof questionTypeSchema>;

// ---------------------------------------------------------------------
// Template management (HR / Admin).
// ---------------------------------------------------------------------
export const createEvaluationTemplateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => (v ? v : undefined)),
  items: z
    .array(
      z.object({
        seq: z.number().int().min(1),
        name: z.string().trim().min(1).max(240),
        description: z
          .string()
          .trim()
          .max(1000)
          .optional()
          .transform((v) => (v ? v : undefined)),
        weight_pct: z.number().min(0).max(100),
        question_type: questionTypeSchema.default("SCORE_1_5"),
        is_required: z.boolean().default(true),
      }),
    )
    .min(1, "At least one item is required.")
    .max(50, "Templates can have at most 50 items."),
});
export type CreateEvaluationTemplateInput = z.infer<
  typeof createEvaluationTemplateSchema
>;

export const updateEvaluationTemplateSchema =
  createEvaluationTemplateSchema.extend({ id: uuidSchema });
export type UpdateEvaluationTemplateInput = z.infer<
  typeof updateEvaluationTemplateSchema
>;

export const toggleEvaluationTemplateActiveSchema = z.object({
  id: uuidSchema,
  is_active: z.boolean(),
});

// ---------------------------------------------------------------------
// Evaluation workflow.
// ---------------------------------------------------------------------

/**
 * SPV starts a new evaluation for a specific employee. Only allowed
 * when the employee is non-permanent (CONTRACT / PROBATION / INTERN /
 * OUTSOURCE) and has a `contract_end_date` set. PM + OM references
 * are optional at draft time — SPV may pick them later or the action
 * infers them from `employees.reports_to_employee_id`.
 */
export const startEvaluationSchema = z.object({
  employee_id: uuidSchema,
  template_id: uuidSchema,
  pm_employee_id: uuidSchema.optional(),
  om_employee_id: uuidSchema.optional(),
  // Optional project context (migration 0089). When set, SPV picked a
  // specific project the employee is actively assigned to; the action
  // verifies membership + auto-suggests `project_reviewer_employee_id`
  // from the project's PRIMARY_PM. Both are nullable so evaluations
  // without a project context keep working exactly like before.
  project_id: uuidSchema.optional(),
  project_reviewer_employee_id: uuidSchema.optional(),
  // PKWT alignment (migration 0062). Both dates are optional at draft
  // time — SPV may fill them mid-cycle. If provided, `end` must be
  // strictly >= `start` (enforced via refine below).
  period_start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
    .optional(),
  period_end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
    .optional(),
}).refine(
  (v) =>
    !v.period_start_date ||
    !v.period_end_date ||
    v.period_end_date >= v.period_start_date,
  {
    path: ["period_end_date"],
    message: "period_end_date must be on or after period_start_date.",
  },
);
export type StartEvaluationInput = z.infer<typeof startEvaluationSchema>;

/**
 * SPV upserts one answer at a time (typical form UX — save on blur).
 * Numeric score is required when the linked item is SCORE_1_5, and
 * text answer required when TEXT. Validated at the action layer
 * because the required-ness depends on the template item's type.
 */
export const upsertEvaluationAnswerSchema = z.object({
  evaluation_id: uuidSchema,
  item_id: uuidSchema,
  numeric_score: z.number().int().min(1).max(5).nullable().optional(),
  text_answer: z
    .string()
    .trim()
    .max(4000)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v)),
});
export type UpsertEvaluationAnswerInput = z.infer<
  typeof upsertEvaluationAnswerSchema
>;

/**
 * SPV updates evaluation-level metadata that isn't tied to a single
 * answer — evaluation period, PKWT narratives (strengths / dev-areas /
 * dev-proposal), and manually-entered goal / competency percentages.
 *
 * Kept separate from `startEvaluationSchema` because these often land
 * later in the cycle — after the SPV has collected observations and
 * pulled the goal/competency numbers from HC Cloud.
 */
export const updateEvaluationMetaSchema = z
  .object({
    id: uuidSchema,
    period_start_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
      .nullable()
      .optional(),
    period_end_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
      .nullable()
      .optional(),
    strengths: z
      .string()
      .trim()
      .max(4000)
      .nullable()
      .optional()
      .transform((v) => (v === "" ? null : v)),
    dev_areas: z
      .string()
      .trim()
      .max(4000)
      .nullable()
      .optional()
      .transform((v) => (v === "" ? null : v)),
    dev_proposal: z
      .string()
      .trim()
      .max(4000)
      .nullable()
      .optional()
      .transform((v) => (v === "" ? null : v)),
    goal_achievement_pct: z
      .number()
      .min(0)
      .max(100)
      .nullable()
      .optional(),
    competency_meet_pct: z
      .number()
      .min(0)
      .max(100)
      .nullable()
      .optional(),
    // "Penilaian Akhir / Keputusan Pengangkatan" flag (migration 0063).
    // When true the UI surfaces the kesimpulan card + expanded 3-opsi
    // recommendation dropdown; server-side we treat it as pure
    // metadata (no chain change).
    is_final_period: z.boolean().optional(),
  })
  .refine(
    (v) =>
      !v.period_start_date ||
      !v.period_end_date ||
      v.period_end_date >= v.period_start_date,
    {
      path: ["period_end_date"],
      message: "period_end_date must be on or after period_start_date.",
    },
  );
export type UpdateEvaluationMetaInput = z.infer<
  typeof updateEvaluationMetaSchema
>;

/**
 * SPV submits the completed evaluation with a hiring recommendation.
 * All required items must have answers (enforced action-side) —
 * SCORE_1_5 items require both `numeric_score` AND a comment
 * (`text_answer`) per the PKWT form convention.
 *
 * When `spv_recommendation === "EXTEND"`, `contract_extension_end_date`
 * is required and the SPV enters it manually (free-form date picker,
 * validated action-side to be strictly after the current
 * `contract_end_date`). The server derives
 * `contract_extension_months` from the date delta for reporting only.
 * For `NOT_EXTEND` both fields must be omitted / null.
 *
 * Legacy `EXTEND_PERMANENT` / `EXTEND_PKWT_3M` values are still
 * accepted for backward compat with rows written pre-0065, but the
 * new UI only writes `EXTEND` or `NOT_EXTEND`.
 */
export const submitEvaluationBySpvSchema = z
  .object({
    id: uuidSchema,
    spv_recommendation: contractRecommendationSchema,
    contract_extension_end_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD.")
      .nullable()
      .optional(),
    spv_notes: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine(
    (v) =>
      v.spv_recommendation !== "EXTEND" ||
      (v.contract_extension_end_date !== null &&
        v.contract_extension_end_date !== undefined &&
        v.contract_extension_end_date.length > 0),
    {
      path: ["contract_extension_end_date"],
      message: "Isi tanggal akhir kontrak baru.",
    },
  )
  .refine(
    (v) =>
      v.spv_recommendation !== "NOT_EXTEND" ||
      v.contract_extension_end_date === null ||
      v.contract_extension_end_date === undefined ||
      v.contract_extension_end_date.length === 0,
    {
      path: ["contract_extension_end_date"],
      message:
        "Tanggal perpanjangan tidak boleh diisi ketika Tidak diperpanjang.",
    },
  );
export type SubmitEvaluationBySpvInput = z.infer<
  typeof submitEvaluationBySpvSchema
>;

/**
 * Best-effort helper — approximate the number of whole months between
 * the original contract end date and the SPV-entered extension end
 * date. Used purely for display (e.g. `+3 bln → 2026-04-30`) so we
 * never surface a fractional month to the user. Returns `null` when
 * either input is missing or when the extension date is not strictly
 * after the original end.
 */
export function deriveExtensionMonths(
  originalEndDate: string | null | undefined,
  newEndDate: string | null | undefined,
): number | null {
  if (!originalEndDate || !newEndDate) return null;
  const a = new Date(originalEndDate);
  const b = new Date(newEndDate);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  if (b.getTime() <= a.getTime()) return null;
  // Nominal calendar-month delta plus day-of-month remainder rounded
  // up so "+30 days" is displayed as "+1 bln", "+45 days" as "+2 bln".
  const monthDelta =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth());
  const dayDelta = b.getUTCDate() - a.getUTCDate();
  return dayDelta > 0 ? monthDelta + 1 : Math.max(monthDelta, 1);
}

/**
 * PM review — either accept and forward to OM, or return to SPV for
 * coaching. `pm_notes` is required for RETURNED_TO_SPV so the SPV
 * knows what to adjust.
 */
export const reviewEvaluationByPmSchema = z
  .object({
    id: uuidSchema,
    decision: z.enum(["APPROVE", "RETURN"]),
    pm_notes: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine(
    (v) =>
      v.decision !== "RETURN" ||
      (v.pm_notes !== undefined && v.pm_notes.length > 0),
    {
      path: ["pm_notes"],
      message:
        "Coaching notes are required when returning the evaluation to SPV.",
    },
  );
export type ReviewEvaluationByPmInput = z.infer<
  typeof reviewEvaluationByPmSchema
>;

/**
 * OM final decision. On APPROVE the row moves to APPROVED_BY_OM and
 * FINALIZED in the same transaction. On REJECT the row is terminal
 * (REJECTED_BY_OM) — SPV cannot re-open, HR must file a new one.
 */
export const decideEvaluationByOmSchema = z
  .object({
    id: uuidSchema,
    decision: z.enum(["APPROVE", "REJECT"]),
    om_notes: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine(
    (v) =>
      v.decision !== "REJECT" ||
      (v.om_notes !== undefined && v.om_notes.length > 0),
    {
      path: ["om_notes"],
      message: "Notes are required when rejecting the evaluation.",
    },
  );
export type DecideEvaluationByOmInput = z.infer<
  typeof decideEvaluationByOmSchema
>;

/**
 * Project reviewer notes submission (migration 0089).
 *
 * Only the employee referenced by `project_reviewer_employee_id` on
 * the evaluation may call this — validated action-side. The reviewer
 * may submit + edit notes any time before OM decides (statuses
 * DRAFT / SUBMITTED_BY_SPV / REVIEWED_BY_PM / RETURNED_TO_SPV); once
 * the evaluation reaches APPROVED_BY_OM / REJECTED_BY_OM / FINALIZED
 * the notes lock.
 */
export const submitProjectReviewerNotesSchema = z.object({
  id: uuidSchema,
  project_reviewer_notes: z
    .string()
    .trim()
    .min(1, "Isi catatan proyek reviewer.")
    .max(4000),
});
export type SubmitProjectReviewerNotesInput = z.infer<
  typeof submitProjectReviewerNotesSchema
>;
