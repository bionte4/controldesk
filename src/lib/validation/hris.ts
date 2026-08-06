import { z } from "zod";

import { isoDateTimeSchema, uuidSchema } from "./common";

/**
 * Zod schemas for the HRIS request module (rules §12).
 *
 * Aligned with `supabase/migrations/0010_hris_requests.sql`.
 */

export const HR_REQUEST_KINDS = ["LEAVE", "OVERTIME", "SICK"] as const;
export const hrRequestKindSchema = z.enum(HR_REQUEST_KINDS);
export type HrRequestKindInput = z.infer<typeof hrRequestKindSchema>;

export const HR_REQUEST_STATUSES = [
  "DRAFT",
  "PENDING_L1_SUPERVISOR",
  "PENDING_L2_PROJECT_MANAGER",
  "PENDING_L3_OPERATIONS_MANAGER",
  "PENDING_HR_ADMIN",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;
export const hrRequestStatusSchema = z.enum(HR_REQUEST_STATUSES);
export type HrRequestStatusInput = z.infer<typeof hrRequestStatusSchema>;

export const HR_LEAVE_TYPES = [
  "ANNUAL",
  "UNPAID",
  "MATERNITY",
  "PATERNITY",
  "BEREAVEMENT",
  "MARRIAGE",
  "OTHER",
] as const;
export const hrLeaveTypeSchema = z.enum(HR_LEAVE_TYPES);
export type HrLeaveTypeInput = z.infer<typeof hrLeaveTypeSchema>;

export const submitHrRequestSchema = z
  .object({
    kind: hrRequestKindSchema,
    project_id: uuidSchema.optional(),
    leave_type: hrLeaveTypeSchema.optional(),
    start_at: isoDateTimeSchema,
    end_at: isoDateTimeSchema,
    hours_estimate: z
      .number()
      .positive("Overtime hours must be positive.")
      .max(24, "Overtime cannot exceed 24 hours in a single request.")
      .optional(),
    reason: z.string().trim().min(4, "Reason is too short.").max(2000),
    attachment_url: z
      .string()
      .url("Attachment must be a valid URL.")
      .optional()
      .or(z.literal("").transform(() => undefined)),
  })
  .superRefine((val, ctx) => {
    if (new Date(val.end_at).getTime() <= new Date(val.start_at).getTime()) {
      ctx.addIssue({
        code: "custom",
        path: ["end_at"],
        message: "End time must be after start time.",
      });
    }
    if (val.kind === "LEAVE" && !val.leave_type) {
      ctx.addIssue({
        code: "custom",
        path: ["leave_type"],
        message: "Leave type is required for LEAVE requests.",
      });
    }
    if (val.kind === "OVERTIME" && !val.hours_estimate) {
      ctx.addIssue({
        code: "custom",
        path: ["hours_estimate"],
        message: "Hours estimate is required for OVERTIME requests.",
      });
    }
    if (val.kind === "SICK" && !val.attachment_url) {
      ctx.addIssue({
        code: "custom",
        path: ["attachment_url"],
        message: "Doctor's note (surat dokter) is required for SICK requests.",
      });
    }
  });

export type SubmitHrRequestInput = z.infer<typeof submitHrRequestSchema>;

export const approveHrRequestSchema = z.object({
  id: uuidSchema,
  comment: z.string().trim().max(1000).optional(),
});
export type ApproveHrRequestInput = z.infer<typeof approveHrRequestSchema>;

export const rejectHrRequestSchema = z.object({
  id: uuidSchema,
  reason: z
    .string()
    .trim()
    .min(4, "Rejection reason is required.")
    .max(1000, "Rejection reason is too long."),
});
export type RejectHrRequestInput = z.infer<typeof rejectHrRequestSchema>;

export const cancelHrRequestSchema = z.object({
  id: uuidSchema,
  reason: z.string().trim().max(1000).optional(),
});
export type CancelHrRequestInput = z.infer<typeof cancelHrRequestSchema>;
