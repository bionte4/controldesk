import "server-only";
import { cache } from "react";

import { APPROVAL_CONFIG } from "@/lib/rbac/roles";
import { createClient } from "@/lib/supabase/server";
import type { ApprovalKind } from "@/lib/validation/approval-thresholds";

/**
 * Shape of a single row in `public.approval_thresholds` — mirrors the
 * migration 0024 schema. Numeric columns are typed `number | null`
 * because `mergeThresholds()` interprets NULL as "fall back to
 * `APPROVAL_CONFIG`".
 */
export type ApprovalThresholdRow = {
  kind: ApprovalKind;
  supervisor_threshold: number | null;
  pm_threshold: number | null;
  om_threshold: number | null;
  director_threshold: number | null;
  petty_auto_approve_below: number | null;
  petty_receipt_required_above: number | null;
  petty_hard_ceiling: number | null;
  settlement_sla_days: number | null;
  notes: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

/**
 * Global defaults, keyed by kind — the reference values the Admin UI
 * shows next to each input so users know the fallback that will kick in
 * when they leave a field empty. Also the values `mergeThresholds()`
 * uses when a column is NULL.
 */
export const APPROVAL_DEFAULTS: Record<
  ApprovalKind,
  Pick<
    ApprovalThresholdRow,
    | "supervisor_threshold"
    | "pm_threshold"
    | "om_threshold"
    | "director_threshold"
    | "petty_auto_approve_below"
    | "petty_receipt_required_above"
    | "petty_hard_ceiling"
    | "settlement_sla_days"
  >
> = {
  EXPENSE: {
    supervisor_threshold: null,
    pm_threshold: APPROVAL_CONFIG.EXPENSE.PM_THRESHOLD,
    om_threshold: null,
    director_threshold: APPROVAL_CONFIG.EXPENSE.DIRECTOR_THRESHOLD,
    petty_auto_approve_below: null,
    petty_receipt_required_above: null,
    petty_hard_ceiling: null,
    settlement_sla_days: null,
  },
  BUDGET: {
    supervisor_threshold: null,
    pm_threshold: null,
    om_threshold: null,
    director_threshold: APPROVAL_CONFIG.BUDGET.DIRECTOR_THRESHOLD,
    petty_auto_approve_below: null,
    petty_receipt_required_above: null,
    petty_hard_ceiling: null,
    settlement_sla_days: null,
  },
  CASH_ADVANCE_GENERAL: {
    supervisor_threshold: null,
    pm_threshold: APPROVAL_CONFIG.CASH_ADVANCE_GENERAL.PM_THRESHOLD,
    om_threshold: null,
    director_threshold: APPROVAL_CONFIG.CASH_ADVANCE_GENERAL.DIRECTOR_THRESHOLD,
    petty_auto_approve_below: null,
    petty_receipt_required_above: null,
    petty_hard_ceiling: null,
    settlement_sla_days: null,
  },
  CASH_ADVANCE_FIELD_OPS: {
    supervisor_threshold: null,
    pm_threshold: APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.PM_THRESHOLD,
    om_threshold: APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.OM_THRESHOLD,
    director_threshold:
      APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.DIRECTOR_THRESHOLD,
    petty_auto_approve_below: null,
    petty_receipt_required_above: null,
    petty_hard_ceiling: null,
    settlement_sla_days: APPROVAL_CONFIG.CASH_ADVANCE_FIELD_OPS.SETTLEMENT_SLA_DAYS,
  },
  PETTY_CASH: {
    supervisor_threshold: null,
    pm_threshold: null,
    om_threshold: null,
    director_threshold: null,
    petty_auto_approve_below: APPROVAL_CONFIG.PETTY_CASH.AUTO_APPROVE_BELOW,
    petty_receipt_required_above:
      APPROVAL_CONFIG.PETTY_CASH.RECEIPT_REQUIRED_ABOVE,
    petty_hard_ceiling: APPROVAL_CONFIG.PETTY_CASH.HARD_CEILING,
    settlement_sla_days: null,
  },
  BUDGET_REQUEST: {
    supervisor_threshold: null,
    pm_threshold: APPROVAL_CONFIG.BUDGET_REQUEST.PM_THRESHOLD,
    om_threshold: null,
    director_threshold: APPROVAL_CONFIG.BUDGET_REQUEST.DIRECTOR_THRESHOLD,
    petty_auto_approve_below: null,
    petty_receipt_required_above: null,
    petty_hard_ceiling: null,
    settlement_sla_days: null,
  },
};

const coerceNumber = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Load every override row for the current tenant, keyed by `kind`. Rows
 * that don't exist yet are returned as `null` — the caller merges them
 * with `APPROVAL_DEFAULTS` at render time.
 *
 * Wrapped in `React.cache()` so multiple RSC readers share a single
 * database round-trip within a request.
 */
export const loadApprovalThresholdsForAdmin = cache(async function () {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("approval_thresholds")
    .select(
      "kind, supervisor_threshold, pm_threshold, om_threshold, director_threshold, petty_auto_approve_below, petty_receipt_required_above, petty_hard_ceiling, settlement_sla_days, notes, updated_at, updated_by",
    );
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown[];
  const byKind: Partial<Record<ApprovalKind, ApprovalThresholdRow>> = {};
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    const kind = r.kind as ApprovalKind | undefined;
    if (!kind) continue;
    byKind[kind] = {
      kind,
      supervisor_threshold: coerceNumber(r.supervisor_threshold),
      pm_threshold: coerceNumber(r.pm_threshold),
      om_threshold: coerceNumber(r.om_threshold),
      director_threshold: coerceNumber(r.director_threshold),
      petty_auto_approve_below: coerceNumber(r.petty_auto_approve_below),
      petty_receipt_required_above: coerceNumber(
        r.petty_receipt_required_above,
      ),
      petty_hard_ceiling: coerceNumber(r.petty_hard_ceiling),
      settlement_sla_days:
        typeof r.settlement_sla_days === "number"
          ? r.settlement_sla_days
          : null,
      notes: (r.notes as string | null) ?? null,
      updated_at: (r.updated_at as string | null) ?? null,
      updated_by: (r.updated_by as string | null) ?? null,
    };
  }
  return byKind;
});
