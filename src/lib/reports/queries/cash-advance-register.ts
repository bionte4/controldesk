import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { ReportBaseFilters, ReportResult, ReportRow } from "../types";

/**
 * Cash Advance Register — every `cash_advances` row in the requested
 * date range with disbursement, settlement, and variance columns.
 * The variance column is derived (`amount - net_settlement_amount`)
 * so Finance can spot advances that under- or over-settled at a
 * glance.
 *
 * Date semantics: filter by `disbursed_at::date` when set, else fall
 * back to `created_at::date`. This mirrors how Finance eyeballs the
 * register — they care about when cash left the till, not when the
 * request was drafted. Undisbursed rows still show up so pending
 * requests aren't hidden.
 *
 * Columns:
 *   Type | Requester | Project | Purpose | Amount | Disbursed |
 *   Settlement due | Net settlement | Variance | Status | Ticket
 */
export async function runCashAdvanceRegister(
  filters: ReportBaseFilters,
): Promise<ReportResult> {
  const supabase = await createClient();

  let query = supabase
    .from("cash_advances")
    .select(
      `id, project_id, ca_type, amount, currency, purpose, needed_by,
       status, disbursed_at, disbursement_ref, settlement_due_at,
       settled_at, net_settlement_amount, created_at,
       project:project_id(id, name, code, project_number),
       requester:requester_employee_id(id, full_name),
       finance_approver:finance_approver_id(full_name),
       director_approver:director_approver_id(full_name),
       field_ops:cash_advance_field_ops_details!left(ticket_number, area, tujuan)`,
    )
    .eq("tenant_id", filters.tenantId)
    .order("created_at", { ascending: false });

  // Filter on disbursement or creation date range. We use a compound
  // filter so undisbursed rows are still included when their
  // `created_at` falls in the range — otherwise the register would
  // hide the pipeline from Finance.
  if (filters.from) {
    query = query.or(
      `disbursed_at.gte.${filters.from},and(disbursed_at.is.null,created_at.gte.${filters.from})`,
    );
  }
  if (filters.to) {
    // For `to` we clip strictly — a "2026-08-31" request will match
    // up to end-of-day on that date because Postgres compares
    // timestamptz against date via implicit cast.
    query = query.or(
      `disbursed_at.lte.${filters.to}T23:59:59Z,and(disbursed_at.is.null,created_at.lte.${filters.to}T23:59:59Z)`,
    );
  }
  if (filters.projectIds && filters.projectIds.length > 0) {
    query = query.in("project_id", filters.projectIds);
  }
  if (filters.caStatus) {
    query = query.eq("status", filters.caStatus as never);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`CA register query failed: ${error.message}`);
  }

  let totalAmount = 0;
  let totalSettled = 0;
  let totalVariance = 0;

  const rows: ReportRow[] = (data ?? []).map((c) => {
    const project = c.project as {
      name: string;
      code: string;
      project_number: string | null;
    } | null;
    const requester = c.requester as { full_name: string } | null;
    // Field ops details is a 0..1 relation (`!left`) — normalise to
    // a single row or `null`. Field ops columns follow the paper form:
    // `ticket_number` for the client ticket ref, `area`/`tujuan` for
    // the physical location.
    const fieldOps = Array.isArray(c.field_ops)
      ? (c.field_ops[0] as
          | { ticket_number: string | null; area: string | null; tujuan: string | null }
          | undefined)
      : (c.field_ops as
          | { ticket_number: string | null; area: string | null; tujuan: string | null }
          | null);

    const amount = Number(c.amount ?? 0);
    const netSettlement =
      c.net_settlement_amount === null || c.net_settlement_amount === undefined
        ? null
        : Number(c.net_settlement_amount);
    // Variance = advance − actual. Positive → refund owed to company;
    // negative → top-up owed to requester. Blank when the CA hasn't
    // settled yet so the column doesn't misleadingly read "0".
    const variance =
      netSettlement === null ? null : amount - netSettlement;

    totalAmount += amount;
    if (netSettlement !== null) totalSettled += netSettlement;
    if (variance !== null) totalVariance += variance;

    return [
      c.ca_type,
      requester?.full_name ?? "—",
      project ? project.project_number ?? project.code : "—",
      c.purpose,
      amount,
      c.disbursed_at ? c.disbursed_at.slice(0, 10) : null,
      c.settlement_due_at ? c.settlement_due_at.slice(0, 10) : null,
      netSettlement,
      variance,
      c.status,
      fieldOps?.ticket_number ?? null,
    ];
  });

  const generatedAt = new Date().toISOString();
  const scopePieces: string[] = [`${rows.length} advances`];
  if (filters.from && filters.to) {
    scopePieces.unshift(`${filters.from} → ${filters.to}`);
  }
  if (filters.projectIds && filters.projectIds.length > 0) {
    scopePieces.push(`${filters.projectIds.length} projects`);
  }
  if (filters.caStatus) scopePieces.push(`status=${filters.caStatus}`);

  return {
    kind: "cash-advance-register",
    title: "Cash Advance Register",
    generatedAt,
    scopeSummary: scopePieces.join(" · "),
    columns: [
      { key: "type", label: "Type", format: "status" },
      { key: "requester", label: "Requester" },
      { key: "project", label: "Project", nowrap: true },
      { key: "purpose", label: "Purpose" },
      { key: "amount", label: "Amount", format: "money", align: "right" },
      { key: "disbursed_at", label: "Disbursed", format: "date" },
      { key: "settlement_due", label: "Sett. due", format: "date" },
      {
        key: "net_settlement",
        label: "Net settlement",
        format: "money",
        align: "right",
      },
      { key: "variance", label: "Variance", format: "money", align: "right" },
      { key: "status", label: "Status", format: "status" },
      { key: "ticket", label: "Ticket", nowrap: true },
    ],
    rows,
    totals: [
      "TOTAL",
      null,
      null,
      null,
      totalAmount,
      null,
      null,
      totalSettled,
      totalVariance,
      null,
      null,
    ],
  };
}
