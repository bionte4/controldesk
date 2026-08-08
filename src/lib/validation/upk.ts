import { z } from "zod";

import { uuidSchema } from "./common";

/**
 * Zod schemas for UPK (Uang Penghentian Kontrak / severance) draft
 * notes. Migration 0060. Chain: PM draft → Finance approve →
 * Director approve (if ≥ 50M) → Paid. Auto-stub created when a
 * performance evaluation finalizes with NOT_EXTEND recommendation.
 */

export const UPK_STATUSES = [
  "DRAFT",
  "PENDING_FINANCE",
  "PENDING_DIRECTOR",
  "APPROVED",
  "REJECTED_BY_FINANCE",
  "REJECTED_BY_DIRECTOR",
  "PAID",
  "CANCELLED",
] as const;
export const upkStatusSchema = z.enum(UPK_STATUSES);
export type UpkStatus = z.infer<typeof upkStatusSchema>;

/**
 * Director threshold in IDR whole rupiah. UPK notes whose
 * `computed_upk` exceeds this must go through Director approval
 * after Finance.
 */
export const UPK_DIRECTOR_THRESHOLD_IDR = 50_000_000;

export const createUpkNoteSchema = z.object({
  employee_id: uuidSchema,
  evaluation_id: uuidSchema.optional(),
  contract_end_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be an ISO date (YYYY-MM-DD)."),
  service_months: z.number().int().min(0).max(600),
  base_salary_idr: z.number().int().min(0),
  multiplier: z.number().min(0).max(12).default(1),
  justification: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type CreateUpkNoteInput = z.infer<typeof createUpkNoteSchema>;

export const updateUpkNoteSchema = createUpkNoteSchema
  .partial()
  .extend({ id: uuidSchema });
export type UpdateUpkNoteInput = z.infer<typeof updateUpkNoteSchema>;

export const submitUpkNoteSchema = z.object({ id: uuidSchema });

export const decideUpkNoteSchema = z
  .object({
    id: uuidSchema,
    decision: z.enum(["APPROVE", "REJECT"]),
    notes: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .transform((v) => (v ? v : undefined)),
  })
  .refine((v) => v.decision !== "REJECT" || Boolean(v.notes), {
    path: ["notes"],
    message: "Notes are required when rejecting a UPK note.",
  });
export type DecideUpkNoteInput = z.infer<typeof decideUpkNoteSchema>;

export const markUpkPaidSchema = z.object({
  id: uuidSchema,
  paid_reference: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type MarkUpkPaidInput = z.infer<typeof markUpkPaidSchema>;

/**
 * Standard UPK formula for the tenant default:
 *   computed = base_salary × multiplier × (service_months / 12)
 * Rounded to whole rupiah. Kept as a pure function so unit tests
 * can pin the calculation.
 */
export function computeUpkAmount({
  baseSalaryIdr,
  serviceMonths,
  multiplier,
}: {
  baseSalaryIdr: number;
  serviceMonths: number;
  multiplier: number;
}): number {
  if (baseSalaryIdr <= 0 || serviceMonths <= 0 || multiplier <= 0) return 0;
  const years = serviceMonths / 12;
  return Math.round(baseSalaryIdr * multiplier * years);
}
