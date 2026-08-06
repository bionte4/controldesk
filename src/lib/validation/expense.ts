import { z } from "zod";

import { uuidSchema } from "./common";

/**
 * Zod schemas for the project_expenses module (rules §9).
 *
 * Aligned with `supabase/migrations/0009_expenses_and_approvals.sql`.
 */

export const EXPENSE_STATUSES = [
  "DRAFT",
  "PENDING_L1_SUPERVISOR",
  "PENDING_L2_PROJECT_MANAGER",
  "PENDING_L2_5_FINANCE",
  "PENDING_L3_OPERATIONS_MANAGER",
  "PENDING_L4_HEAD_MANAGER",
  "PENDING_L5_GENERAL_MANAGER",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;
export const expenseStatusSchema = z.enum(EXPENSE_STATUSES);
export type ExpenseStatus = z.infer<typeof expenseStatusSchema>;

export const APPROVAL_ACTIONS = [
  "SUBMIT",
  "APPROVE",
  "REJECT",
  "CANCEL",
  "FINANCE_APPROVE",
  "FINANCE_REJECT",
] as const;
export const approvalActionSchema = z.enum(APPROVAL_ACTIONS);
export type ApprovalActionInput = z.infer<typeof approvalActionSchema>;

/**
 * Curated list of expense categories. Kept short in v1 — expand as accounting
 * introduces new GL codes without breaking existing rows.
 */
export const EXPENSE_CATEGORIES = [
  "TRAVEL",
  "ONSITE_MEAL",
  "IT_SUPPLIES",
  "SOFTWARE_LICENSE",
  "TRAINING",
  "COMMUNICATION",
  "MISC",
] as const;
export const expenseCategorySchema = z.enum(EXPENSE_CATEGORIES);
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be an ISO date (YYYY-MM-DD).");

export const submitExpenseSchema = z.object({
  project_id: uuidSchema,
  amount_idr: z
    .number({ message: "Amount must be a number." })
    .int("Rupiah amounts must be whole numbers.")
    .positive("Amount must be greater than zero.")
    .max(999_999_999_999, "Amount exceeds allowed maximum."),
  category: expenseCategorySchema,
  description: z
    .string()
    .trim()
    .min(4, "Description is too short.")
    .max(2000, "Description is too long."),
  incurred_on: isoDateSchema,
  receipt_url: z
    .string()
    .url("Receipt URL must be a valid URL.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type SubmitExpenseInput = z.infer<typeof submitExpenseSchema>;

export const approveExpenseSchema = z.object({
  id: uuidSchema,
  comment: z.string().trim().max(1000).optional(),
});
export type ApproveExpenseInput = z.infer<typeof approveExpenseSchema>;

export const rejectExpenseSchema = z.object({
  id: uuidSchema,
  reason: z
    .string()
    .trim()
    .min(4, "Rejection reason is required.")
    .max(1000, "Rejection reason is too long."),
});
export type RejectExpenseInput = z.infer<typeof rejectExpenseSchema>;

export const cancelExpenseSchema = z.object({
  id: uuidSchema,
  reason: z.string().trim().max(1000).optional(),
});
export type CancelExpenseInput = z.infer<typeof cancelExpenseSchema>;
