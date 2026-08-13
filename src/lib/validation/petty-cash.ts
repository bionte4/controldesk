import { z } from "zod";

import { uuidSchema } from "./common";

/**
 * Zod schemas for the Petty Cash module (rules §10 — Imprest Fund System).
 * Aligned with `supabase/migrations/0012_petty_cash.sql`.
 */

export const PETTY_CASH_VOUCHER_MAX_IDR = 1_000_000; // Rules §10 hard limit.

const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be an ISO date (YYYY-MM-DD).");

// ---------------------------------------------------------------------------
// Funds
// ---------------------------------------------------------------------------
export const createPettyCashFundSchema = z
  .object({
    location_name: z.string().trim().min(2).max(200),
    custodian_employee_id: uuidSchema,
    imprest_idr: z
      .number()
      .int("Rupiah amounts must be whole numbers.")
      .positive("Imprest must be positive.")
      .max(999_999_999_999),
    min_balance_idr: z
      .number()
      .int("Rupiah amounts must be whole numbers.")
      .nonnegative("Min balance cannot be negative.")
      .max(999_999_999_999),
    opening_balance_idr: z
      .number()
      .int("Rupiah amounts must be whole numbers.")
      .nonnegative("Opening balance cannot be negative.")
      .max(999_999_999_999)
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.min_balance_idr > val.imprest_idr) {
      ctx.addIssue({
        code: "custom",
        path: ["min_balance_idr"],
        message: "Min balance cannot exceed imprest.",
      });
    }
    if (
      val.opening_balance_idr !== undefined &&
      val.opening_balance_idr > val.imprest_idr
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["opening_balance_idr"],
        message: "Opening balance cannot exceed imprest.",
      });
    }
  });
export type CreatePettyCashFundInput = z.infer<
  typeof createPettyCashFundSchema
>;

// ---------------------------------------------------------------------------
// Vouchers (petty spends)
// ---------------------------------------------------------------------------
export const PETTY_CASH_CATEGORIES = [
  "SUPPLIES",
  "REFRESHMENT",
  "TRANSPORT",
  "PARKING",
  "COURIER",
  "MISC",
] as const;
export const pettyCashCategorySchema = z.enum(PETTY_CASH_CATEGORIES);
export type PettyCashCategory = z.infer<typeof pettyCashCategorySchema>;

export const createPettyCashVoucherSchema = z.object({
  fund_id: uuidSchema,
  amount_idr: z
    .number({ message: "Amount must be a number." })
    .int("Rupiah amounts must be whole numbers.")
    .positive("Amount must be greater than zero.")
    .max(
      PETTY_CASH_VOUCHER_MAX_IDR - 1,
      `Petty cash vouchers cannot exceed Rp ${(PETTY_CASH_VOUCHER_MAX_IDR - 1).toLocaleString("id-ID")}.`,
    ),
  category: pettyCashCategorySchema,
  // Optional Chart of Accounts binding. See `finance/petty-cash` server
  // actions for the active + postable + tenant check.
  coa_id: uuidSchema
    .nullish()
    .transform((v) => (v === null || v === undefined ? undefined : v)),
  description: z.string().trim().min(4).max(2000),
  incurred_on: isoDateSchema,
  receipt_url: z
    .string()
    .url("Receipt URL must be a valid URL.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /**
   * Optional cost-centre tag (migration 0087). Petty-cash vouchers
   * are not project-scoped (no `project_id` on the table — only
   * `fund_id`), so any active tenant `unit_pengaju` label is valid.
   * The value is used purely for reporting attribution when e.g.
   * one imprest fund covers voucher requests from multiple units.
   */
  unit_pengaju: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});
export type CreatePettyCashVoucherInput = z.infer<
  typeof createPettyCashVoucherSchema
>;

export const voidPettyCashVoucherSchema = z.object({
  id: uuidSchema,
  reason: z.string().trim().min(4).max(1000),
});
export type VoidPettyCashVoucherInput = z.infer<
  typeof voidPettyCashVoucherSchema
>;

// ---------------------------------------------------------------------------
// Replenishments
// ---------------------------------------------------------------------------
export const requestReplenishmentSchema = z.object({
  fund_id: uuidSchema,
  requested_amount_idr: z
    .number()
    .int("Rupiah amounts must be whole numbers.")
    .positive("Amount must be positive.")
    .max(999_999_999_999),
  reason: z.string().trim().max(2000).optional(),
});
export type RequestReplenishmentInput = z.infer<
  typeof requestReplenishmentSchema
>;

export const approveReplenishmentSchema = z.object({
  id: uuidSchema,
  comment: z.string().trim().max(1000).optional(),
});
export type ApproveReplenishmentInput = z.infer<
  typeof approveReplenishmentSchema
>;

export const rejectReplenishmentSchema = z.object({
  id: uuidSchema,
  reason: z.string().trim().min(4).max(1000),
});
export type RejectReplenishmentInput = z.infer<
  typeof rejectReplenishmentSchema
>;

export const disburseReplenishmentSchema = z.object({
  id: uuidSchema,
  disbursement_ref: z.string().trim().min(1).max(200),
});
export type DisburseReplenishmentInput = z.infer<
  typeof disburseReplenishmentSchema
>;
