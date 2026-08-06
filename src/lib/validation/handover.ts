import { z } from "zod";

import { isoDateTimeSchema, uuidSchema } from "./common";

/**
 * Zod schemas for the PM Handover module (rules §13).
 * Aligned with `supabase/migrations/0013_pm_handovers.sql`.
 */

export const PM_HANDOVER_STATUSES = [
  "DRAFT",
  "PENDING_OM",
  "PENDING_HM",
  "APPROVED",
  "EXECUTED",
  "REJECTED",
  "CANCELLED",
] as const;
export const pmHandoverStatusSchema = z.enum(PM_HANDOVER_STATUSES);
export type PmHandoverStatusInput = z.infer<typeof pmHandoverStatusSchema>;

export const submitPmHandoverSchema = z
  .object({
    project_id: uuidSchema,
    from_pm_employee_id: uuidSchema,
    to_pm_employee_id: uuidSchema,
    effective_at: isoDateTimeSchema,
    reason: z.string().trim().min(4, "Reason is too short.").max(2000),
    handover_notes: z
      .preprocess(
        (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
        z.string().trim().max(4000).optional(),
      )
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.from_pm_employee_id === val.to_pm_employee_id) {
      ctx.addIssue({
        code: "custom",
        path: ["to_pm_employee_id"],
        message: "Outgoing and incoming PM must be different employees.",
      });
    }
  });
export type SubmitPmHandoverInput = z.infer<typeof submitPmHandoverSchema>;

export const approvePmHandoverSchema = z.object({
  id: uuidSchema,
  comment: z.string().trim().max(1000).optional(),
});
export type ApprovePmHandoverInput = z.infer<typeof approvePmHandoverSchema>;

export const rejectPmHandoverSchema = z.object({
  id: uuidSchema,
  reason: z
    .string()
    .trim()
    .min(4, "Rejection reason is required.")
    .max(1000, "Rejection reason is too long."),
});
export type RejectPmHandoverInput = z.infer<typeof rejectPmHandoverSchema>;

export const cancelPmHandoverSchema = z.object({
  id: uuidSchema,
  reason: z.string().trim().max(1000).optional(),
});
export type CancelPmHandoverInput = z.infer<typeof cancelPmHandoverSchema>;

export const executePmHandoverSchema = z.object({
  id: uuidSchema,
});
export type ExecutePmHandoverInput = z.infer<typeof executePmHandoverSchema>;
