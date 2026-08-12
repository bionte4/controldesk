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
 * Budget categories are admin-curated at runtime via `lookup_options`
 * (domain: `budget_category`, migration 0054). Migration 0054 seeds the
 * codes below as defaults for every tenant — historic rows keep working
 * because the `code` values are unchanged. Accounting can add new codes
 * (e.g. SOFTWARE_LICENSE) via `/settings/lookups` without a code deploy.
 *
 * The Zod schema no longer pins the enum literal — it validates format
 * only (uppercase snake_case, 1..64 chars). The server action performs a
 * defence-in-depth SELECT against `lookup_options` to reject unknown or
 * inactive codes.
 *
 * `LEGACY_BUDGET_CATEGORY_DEFAULTS` remains exported as a compile-time
 * constant so tests and any client fallback (before lookups load) can
 * still tree-shake against a well-known baseline.
 */
export const LEGACY_BUDGET_CATEGORY_DEFAULTS = [
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

/** @deprecated Kept for backward compat with existing tests. Use runtime lookup. */
export const BUDGET_CATEGORIES = LEGACY_BUDGET_CATEGORY_DEFAULTS;

export const budgetCategorySchema = z
  .string()
  .trim()
  .min(1, "Category is required.")
  .max(64, "Category code is too long.")
  .regex(
    /^[A-Z][A-Z0-9_]*$/,
    "Category code must be UPPER_SNAKE_CASE (letters, digits, underscores).",
  );
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
/**
 * `coa_id` — optional FK to a postable CoA account (migration 0056). It is
 * accepted as `null` too so the form can serialize "no CoA selected" without
 * sending an empty string. When present, the server action verifies the
 * account is active and `is_postable=true` in the caller's tenant.
 */
const coaIdField = uuidSchema
  .nullish()
  .transform((v) => (v === null || v === undefined ? undefined : v));

export const addBudgetLineItemSchema = z.object({
  budget_id: uuidSchema,
  seq: z
    .number()
    .int("Sequence must be a whole number.")
    .positive("Sequence must be > 0."),
  category: budgetCategorySchema,
  coa_id: coaIdField,
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
  coa_id: coaIdField,
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
