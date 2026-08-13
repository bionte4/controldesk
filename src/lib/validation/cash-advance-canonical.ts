/**
 * ControlDesk — Cash Advance canonical Zod schemas (Fase 1.5, GAS-aligned).
 *
 * These schemas back the new server actions in
 * `src/app/(app)/finance/cash-advances/actions-canonical.ts` (Slice 1.5b).
 * The legacy schemas in `cash-advance.ts` remain in place for the
 * `PENDING_L*` chain until every in-flight row terminates.
 *
 * Mapped to migration `0027_cash_advance_gas_align.sql` — the
 * `ca_type` enum and canonical `PENDING_*` statuses.
 */

import { z } from "zod";

import { isoDateSchema, uuidSchema } from "./common";

// ---------------------------------------------------------------------------
// Enum schemas that mirror the DB. Keeping them explicit here means the
// error messages stay consistent even if the generated types drift.
// ---------------------------------------------------------------------------

export const CASH_ADVANCE_TYPES = ["GENERAL", "FIELD_OPS"] as const;
export const cashAdvanceTypeSchema = z.enum(CASH_ADVANCE_TYPES);
export type CashAdvanceTypeInput = z.infer<typeof cashAdvanceTypeSchema>;

export const CANONICAL_CA_STATUS_INPUTS = [
  "DRAFT",
  "PENDING_SUPERVISOR",
  "PENDING_PM",
  "PENDING_OM",
  "PENDING_FINANCE",
  "PENDING_DIRECTOR",
  "APPROVED",
  "DISBURSED",
  "SETTLED",
  "REJECTED",
  "CANCELLED",
] as const;
export const canonicalCaStatusSchema = z.enum(CANONICAL_CA_STATUS_INPUTS);
export type CanonicalCaStatusInput = z.infer<typeof canonicalCaStatusSchema>;

// ---------------------------------------------------------------------------
// Money — reuse the "int rupiah" contract used elsewhere but bound the
// max at IDR 999_999_999_999 (~ Rp 1 T) so accidental UI overflows fail
// fast rather than reach the DB.
// ---------------------------------------------------------------------------

const rupiahAmount = z
  .number({ message: "Amount must be a number." })
  .int("Rupiah amounts must be whole numbers.")
  .positive("Amount must be greater than zero.")
  .max(999_999_999_999, "Amount exceeds allowed maximum.");

const optionalNote = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v === "" ? undefined : v));

// ---------------------------------------------------------------------------
// CREATE / SUBMIT
// ---------------------------------------------------------------------------

export const submitCanonicalCashAdvanceSchema = z.object({
  ca_type: cashAdvanceTypeSchema,
  project_id: uuidSchema,
  amount_idr: rupiahAmount,
  purpose: z
    .string()
    .trim()
    .min(4, "Purpose is too short.")
    .max(2000, "Purpose is too long."),
  needed_by: isoDateSchema.optional(),
  /**
   * Optional GL classification. Server action verifies the row is
   * active + postable in the caller's tenant; nullable-safe.
   */
  coa_id: uuidSchema
    .nullish()
    .transform((v) => (v === null || v === undefined ? undefined : v)),
  /**
   * Optional cost-centre tag (migration 0087). For General CA the
   * value lands on `cash_advances.unit_pengaju` and is validated by
   * the server action against `project_allowed_units` when the
   * project has a whitelist. Field-Ops CA uses a separate schema
   * (`field-ops-advance.ts`) so this field only applies to General.
   */
  unit_pengaju: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});
export type SubmitCanonicalCashAdvanceInput = z.infer<
  typeof submitCanonicalCashAdvanceSchema
>;

// ---------------------------------------------------------------------------
// APPROVE / REJECT / CANCEL
// ---------------------------------------------------------------------------

export const approveCanonicalCashAdvanceSchema = z.object({
  id: uuidSchema,
  comment: optionalNote,
});
export type ApproveCanonicalCashAdvanceInput = z.infer<
  typeof approveCanonicalCashAdvanceSchema
>;

export const rejectCanonicalCashAdvanceSchema = z.object({
  id: uuidSchema,
  reason: z
    .string()
    .trim()
    .min(4, "Rejection reason is required.")
    .max(1000),
});
export type RejectCanonicalCashAdvanceInput = z.infer<
  typeof rejectCanonicalCashAdvanceSchema
>;

export const cancelCanonicalCashAdvanceSchema = z.object({
  id: uuidSchema,
  reason: optionalNote,
});
export type CancelCanonicalCashAdvanceInput = z.infer<
  typeof cancelCanonicalCashAdvanceSchema
>;

// ---------------------------------------------------------------------------
// DISBURSE — Finance releases funds, records the bank/voucher ref.
// ---------------------------------------------------------------------------

export const disburseCanonicalCashAdvanceSchema = z.object({
  id: uuidSchema,
  disbursement_ref: z
    .string()
    .trim()
    .min(1, "Disbursement reference is required.")
    .max(200, "Reference is too long."),
  note: optionalNote,
});
export type DisburseCanonicalCashAdvanceInput = z.infer<
  typeof disburseCanonicalCashAdvanceSchema
>;

// ---------------------------------------------------------------------------
// SETTLE — owner submits total_spent + attachments; Finance accepts/returns.
// ---------------------------------------------------------------------------

export const submitCanonicalSettlementSchema = z.object({
  cash_advance_id: uuidSchema,
  total_spent_idr: z
    .number({ message: "Amount must be a number." })
    .int("Rupiah amounts must be whole numbers.")
    .nonnegative("Cannot be negative.")
    .max(999_999_999_999),
  notes: optionalNote,
});
export type SubmitCanonicalSettlementInput = z.infer<
  typeof submitCanonicalSettlementSchema
>;

export const acceptCanonicalSettlementSchema = z.object({
  settlement_id: uuidSchema,
});
export type AcceptCanonicalSettlementInput = z.infer<
  typeof acceptCanonicalSettlementSchema
>;

export const returnCanonicalSettlementSchema = z.object({
  settlement_id: uuidSchema,
  reason: z
    .string()
    .trim()
    .min(4, "Return reason is required.")
    .max(1000),
});
export type ReturnCanonicalSettlementInput = z.infer<
  typeof returnCanonicalSettlementSchema
>;
