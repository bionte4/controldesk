import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { ReportBaseFilters, ReportResult, ReportRow } from "../types";

/**
 * Expense Register — every `project_expenses` row in the requested
 * date range (default filter uses `incurred_on`, falling back to
 * `created_at` when null). Filterable by project_id set, status,
 * category. RLS scopes to the caller's project set.
 *
 * Columns:
 *   Date | Project | Requester | Vendor / Description | Category |
 *   COA / MA line | Amount | Status | Payment method | Approved by
 */
export async function runExpenseRegister(
  filters: ReportBaseFilters,
): Promise<ReportResult> {
  const supabase = await createClient();

  let query = supabase
    .from("project_expenses")
    .select(
      `id, project_id, incurred_on, created_at, amount, currency, category,
       description, status, payment_method, receipt_url,
       finance_approver_id, final_approver_id,
       project:project_id(id, name, code, project_number),
       submitter:submitter_employee_id(id, full_name),
       budget_detail:budget_detail_id(id, description,
                                     coa:coa_id(code, name)),
       finance_approver:finance_approver_id(full_name),
       final_approver:final_approver_id(full_name)`,
    )
    .eq("tenant_id", filters.tenantId)
    .order("incurred_on", { ascending: false, nullsFirst: false });

  if (filters.from) query = query.gte("incurred_on", filters.from);
  if (filters.to) query = query.lte("incurred_on", filters.to);
  if (filters.projectIds && filters.projectIds.length > 0) {
    query = query.in("project_id", filters.projectIds);
  }
  if (filters.expenseStatus) {
    query = query.eq(
      "status",
      // Cast — the Supabase generated types would otherwise reject a
      // freeform string, but we already validated the enum client-side.
      filters.expenseStatus as never,
    );
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Expense register query failed: ${error.message}`);
  }

  let totalAmount = 0;

  const rows: ReportRow[] = (data ?? []).map((e) => {
    const project = e.project as {
      name: string;
      code: string;
      project_number: string | null;
    } | null;
    const submitter = e.submitter as { full_name: string } | null;
    const budgetDetail = e.budget_detail as {
      description: string | null;
      coa: { code: string; name: string } | null;
    } | null;
    const financeApp = e.finance_approver as { full_name: string } | null;
    const finalApp = e.final_approver as { full_name: string } | null;

    const amount = Number(e.amount ?? 0);
    totalAmount += amount;

    const coaLabel = budgetDetail?.coa
      ? `${budgetDetail.coa.code} · ${budgetDetail.coa.name}`
      : budgetDetail?.description ?? "—";

    return [
      e.incurred_on ?? (e.created_at as string).slice(0, 10),
      project ? project.project_number ?? project.code : "—",
      submitter?.full_name ?? "—",
      e.description ?? "—",
      e.category ?? "—",
      coaLabel,
      amount,
      e.status,
      e.payment_method ?? "—",
      finalApp?.full_name ?? financeApp?.full_name ?? "—",
    ];
  });

  const generatedAt = new Date().toISOString();
  const scopePieces: string[] = [`${rows.length} expenses`];
  if (filters.from && filters.to) {
    scopePieces.unshift(`${filters.from} → ${filters.to}`);
  }
  if (filters.projectIds && filters.projectIds.length > 0) {
    scopePieces.push(`${filters.projectIds.length} projects`);
  }
  if (filters.expenseStatus) scopePieces.push(`status=${filters.expenseStatus}`);

  return {
    kind: "expense-register",
    title: "Expense Register",
    generatedAt,
    scopeSummary: scopePieces.join(" · "),
    columns: [
      { key: "date", label: "Date", format: "date" },
      { key: "project", label: "Project", nowrap: true },
      { key: "requester", label: "Requester" },
      { key: "description", label: "Description" },
      { key: "category", label: "Category" },
      { key: "coa", label: "COA / MA line" },
      { key: "amount", label: "Amount", format: "money", align: "right" },
      { key: "status", label: "Status", format: "status" },
      { key: "payment_method", label: "Payment" },
      { key: "approver", label: "Approver" },
    ],
    rows,
    totals: [null, null, null, null, null, "TOTAL", totalAmount, null, null, null],
  };
}
