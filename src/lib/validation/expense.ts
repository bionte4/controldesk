import { z } from "zod";

import { uuidSchema } from "./common";

/**
 * Zod schemas for the project_expenses module (rules §9).
 *
 * Aligned with:
 *   - `supabase/migrations/0009_expenses_and_approvals.sql` (base)
 *   - `supabase/migrations/0044_expenses_form_upgrade.sql` (MA + payment
 *     method + notes + submitted_at)
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

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
 * Curated list of expense categories. Kept as a fallback taxonomy when
 * a project has no `budgets` / `budget_details` set up yet.
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

export const EXPENSE_PAYMENT_METHODS = [
  "BANK_TRANSFER",
  "CASH",
  "REIMBURSEMENT",
  "CORPORATE_CARD",
] as const;
export const expensePaymentMethodSchema = z.enum(EXPENSE_PAYMENT_METHODS);
export type ExpensePaymentMethodInput = z.infer<
  typeof expensePaymentMethodSchema
>;

// ---------------------------------------------------------------------------
// Common atoms
// ---------------------------------------------------------------------------

const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be an ISO date (YYYY-MM-DD).");

const amountIdrSchema = z
  .number({ message: "Amount must be a number." })
  .int("Rupiah amounts must be whole numbers.")
  .positive("Amount must be greater than zero.")
  .max(999_999_999_999, "Amount exceeds allowed maximum.");

const descriptionSchema = z
  .string()
  .trim()
  .min(4, "Description is too short.")
  .max(2000, "Description is too long.");

const notesSchema = z
  .string()
  .max(4000, "Notes are too long.")
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const trimmed = v.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  });

/**
 * Justifikasi wajib saat submit expense dengan `incurred_on` yang lebih tua
 * dari 7 hari kerja (soft-warn policy). Zod hanya melakukan normalisasi
 * (trim + empty → undefined + max-length guard); pemeriksaan semantik
 * (min 5 char + wajib kalau lewat SLA) dilakukan di server action via
 * `evaluateLateSubmission`. Ini menjaga schema tetap `optional` di TypeScript
 * sehingga form yang tidak membutuhkan alasan tidak perlu mengirim field ini.
 */
const lateSubmissionReasonSchema = z
  .string()
  .max(500, "Justification is too long.")
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const trimmed = v.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  });

const optionalReceiptUrl = z
  .string()
  .url("Receipt URL must be a valid URL.")
  .optional()
  .or(z.literal("").transform(() => undefined));

/**
 * Optional CoA link. Accepts either an omitted / null value (during
 * rollout) or a uuid. Nullable-safe: form serialization sends `null`
 * for "not set" while the server action folds it back to undefined and
 * lets the DB column stay null. Verification of active + postable
 * happens at server-action level (see `finance/expenses/actions.ts`).
 */
const coaIdField = uuidSchema
  .nullish()
  .transform((v) => (v === null || v === undefined ? undefined : v));

// ---------------------------------------------------------------------------
// Draft — Save-draft supports partial data. Only project + description are
// required at DRAFT time; MA line and payment method may still be blank.
// ---------------------------------------------------------------------------

export const saveDraftExpenseSchema = z.object({
  project_id: uuidSchema,
  budget_detail_id: uuidSchema.optional().nullable(),
  amount_idr: amountIdrSchema,
  category: expenseCategorySchema.optional(),
  coa_id: coaIdField,
  payment_method: expensePaymentMethodSchema.optional().nullable(),
  description: descriptionSchema,
  notes: notesSchema,
  incurred_on: isoDateSchema,
  late_submission_reason: lateSubmissionReasonSchema,
});
export type SaveDraftExpenseInput = z.infer<typeof saveDraftExpenseSchema>;

export const updateDraftExpenseSchema = saveDraftExpenseSchema.extend({
  id: uuidSchema,
});
export type UpdateDraftExpenseInput = z.infer<typeof updateDraftExpenseSchema>;

// ---------------------------------------------------------------------------
// Submit — DRAFT → PENDING_L1. Requires all fields.
// ---------------------------------------------------------------------------

export const submitDraftExpenseSchema = z.object({
  id: uuidSchema,
});
export type SubmitDraftExpenseInput = z.infer<typeof submitDraftExpenseSchema>;

/**
 * @deprecated Legacy single-shot submit (no DRAFT step). Kept for backwards
 * compat with any callers still using the old form; new code should call
 * `saveDraftExpenseAction` followed by `submitDraftExpenseAction`.
 */
export const submitExpenseSchema = z.object({
  project_id: uuidSchema,
  budget_detail_id: uuidSchema.optional().nullable(),
  amount_idr: amountIdrSchema,
  category: expenseCategorySchema,
  coa_id: coaIdField,
  payment_method: expensePaymentMethodSchema.optional().nullable(),
  description: descriptionSchema,
  notes: notesSchema,
  incurred_on: isoDateSchema,
  receipt_url: optionalReceiptUrl,
});
export type SubmitExpenseInput = z.infer<typeof submitExpenseSchema>;

// ---------------------------------------------------------------------------
// Approve / Reject / Cancel / Delete-draft
// ---------------------------------------------------------------------------

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

export const deleteDraftExpenseSchema = z.object({
  id: uuidSchema,
});
export type DeleteDraftExpenseInput = z.infer<typeof deleteDraftExpenseSchema>;

// ---------------------------------------------------------------------------
// Attachment schemas — receipts upload / delete.
// ---------------------------------------------------------------------------

export const detachReceiptSchema = z.object({
  expense_id: uuidSchema,
  attachment_id: uuidSchema,
});
export type DetachReceiptInput = z.infer<typeof detachReceiptSchema>;

// ---------------------------------------------------------------------------
// Approver-side MA (budget line) assignment. PM / Finance / OM+ can code an
// expense that was submitted without an MA line (Employee-level submits are
// intentionally MA-less; the approver classifies during review).
// ---------------------------------------------------------------------------

export const assignExpenseBudgetLineSchema = z.object({
  id: uuidSchema,
  budget_detail_id: uuidSchema.nullable(),
});
export type AssignExpenseBudgetLineInput = z.infer<
  typeof assignExpenseBudgetLineSchema
>;

/**
 * Approver-side CoA classification. Employees may submit without a
 * CoA; PM / Finance / OM+ can attach or update one during review
 * without going back to DRAFT. Sending `null` unsets the account.
 */
export const assignExpenseCoaSchema = z.object({
  id: uuidSchema,
  coa_id: uuidSchema.nullable(),
});
export type AssignExpenseCoaInput = z.infer<typeof assignExpenseCoaSchema>;

// ---------------------------------------------------------------------------
// Late-submission policy (Settlement SLA §11 revisi 2026-08).
// ---------------------------------------------------------------------------

/**
 * Maksimum lag hari kerja antara `incurred_on` dan `now` sebelum expense
 * dianggap "late submission" dan wajib menyertakan `late_submission_reason`.
 */
export const EXPENSE_INCURRED_MAX_BUSINESS_DAYS = 7;

/**
 * Hasil evaluasi kebijakan late-submission untuk kombinasi `incurred_on`
 * + `late_submission_reason`. Dipakai oleh server action `submit*` untuk
 * memutuskan apakah submission harus di-block atau di-flag ke approver.
 */
export type LateSubmissionEvaluation =
  | { kind: "ok"; businessDaysOld: number }
  | { kind: "requires_reason"; businessDaysOld: number }
  | { kind: "flagged"; businessDaysOld: number; reason: string };

/**
 * Return apakah expense dengan `incurred_on` (dan optional
 * `late_submission_reason`) boleh disubmit. Alur:
 *   - Kalau usia ≤ 7 wd → ok.
 *   - Kalau usia > 7 wd + reason kosong → requires_reason (server harus
 *     tolak dan minta user isi justifikasi).
 *   - Kalau usia > 7 wd + reason terisi → flagged (approver akan
 *     menerima notifikasi EXPENSE_INCURRED_STALE).
 *
 * Fungsi ini pure supaya bisa dipakai di server & client (form-level
 * hint). Business-day math di-import dari `@/lib/format/business-days`.
 */
export function evaluateLateSubmission(input: {
  incurredOn: string;
  now: Date;
  reason?: string | null;
  businessDaysOld: number;
}): LateSubmissionEvaluation {
  if (input.businessDaysOld <= EXPENSE_INCURRED_MAX_BUSINESS_DAYS) {
    return { kind: "ok", businessDaysOld: input.businessDaysOld };
  }
  const reason = (input.reason ?? "").trim();
  if (reason.length < 5) {
    return {
      kind: "requires_reason",
      businessDaysOld: input.businessDaysOld,
    };
  }
  return {
    kind: "flagged",
    businessDaysOld: input.businessDaysOld,
    reason,
  };
}
