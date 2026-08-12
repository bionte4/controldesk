import { z } from "zod";

/** ISO 8601 date-time string (e.g. `2026-08-04T15:22:00.000Z`). */
export const isoDateTimeSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: "Must be an ISO 8601 date-time.",
  });

/** ISO 8601 calendar date (YYYY-MM-DD). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "Use ISO date (YYYY-MM-DD).")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), {
    message: "Must be a valid ISO 8601 date.",
  });

/** UUID v4 primary key. */
export const uuidSchema = z.uuid("Must be a valid UUID.");

/**
 * IDR amount in whole rupiah — non-negative integer. Rules §7/§8/§9 all use
 * this base unit.
 */
export const idrAmountSchema = z
  .number({ message: "Amount must be a number." })
  .int("Rupiah amounts must be whole numbers.")
  .nonnegative("Amount must be ≥ 0.");

/** Percentage from 0-100 with one decimal. */
export const percentSchema = z
  .number()
  .min(0, "Cannot be negative.")
  .max(100, "Cannot exceed 100.");

/** Non-empty trimmed string with a sensible max length. */
export const shortText = z.string().trim().min(1).max(256);
export const longText = z.string().trim().min(1).max(4000);
