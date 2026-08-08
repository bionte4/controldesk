import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { ReportBaseFilters, ReportResult, ReportRow } from "../types";

/**
 * Budget Request Register — every `budget_requests` row in the
 * requested date range with kind, amount, current status, applied-at,
 * and rejection reason. Finance uses this to audit how many
 * top-ups/decreases/transfers landed in the period and which projects
 * are the biggest movers.
 *
 * Date semantics: filter by `created_at::date` (that's when the
 * request was raised — most meaningful for auditors). `applied_at`
 * shows separately in the row so Finance can eyeball turnaround.
 *
 * Columns:
 *   Requested | Project | Budget | Kind | Requester |
 *   Amount | Status | Applied at | Justification
 */
export async function runBudgetRequestRegister(
  filters: ReportBaseFilters,
): Promise<ReportResult> {
  const supabase = await createClient();

  let query = supabase
    .from("budget_requests")
    .select(
      `id, kind, amount, justification, status, applied_at, created_at,
       budget:budget_id(
         id, title, fiscal_year, project_id,
         project:project_id(id, name, code, project_number)
       ),
       requester:requester_employee_id(full_name)`,
    )
    .eq("tenant_id", filters.tenantId)
    .order("created_at", { ascending: false });

  if (filters.from) {
    query = query.gte("created_at", filters.from);
  }
  if (filters.to) {
    query = query.lte("created_at", `${filters.to}T23:59:59Z`);
  }
  if (filters.brKind) {
    query = query.eq("kind", filters.brKind);
  }
  // `projectIds` here filters through the budget → project join. We
  // can't easily push that into the initial `.from()`, so we
  // post-filter in JS. The dataset is bounded (< a few thousand rows
  // per year in practice), so this stays cheap.

  const { data, error } = await query;
  if (error) {
    throw new Error(`Budget request register query failed: ${error.message}`);
  }

  const wantedProjects =
    filters.projectIds && filters.projectIds.length > 0
      ? new Set(filters.projectIds)
      : null;

  let totalIncrease = 0;
  let totalDecrease = 0;
  let totalTransfer = 0;
  let countApplied = 0;

  const rows: ReportRow[] = [];
  for (const b of data ?? []) {
    const budget = b.budget as {
      title: string;
      fiscal_year: number;
      project_id: string;
      project: {
        name: string;
        code: string;
        project_number: string | null;
      } | null;
    } | null;
    const project = budget?.project;
    if (wantedProjects) {
      if (!budget || !wantedProjects.has(budget.project_id)) continue;
    }
    const requester = b.requester as { full_name: string } | null;
    const amount = Number(b.amount ?? 0);
    if (b.kind === "INCREASE") totalIncrease += amount;
    else if (b.kind === "DECREASE") totalDecrease += amount;
    else if (b.kind === "TRANSFER") totalTransfer += amount;
    if (b.status === "APPLIED") countApplied += 1;

    rows.push([
      (b.created_at as string).slice(0, 10),
      project ? project.project_number ?? project.code : "—",
      budget ? `${budget.title} · FY${budget.fiscal_year}` : "—",
      b.kind,
      requester?.full_name ?? "—",
      amount,
      b.status,
      b.applied_at ? (b.applied_at as string).slice(0, 10) : null,
      b.justification,
    ]);
  }

  const generatedAt = new Date().toISOString();
  const scopePieces = [
    `${rows.length} requests`,
    `applied=${countApplied}`,
  ];
  if (filters.from && filters.to) {
    scopePieces.unshift(`${filters.from} → ${filters.to}`);
  }
  if (filters.brKind) scopePieces.push(`kind=${filters.brKind}`);

  return {
    kind: "budget-request-register",
    title: "Budget Request Register",
    generatedAt,
    scopeSummary: scopePieces.join(" · "),
    columns: [
      { key: "requested_at", label: "Requested", format: "date" },
      { key: "project", label: "Project", nowrap: true },
      { key: "budget", label: "Budget" },
      { key: "kind", label: "Kind", format: "status" },
      { key: "requester", label: "Requester" },
      { key: "amount", label: "Amount", format: "money", align: "right" },
      { key: "status", label: "Status", format: "status" },
      { key: "applied_at", label: "Applied", format: "date" },
      { key: "justification", label: "Justification" },
    ],
    rows,
    totals: [
      "TOTAL",
      null,
      null,
      null,
      null,
      totalIncrease - totalDecrease, // net movement (transfers net to 0)
      null,
      null,
      `+${formatShort(totalIncrease)} / -${formatShort(totalDecrease)} / ↔${formatShort(totalTransfer)}`,
    ],
  };
}

// Compact "1.2M" style used in the totals footer where three amounts
// must fit into a single cell without wrapping.
function formatShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return n.toFixed(0);
}
