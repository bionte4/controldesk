import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { ReportBaseFilters, ReportResult, ReportRow } from "../types";

/**
 * Budget vs Actual — one row per `budget_details` line, showing
 * planned vs realized vs outstanding vs remaining, with a utilization
 * percentage and a colored status flag.
 *
 * Filtering:
 *   * `fiscalYear` (required-ish, defaults to current year) — scopes
 *     to `budgets.fiscal_year`.
 *   * `projectIds` (optional) — narrows to one project. Combined with
 *     `fiscalYear` this gives you the classic "MA vs realisasi" view
 *     that Finance & PM discuss in monthly reviews.
 *
 * We show *only* APPROVED budgets. DRAFT/PENDING budgets are
 * intentionally excluded — they haven't been ratified so their
 * `planned_amount` isn't real. If a project has no APPROVED budget it
 * simply doesn't appear.
 *
 * Utilization = realized / planned. A remaining_amount that's
 * negative (over-budget) surfaces as `> 100%` utilization plus a
 * "OVER" status.
 */
export async function runBudgetVsActual(
  filters: ReportBaseFilters,
): Promise<ReportResult> {
  const supabase = await createClient();
  const fiscalYear = filters.fiscalYear ?? new Date().getUTCFullYear();

  let budgetQuery = supabase
    .from("budgets")
    .select(
      `id, fiscal_year, title, status, total_planned_amount,
       project:project_id(id, name, code, project_number),
       details:budget_details(
         id, seq, code, category, description,
         planned_amount, realized_amount, outstanding_amount, remaining_amount,
         coa:coa_id(code, name)
       )`,
    )
    .eq("tenant_id", filters.tenantId)
    .eq("status", "APPROVED")
    .eq("fiscal_year", fiscalYear);

  if (filters.projectIds && filters.projectIds.length > 0) {
    budgetQuery = budgetQuery.in("project_id", filters.projectIds);
  }

  const { data, error } = await budgetQuery;
  if (error) {
    throw new Error(`Budget vs Actual query failed: ${error.message}`);
  }

  let totalPlanned = 0;
  let totalRealized = 0;
  let totalOutstanding = 0;
  let totalRemaining = 0;

  const rows: ReportRow[] = [];
  for (const b of data ?? []) {
    const project = b.project as {
      name: string;
      code: string;
      project_number: string | null;
    } | null;
    const details = (b.details ?? []) as Array<{
      seq: number;
      code: string | null;
      category: string;
      description: string | null;
      planned_amount: number | string;
      realized_amount: number | string;
      outstanding_amount: number | string;
      remaining_amount: number | string | null;
      coa: { code: string; name: string } | null;
    }>;
    // Ensure MA lines are shown in the same order the project team
    // sees them in the budget page (seq ASC).
    details.sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0));

    for (const d of details) {
      const planned = Number(d.planned_amount ?? 0);
      const realized = Number(d.realized_amount ?? 0);
      const outstanding = Number(d.outstanding_amount ?? 0);
      const remaining =
        d.remaining_amount === null || d.remaining_amount === undefined
          ? planned - realized - outstanding
          : Number(d.remaining_amount);

      totalPlanned += planned;
      totalRealized += realized;
      totalOutstanding += outstanding;
      totalRemaining += remaining;

      // Utilization: 0 when planned is 0 to avoid Infinity/NaN in the
      // preview. Finance would rather see a zero than a "-" here
      // because it makes totals row usable.
      const utilization = planned > 0 ? (realized + outstanding) / planned : 0;
      // Status flag driven by remaining_amount, not utilization —
      // avoids surprises when a line has 100% realized but 0%
      // outstanding vs 90% realized + 15% outstanding (the latter is
      // actually the more dangerous one).
      const status =
        remaining < 0 ? "OVER" : utilization >= 0.9 ? "TIGHT" : "OK";

      rows.push([
        project ? project.project_number ?? project.code : "—",
        d.code ?? `MA-${d.seq}`,
        d.category,
        d.coa ? `${d.coa.code} · ${d.coa.name}` : "—",
        planned,
        realized,
        outstanding,
        remaining,
        utilization,
        status,
      ]);
    }
  }

  const generatedAt = new Date().toISOString();
  const scopePieces = [
    `FY ${fiscalYear}`,
    `${rows.length} budget lines`,
  ];
  if (filters.projectIds && filters.projectIds.length > 0) {
    scopePieces.push(`project=${filters.projectIds.length}`);
  }

  const totalUtilization =
    totalPlanned > 0 ? (totalRealized + totalOutstanding) / totalPlanned : 0;

  return {
    kind: "budget-vs-actual",
    title: "Budget vs Actual",
    generatedAt,
    scopeSummary: scopePieces.join(" · "),
    columns: [
      { key: "project", label: "Project", nowrap: true },
      { key: "ma_code", label: "MA", nowrap: true },
      { key: "category", label: "Category" },
      { key: "coa", label: "COA" },
      { key: "planned", label: "Planned", format: "money", align: "right" },
      { key: "realized", label: "Realized", format: "money", align: "right" },
      {
        key: "outstanding",
        label: "Outstanding",
        format: "money",
        align: "right",
      },
      { key: "remaining", label: "Remaining", format: "money", align: "right" },
      { key: "util", label: "Util. %", format: "percent", align: "right" },
      { key: "status", label: "Status", format: "status" },
    ],
    rows,
    totals: [
      "TOTAL",
      null,
      null,
      null,
      totalPlanned,
      totalRealized,
      totalOutstanding,
      totalRemaining,
      totalUtilization,
      null,
    ],
  };
}
