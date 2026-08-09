/**
 * ControlDesk — Zod schemas for the Admin UI at
 * `/settings/approval-thresholds` (Option B, rules §9).
 *
 * Every field mirrors a nullable column in `public.approval_thresholds`
 * (migration 0024). `null` means "use the global default from
 * `APPROVAL_CONFIG`" — that's how `mergeThresholds()` in
 * `src/lib/rbac/thresholds.ts` interprets a NULL row-field.
 *
 * The `orderedThresholdsRefine` guard mirrors the DB CHECK constraint
 * (`approval_thresholds_ordered_ck`) so the form fails fast before the
 * Server Action hits the RPC boundary.
 */

import { z } from "zod";

/**
 * Optional non-negative IDR value. Blank strings from the form are
 * coerced to `null` (= "clear this override, fall back to default").
 */
const idrOrClear = z
  .union([z.number(), z.string()])
  .transform((v, ctx): number | null => {
    if (v === "" || v == null) return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Must be a finite number.",
      });
      return z.NEVER;
    }
    if (n < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cannot be negative.",
      });
      return z.NEVER;
    }
    // Store as integer IDR — no fractional rupiah in the settings UI.
    return Math.round(n);
  })
  .nullable();

/**
 * Same as `idrOrClear` but for the settlement-SLA days field, which is
 * an integer in `[1, 365]`. NULL = fall back to the 10-day default.
 */
const slaDaysOrClear = z
  .union([z.number(), z.string()])
  .transform((v, ctx): number | null => {
    if (v === "" || v == null) return null;
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Must be a whole number.",
      });
      return z.NEVER;
    }
    if (n < 1 || n > 365) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Must be between 1 and 365 days.",
      });
      return z.NEVER;
    }
    return n;
  })
  .nullable();

export const APPROVAL_KINDS = [
  "EXPENSE",
  "BUDGET",
  "CASH_ADVANCE_GENERAL",
  "CASH_ADVANCE_FIELD_OPS",
  "PETTY_CASH",
  "BUDGET_REQUEST",
] as const;

export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

/**
 * A single-kind threshold row. All fields optional (nullable) so the row
 * can carry only the fields relevant to its kind — the DB permits NULL
 * everywhere and `mergeThresholds()` fills in defaults from
 * `APPROVAL_CONFIG` per-field.
 */
export const upsertApprovalThresholdSchema = z
  .object({
    kind: z.enum(APPROVAL_KINDS),
    supervisor_threshold: idrOrClear.optional(),
    pm_threshold: idrOrClear.optional(),
    om_threshold: idrOrClear.optional(),
    director_threshold: idrOrClear.optional(),
    petty_auto_approve_below: idrOrClear.optional(),
    petty_receipt_required_above: idrOrClear.optional(),
    petty_hard_ceiling: idrOrClear.optional(),
    settlement_sla_days: slaDaysOrClear.optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((row, ctx) => {
    // Mirror `approval_thresholds_ordered_ck` from migration 0024 —
    // supervisor ≤ pm ≤ om ≤ director, and pm ≤ director as an extra
    // guard against configs that skip om but tighten director.
    const pairs: Array<
      [keyof typeof row, keyof typeof row, string]
    > = [
      [
        "supervisor_threshold",
        "pm_threshold",
        "Supervisor must be ≤ PM threshold.",
      ],
      [
        "pm_threshold",
        "om_threshold",
        "PM must be ≤ OM threshold.",
      ],
      [
        "om_threshold",
        "director_threshold",
        "OM must be ≤ Director threshold.",
      ],
      [
        "pm_threshold",
        "director_threshold",
        "PM must be ≤ Director threshold.",
      ],
    ];
    for (const [aKey, bKey, msg] of pairs) {
      const a = row[aKey] as number | null | undefined;
      const b = row[bKey] as number | null | undefined;
      if (
        typeof a === "number" &&
        typeof b === "number" &&
        a > b
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: msg,
          path: [bKey as string],
        });
      }
    }
  });

export type UpsertApprovalThresholdInput = z.input<
  typeof upsertApprovalThresholdSchema
>;
export type UpsertApprovalThresholdOutput = z.output<
  typeof upsertApprovalThresholdSchema
>;

/**
 * Reset a single kind back to defaults — deletes the row from
 * `approval_thresholds` for that (tenant, kind).
 */
export const resetApprovalThresholdSchema = z.object({
  kind: z.enum(APPROVAL_KINDS),
});

export type ResetApprovalThresholdInput = z.input<
  typeof resetApprovalThresholdSchema
>;
