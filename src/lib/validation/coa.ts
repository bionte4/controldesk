import { z } from "zod";

import { uuidSchema } from "./common";

/**
 * Zod schemas for the Chart of Accounts admin surface
 * (migration 0055, rules §16). Kept intentionally strict:
 *
 *   - `code`   validated at write time so cross-system lookups (Accurate,
 *              Zahir, spreadsheet exports) stay predictable. We enforce a
 *              digits-only 3..10 char pattern that covers every reasonable
 *              GL numbering scheme without being tied to the 4-digit
 *              default seed.
 *   - `name`   free-text but bounded so table renders don't blow up.
 *   - `parent_id` optional → hierarchy is optional; every account can be a
 *              standalone leaf.
 *   - `account_type` / `normal_side` — enums that mirror the DB enums. The
 *              server action must additionally verify the pairing matches
 *              the CHECK constraint (ASSET/EXPENSE ⇒ DEBIT, others ⇒
 *              CREDIT); we do the same check here so form UX shows a
 *              client-side error before submit.
 */

export const COA_ACCOUNT_TYPES = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
] as const;
export const coaAccountTypeSchema = z.enum(COA_ACCOUNT_TYPES);
export type CoaAccountTypeInput = z.infer<typeof coaAccountTypeSchema>;

export const COA_NORMAL_SIDES = ["DEBIT", "CREDIT"] as const;
export const coaNormalSideSchema = z.enum(COA_NORMAL_SIDES);
export type CoaNormalSideInput = z.infer<typeof coaNormalSideSchema>;

const codeField = z
  .string()
  .trim()
  .regex(
    /^\d{3,10}$/u,
    "Account code must be 3–10 digits (numbers only).",
  );

const nameField = z
  .string()
  .trim()
  .min(2, "Account name is too short.")
  .max(120, "Account name is too long.");

const descriptionField = z
  .string()
  .trim()
  .max(500, "Description is too long.")
  .optional()
  .transform((val) => (val === "" ? undefined : val));

// Same check as the DB CHECK constraint. Keeps the client-side experience
// aligned with the server-side reject.
function assertNormalSideMatchesType(
  value: { account_type: CoaAccountTypeInput; normal_side: CoaNormalSideInput },
  ctx: z.RefinementCtx,
): void {
  const shouldBeDebit =
    value.account_type === "ASSET" || value.account_type === "EXPENSE";
  const expected: CoaNormalSideInput = shouldBeDebit ? "DEBIT" : "CREDIT";
  if (value.normal_side !== expected) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["normal_side"],
      message: `${value.account_type} accounts must have ${expected} as their normal side.`,
    });
  }
}

export const createCoaSchema = z
  .object({
    code: codeField,
    name: nameField,
    account_type: coaAccountTypeSchema,
    normal_side: coaNormalSideSchema,
    parent_id: uuidSchema.nullish().transform((v) => v ?? undefined),
    is_postable: z.boolean().default(true),
    description: descriptionField,
  })
  .superRefine(assertNormalSideMatchesType);
export type CreateCoaInput = z.infer<typeof createCoaSchema>;

export const updateCoaSchema = z
  .object({
    id: uuidSchema,
    code: codeField,
    name: nameField,
    account_type: coaAccountTypeSchema,
    normal_side: coaNormalSideSchema,
    parent_id: uuidSchema.nullish().transform((v) => v ?? undefined),
    is_postable: z.boolean(),
    description: descriptionField,
  })
  .superRefine(assertNormalSideMatchesType);
export type UpdateCoaInput = z.infer<typeof updateCoaSchema>;

export const toggleCoaActiveSchema = z.object({
  id: uuidSchema,
  is_active: z.boolean(),
});
export type ToggleCoaActiveInput = z.infer<typeof toggleCoaActiveSchema>;
