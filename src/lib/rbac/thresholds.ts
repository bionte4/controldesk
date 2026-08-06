/**
 * ControlDesk RBAC — per-tenant approval threshold resolver (rules §9).
 *
 * The GAS-aligned defaults live in `APPROVAL_CONFIG` (`src/lib/rbac/roles.ts`).
 * A tenant can override any of them by writing a row in
 * `public.approval_thresholds` (migration 0024). This module reads the row
 * inside a Server Component / Server Action and returns a shape that mirrors
 * `APPROVAL_CONFIG`, falling back to the constant for any nullable field.
 *
 * Use this instead of importing `APPROVAL_CONFIG` directly whenever the
 * threshold participates in a business decision that may vary per tenant
 * (chain building, form previews, PDP checks). Pure unit tests can still
 * import `APPROVAL_CONFIG` directly with the tenant argument mocked out.
 */

import { cache } from "react";

import { APPROVAL_CONFIG } from "@/lib/rbac/roles";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type ThresholdKind =
  | "EXPENSE"
  | "BUDGET"
  | "CASH_ADVANCE_GENERAL"
  | "CASH_ADVANCE_FIELD_OPS"
  | "PETTY_CASH"
  | "BUDGET_REQUEST";

/**
 * Effective threshold shape — always a fully-materialized copy of the
 * config for the given `kind`, with per-tenant overrides applied where
 * present.
 *
 * We use explicit `number` shapes (not `typeof APPROVAL_CONFIG.*`) because
 * `APPROVAL_CONFIG` is `Object.freeze()`-narrowed to numeric literals; the
 * runtime overrides return arbitrary numbers and need to widen back.
 */
export type EffectiveExpenseThresholds = {
  kind: "EXPENSE";
  PM_THRESHOLD: number;
  DIRECTOR_THRESHOLD: number;
};
export type EffectiveBudgetThresholds = {
  kind: "BUDGET";
  DIRECTOR_THRESHOLD: number;
};
export type EffectiveCashAdvanceGeneralThresholds = {
  kind: "CASH_ADVANCE_GENERAL";
  PM_THRESHOLD: number;
  DIRECTOR_THRESHOLD: number;
};
export type EffectiveCashAdvanceFieldOpsThresholds = {
  kind: "CASH_ADVANCE_FIELD_OPS";
  PM_THRESHOLD: number;
  OM_THRESHOLD: number;
  DIRECTOR_THRESHOLD: number;
  SETTLEMENT_SLA_DAYS: number;
  SETTLEMENT_REMINDER_OFFSETS: readonly number[];
};
export type EffectivePettyCashThresholds = {
  kind: "PETTY_CASH";
  AUTO_APPROVE_BELOW: number;
  RECEIPT_REQUIRED_ABOVE: number;
  HARD_CEILING: number;
  LOW_BALANCE_RATIO: number;
  RECON_OVERDUE_DAYS: number;
  VARIANCE_TOLERANCE_IDR: number;
};
export type EffectiveBudgetRequestThresholds = {
  kind: "BUDGET_REQUEST";
  PM_THRESHOLD: number;
  DIRECTOR_THRESHOLD: number;
  MIN_JUSTIFICATION_CHARS: number;
};

export type EffectiveThresholds =
  | EffectiveExpenseThresholds
  | EffectiveBudgetThresholds
  | EffectiveCashAdvanceGeneralThresholds
  | EffectiveCashAdvanceFieldOpsThresholds
  | EffectivePettyCashThresholds
  | EffectiveBudgetRequestThresholds;

/**
 * Shape of the `approval_thresholds` DB row we consume. Postgres numerics
 * come back as strings via supabase-js; the row may also contain `number`
 * literals when tests hand in a hand-rolled fixture. Both are tolerated by
 * `pickNumber()` below.
 */
export type ThresholdRow = {
  supervisor_threshold: number | string | null;
  pm_threshold: number | string | null;
  om_threshold: number | string | null;
  director_threshold: number | string | null;
  petty_auto_approve_below: number | string | null;
  petty_receipt_required_above: number | string | null;
  petty_hard_ceiling: number | string | null;
  settlement_sla_days: number | null;
};

export function pickNumber(
  row: ThresholdRow | null,
  key: keyof ThresholdRow,
): number | null {
  if (!row) return null;
  const raw = row[key];
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return Number.isFinite(n) ? n : null;
}

/**
 * Pure merge of a `(kind, row)` pair onto the code-level defaults. Exported
 * for unit testing — `resolveThresholds()` composes this with the Supabase
 * client. Pass `row = null` to force the fallback path.
 *
 * Return type is narrowed via `Extract<EffectiveThresholds, {kind: TKind}>`
 * so `mergeThresholds("EXPENSE", …)` gives back `EffectiveExpenseThresholds`
 * directly rather than the full union.
 */
export function mergeThresholds<TKind extends ThresholdKind>(
  kind: TKind,
  row: ThresholdRow | null,
): Extract<EffectiveThresholds, { kind: TKind }>;
export function mergeThresholds(
  kind: ThresholdKind,
  row: ThresholdRow | null,
): EffectiveThresholds {
  switch (kind) {
    case "EXPENSE":
      return {
        kind: "EXPENSE",
        PM_THRESHOLD:
          pickNumber(row, "pm_threshold") ?? APPROVAL_CONFIG.EXPENSE.PM_THRESHOLD,
        DIRECTOR_THRESHOLD:
          pickNumber(row, "director_threshold") ?? APPROVAL_CONFIG.EXPENSE.DIRECTOR_THRESHOLD,
      };
    case "BUDGET":
      return {
        kind: "BUDGET",
        DIRECTOR_THRESHOLD:
          pickNumber(row, "director_threshold") ?? APPROVAL_CONFIG.BUDGET.DIRECTOR_THRESHOLD,
      };
    case "CASH_ADVANCE_GENERAL":
      return {
        kind: "CASH_ADVANCE_GENERAL",
        PM_THRESHOLD:
          pickNumber(row, "pm_threshold") ??
          APPROVAL_CONFIG.CASH_ADVANCE_GENERAL.PM_THRESHOLD,
        DIRECTOR_THRESHOLD:
          pickNumber(row, "director_threshold") ??
          APPROVAL_CONFIG.CASH_ADVANCE_GENERAL.DIRECTOR_THRESHOLD,
      };
    case "CASH_ADVANCE_FIELD_OPS":
      return {
        kind: "CASH_ADVANCE_FIELD_OPS",
        PM_THRESHOLD:
          pickNumber(row, "pm_threshold") ??
          APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.PM_THRESHOLD,
        OM_THRESHOLD:
          pickNumber(row, "om_threshold") ??
          APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.OM_THRESHOLD,
        DIRECTOR_THRESHOLD:
          pickNumber(row, "director_threshold") ??
          APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.DIRECTOR_THRESHOLD,
        SETTLEMENT_SLA_DAYS:
          pickNumber(row, "settlement_sla_days") ??
          APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.SETTLEMENT_SLA_DAYS,
        SETTLEMENT_REMINDER_OFFSETS:
          APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.SETTLEMENT_REMINDER_OFFSETS,
      };
    case "PETTY_CASH":
      return {
        kind: "PETTY_CASH",
        AUTO_APPROVE_BELOW:
          pickNumber(row, "petty_auto_approve_below") ??
          APPROVAL_CONFIG.PETTY_CASH.AUTO_APPROVE_BELOW,
        RECEIPT_REQUIRED_ABOVE:
          pickNumber(row, "petty_receipt_required_above") ??
          APPROVAL_CONFIG.PETTY_CASH.RECEIPT_REQUIRED_ABOVE,
        HARD_CEILING:
          pickNumber(row, "petty_hard_ceiling") ??
          APPROVAL_CONFIG.PETTY_CASH.HARD_CEILING,
        LOW_BALANCE_RATIO: APPROVAL_CONFIG.PETTY_CASH.LOW_BALANCE_RATIO,
        RECON_OVERDUE_DAYS: APPROVAL_CONFIG.PETTY_CASH.RECON_OVERDUE_DAYS,
        VARIANCE_TOLERANCE_IDR: APPROVAL_CONFIG.PETTY_CASH.VARIANCE_TOLERANCE_IDR,
      };
    case "BUDGET_REQUEST":
      return {
        kind: "BUDGET_REQUEST",
        PM_THRESHOLD:
          pickNumber(row, "pm_threshold") ??
          APPROVAL_CONFIG.BUDGET_REQUEST.PM_THRESHOLD,
        DIRECTOR_THRESHOLD:
          pickNumber(row, "director_threshold") ??
          APPROVAL_CONFIG.BUDGET_REQUEST.DIRECTOR_THRESHOLD,
        MIN_JUSTIFICATION_CHARS:
          APPROVAL_CONFIG.BUDGET_REQUEST.MIN_JUSTIFICATION_CHARS,
      };
    default: {
      const _never: never = kind;
      throw new Error(`Unknown ThresholdKind: ${String(_never)}`);
    }
  }
}

/**
 * Resolve the effective thresholds for a tenant + kind. Reads the DB row via
 * the service-role client (bypassing RLS is safe here — we constrain the
 * query to the caller-supplied `tenantId`) and merges with the code-level
 * defaults.
 *
 * Wrapped in `React.cache()` so a single RSC render only pays the network
 * cost once per `(tenantId, kind)` pair.
 */
export const resolveThresholds = cache(async function resolveThresholds<
  TKind extends ThresholdKind,
>(tenantId: string, kind: TKind): Promise<EffectiveThresholds> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("approval_thresholds")
    .select(
      "supervisor_threshold, pm_threshold, om_threshold, director_threshold, petty_auto_approve_below, petty_receipt_required_above, petty_hard_ceiling, settlement_sla_days",
    )
    .eq("tenant_id", tenantId)
    .eq("kind", kind)
    .maybeSingle();

  if (error) {
    // Fail-open to the code defaults rather than break the request. The
    // observability layer (§21) will still see the error via the wrapper's
    // structured log.
    return mergeThresholds(kind, null);
  }

  return mergeThresholds(kind, (data as ThresholdRow | null) ?? null);
});
