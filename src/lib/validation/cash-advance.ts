import { z } from "zod";

import { uuidSchema } from "./common";

/**
 * Zod schemas for the Cash Advance module (rules §11).
 * Aligned with `supabase/migrations/0011_cash_advance.sql`.
 */

export const CASH_ADVANCE_STATUSES = [
  "DRAFT",
  "PENDING_L1_SUPERVISOR",
  "PENDING_L2_PROJECT_MANAGER",
  "PENDING_L2_5_FINANCE",
  "PENDING_L3_OPERATIONS_MANAGER",
  "PENDING_L4_HEAD_MANAGER",
  "PENDING_L5_GENERAL_MANAGER",
  "APPROVED",
  "DISBURSED",
  "SETTLED",
  "REJECTED",
  "CANCELLED",
] as const;
export const cashAdvanceStatusSchema = z.enum(CASH_ADVANCE_STATUSES);
export type CashAdvanceStatusInput = z.infer<typeof cashAdvanceStatusSchema>;

const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be an ISO date (YYYY-MM-DD).");

export const submitCashAdvanceSchema = z.object({
  project_id: uuidSchema,
  amount_idr: z
    .number({ message: "Amount must be a number." })
    .int("Rupiah amounts must be whole numbers.")
    .positive("Amount must be greater than zero.")
    .max(999_999_999_999, "Amount exceeds allowed maximum."),
  purpose: z
    .string()
    .trim()
    .min(4, "Purpose is too short.")
    .max(2000, "Purpose is too long."),
  needed_by: isoDateSchema.optional(),
  // Optional GL classification. When present the server action verifies
  // the CoA row is active + postable in the caller's tenant. Nullable-
  // safe: `null` / omitted / empty string all fold to undefined.
  coa_id: uuidSchema
    .nullish()
    .transform((v) => (v === null || v === undefined ? undefined : v)),
});
export type SubmitCashAdvanceInput = z.infer<typeof submitCashAdvanceSchema>;

export const approveCashAdvanceSchema = z.object({
  id: uuidSchema,
  comment: z.string().trim().max(1000).optional(),
});
export type ApproveCashAdvanceInput = z.infer<typeof approveCashAdvanceSchema>;

export const rejectCashAdvanceSchema = z.object({
  id: uuidSchema,
  reason: z
    .string()
    .trim()
    .min(4, "Rejection reason is required.")
    .max(1000),
});
export type RejectCashAdvanceInput = z.infer<typeof rejectCashAdvanceSchema>;

export const cancelCashAdvanceSchema = z.object({
  id: uuidSchema,
  reason: z.string().trim().max(1000).optional(),
});
export type CancelCashAdvanceInput = z.infer<typeof cancelCashAdvanceSchema>;

export const disburseCashAdvanceSchema = z.object({
  id: uuidSchema,
  disbursement_ref: z
    .string()
    .trim()
    .min(1, "Disbursement reference is required.")
    .max(200),
});
export type DisburseCashAdvanceInput = z.infer<
  typeof disburseCashAdvanceSchema
>;

export const submitSettlementSchema = z.object({
  cash_advance_id: uuidSchema,
  total_spent_idr: z
    .number({ message: "Amount must be a number." })
    .int("Rupiah amounts must be whole numbers.")
    .nonnegative("Cannot be negative.")
    .max(999_999_999_999),
  notes: z.string().trim().max(2000).optional(),
});
export type SubmitSettlementInput = z.infer<typeof submitSettlementSchema>;

export const acceptSettlementSchema = z.object({
  settlement_id: uuidSchema,
});
export type AcceptSettlementInput = z.infer<typeof acceptSettlementSchema>;

export const returnSettlementSchema = z.object({
  settlement_id: uuidSchema,
  reason: z
    .string()
    .trim()
    .min(4, "Return reason is required.")
    .max(1000),
});
export type ReturnSettlementInput = z.infer<typeof returnSettlementSchema>;
