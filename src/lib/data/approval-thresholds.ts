import "server-only";
import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { ApprovalKind } from "@/lib/validation/approval-thresholds";

import {
  APPROVAL_DEFAULTS,
  type ApprovalThresholdRow,
} from "./approval-thresholds-defaults";

// Re-export the client-safe surface so existing server-side callers keep
// working with a single import path. Only the loader below actually
// requires `server-only`.
export { APPROVAL_DEFAULTS };
export type { ApprovalThresholdRow };

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
