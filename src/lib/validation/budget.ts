import { z } from "zod";

import { idrAmountSchema, uuidSchema } from "./common";

/**
 * Zod schemas for the GAS-aligned budgets module (rules §9.2).
 *
 * Aligned with:
 *   - supabase/migrations/0025_budgets_gas_align.sql
 *   - src/lib/rbac/roles.ts::budgetApprovalChain
 */

export const BUDGET_STATUSES = [
  "DRAFT",
  "PENDING_FINANCE",
  "PENDING_DIRECTOR",
  "APPROVED",
  "REVISED",
  "CANCELLED",
] as const;
export const budgetStatusSchema = z.enum(BUDGET_STATUSES);
export type BudgetStatus = z.infer<typeof budgetStatusSchema>;

/**
 * Curated list of budget categories mirroring GAS `BudgetService`. Keeping
 * the enum short in v1 — accounting can propose additions without a schema
 * change (the DB column is `text`).
 */
export const BUDGET_CATEGORIES = [
  "DIRECT_LABOUR",
  "SUBCONTRACTOR",
  "INFRASTRUCTURE",
  "TOOLING",
  "TRAVEL",
  "TRAINING",
  "MARKETING",
  "OPERATIONS",
  "CONTINGENCY",
  "OTHER",
] as const;
export const budgetCategorySchema = z.enum(BUDGET_CATEGORIES);
export type BudgetCategory = z.infer<typeof budgetCategorySchema>;

// ---------------------------------------------------------------------------
// Header — createBudget.
// ---------------------------------------------------------------------------
export const createBudgetSchema = z.object({
  project_id: uuidSchema,
  fiscal_year: z
    .number()
    .int("Fiscal year must be an integer.")
    .min(2000, "Fiscal year is too far in the past.")
    .max(2100, "Fiscal year is too far in the future."),
  title: z
    .string()
    .trim()
    .min(4, "Title is too short.")
    .max(200, "Title is too long."),
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((val) => (val === "" ? undefined : val)),
});
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;

// ---------------------------------------------------------------------------
// Line items.
// ---------------------------------------------------------------------------
export const addBudgetLineItemSchema = z.object({
  budget_id: uuidSchema,
  seq: z
    .number()
    .int("Sequence must be a whole number.")
    .positive("Sequence must be > 0."),
  category: budgetCategorySchema,
  description: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((val) => (val === "" ? undefined : val)),
  planned_amount: idrAmountSchema.max(
    999_999_999_999,
    "Amount exceeds allowed maximum.",
  ),
});
export type AddBudgetLineItemInput = z.infer<typeof addBudgetLineItemSchema>;

export const updateBudgetLineItemSchema = z.object({
  id: uuidSchema,
  category: budgetCategorySchema.optional(),
  description: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((val) => (val === "" ? undefined : val)),
  planned_amount: idrAmountSchema
    .max(999_999_999_999, "Amount exceeds allowed maximum.")
    .optional(),
  realized_amount: idrAmountSchema
    .max(999_999_999_999, "Amount exceeds allowed maximum.")
    .optional(),
  outstanding_amount: idrAmountSchema
    .max(999_999_999_999, "Amount exceeds allowed maximum.")
    .optional(),
});
export type UpdateBudgetLineItemInput = z.infer<typeof updateBudgetLineItemSchema>;

export const deleteBudgetLineItemSchema = z.object({
  id: uuidSchema,
});
export type DeleteBudgetLineItemInput = z.infer<typeof deleteBudgetLineItemSchema>;

// ---------------------------------------------------------------------------
// Lifecycle — submit / approve / reject / cancel.
// ---------------------------------------------------------------------------
export const submitBudgetSchema = z.object({
  id: uuidSchema,
});
export type SubmitBudgetInput = z.infer<typeof submitBudgetSchema>;

export const approveBudgetSchema = z.object({
  id: uuidSchema,
  comment: z.string().trim().max(1000).optional(),
});
export type ApproveBudgetInput = z.infer<typeof approveBudgetSchema>;

export const rejectBudgetSchema = z.object({
  id: uuidSchema,
  reason: z
    .string()
    .trim()
    .min(4, "Rejection reason is required.")
    .max(1000, "Rejection reason is too long."),
});
export type RejectBudgetInput = z.infer<typeof rejectBudgetSchema>;

export const cancelBudgetSchema = z.object({
  id: uuidSchema,
  reason: z.string().trim().max(1000).optional(),
});
export type CancelBudgetInput = z.infer<typeof cancelBudgetSchema>;
