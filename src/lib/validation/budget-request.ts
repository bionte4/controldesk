/**
 * ControlDesk — Budget Request Zod schemas (Fase 2, rules §9.6 / §29).
 *
 * Aligned with:
 *   supabase/migrations/0030_budget_requests.sql
 *   src/lib/budget-requests/state.ts
 */

import { z } from "zod";

import { idrAmountSchema, uuidSchema } from "./common";
import type {
  BudgetRequestKind,
  BudgetRequestStatus,
} from "@/types/database";

export const BR_KIND_VALUES = [
  "INCREASE",
  "DECREASE",
  "TRANSFER",
] as const satisfies readonly BudgetRequestKind[];

export const BR_STATUS_VALUES = [
  "DRAFT",
  "PENDING_PM",
  "PENDING_FINANCE",
  "PENDING_DIRECTOR",
  "APPROVED",
  "APPLIED",
  "REJECTED",
  "CANCELLED",
] as const satisfies readonly BudgetRequestStatus[];

export const budgetRequestKindSchema = z.enum(BR_KIND_VALUES);
export const budgetRequestStatusSchema = z.enum(BR_STATUS_VALUES);

// ---------------------------------------------------------------------------
// Submit — polymorphic on kind. Enforced by a discriminated union so callers
// get compile-time hints about which lines are required.
// ---------------------------------------------------------------------------

const MIN_JUSTIFICATION_LEN = 20;

const justificationSchema = z
  .string()
  .trim()
  .min(
    MIN_JUSTIFICATION_LEN,
    `Justification must be at least ${MIN_JUSTIFICATION_LEN} characters (rules §9.6).`,
  )
  .max(2000, "Justification cannot exceed 2000 characters.");

const submitIncreaseSchema = z.object({
  kind: z.literal("INCREASE"),
  budget_id: uuidSchema,
  amount_idr: idrAmountSchema.refine((v) => v > 0, "Amount must be > 0."),
  justification: justificationSchema,
  /** The budget_detail whose planned_amount grows. */
  target_detail_id: uuidSchema,
});

const submitDecreaseSchema = z.object({
  kind: z.literal("DECREASE"),
  budget_id: uuidSchema,
  amount_idr: idrAmountSchema.refine((v) => v > 0, "Amount must be > 0."),
  justification: justificationSchema,
  /** The budget_detail whose planned_amount shrinks. */
  source_detail_id: uuidSchema,
});

const submitTransferSchema = z
  .object({
    kind: z.literal("TRANSFER"),
    budget_id: uuidSchema,
    amount_idr: idrAmountSchema.refine((v) => v > 0, "Amount must be > 0."),
    justification: justificationSchema,
    /** Debited line (shrinks). */
    source_detail_id: uuidSchema,
    /** Credited line (grows). */
    target_detail_id: uuidSchema,
  })
  .refine((v) => v.source_detail_id !== v.target_detail_id, {
    message: "TRANSFER source and target lines must be different.",
    path: ["target_detail_id"],
  });

export const submitBudgetRequestSchema = z.discriminatedUnion("kind", [
  submitIncreaseSchema,
  submitDecreaseSchema,
  submitTransferSchema,
]);

export type SubmitBudgetRequestInput = z.infer<typeof submitBudgetRequestSchema>;

// ---------------------------------------------------------------------------
// Approve / Reject / Cancel / Apply — thin ID + optional comment.
// ---------------------------------------------------------------------------

const commentSchema = z
  .string()
  .trim()
  .max(2000, "Comment cannot exceed 2000 characters.")
  .optional();

export const approveBudgetRequestSchema = z.object({
  id: uuidSchema,
  comment: commentSchema,
});
export type ApproveBudgetRequestInput = z.infer<
  typeof approveBudgetRequestSchema
>;

export const rejectBudgetRequestSchema = z.object({
  id: uuidSchema,
  reason: z
    .string()
    .trim()
    .min(1, "Reject reason is required.")
    .max(2000, "Reject reason cannot exceed 2000 characters."),
});
export type RejectBudgetRequestInput = z.infer<typeof rejectBudgetRequestSchema>;

export const cancelBudgetRequestSchema = z.object({
  id: uuidSchema,
  comment: commentSchema,
});
export type CancelBudgetRequestInput = z.infer<typeof cancelBudgetRequestSchema>;

export const applyBudgetRequestSchema = z.object({
  id: uuidSchema,
  comment: commentSchema,
});
export type ApplyBudgetRequestInput = z.infer<typeof applyBudgetRequestSchema>;
