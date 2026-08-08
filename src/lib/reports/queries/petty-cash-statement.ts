import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { ReportBaseFilters, ReportResult, ReportRow } from "../types";

/**
 * Petty Cash Statement — bank-statement-style ledger for one or all
 * funds in the tenant. For each posted entry we render a single row
 * showing the running balance at that point in time. Custodians print
 * this at month-end to reconcile with physical cash on hand.
 *
 * Layout (matches the paper voucher book):
 *   Row 1..N  ledger entries (Date | Type | Ref | Description | In | Out | Balance)
 *   Totals    period totals (net movement + closing balance)
 *
 * The runner supports two modes:
 *   * `fundId` filter set → single-fund statement (custodian view)
 *   * no `fundId`         → all-funds combined, sorted by fund then
 *     date. Finance uses this to eyeball tenant-wide petty cash.
 *
 * Sign convention:
 *   Replenishments = "IN"  (cash coming into the fund)
 *   Vouchers       = "OUT" (cash leaving the fund)
 *   Balance is the running fund balance after applying the entry.
 *
 * Opening balance derivation:
 *   `petty_cash_funds.balance` is the *current* balance. To compute
 *   the balance at the start of the requested window we start from
 *   the current balance and roll it backwards through every entry
 *   AFTER `from`. This is O(n) in the number of entries and only
 *   requires one round-trip per fund, which is cheap enough for the
 *   monthly-statement use case.
 */
export async function runPettyCashStatement(
  filters: ReportBaseFilters,
): Promise<ReportResult> {
  const supabase = await createClient();

  // Fund set — one or many. Preserve order for the combined view.
  const fundQuery = supabase
    .from("petty_cash_funds")
    .select("id, location_name, balance, custodian:custodian_employee_id(full_name)")
    .eq("tenant_id", filters.tenantId)
    .order("location_name", { ascending: true });
  const { data: funds, error: fundErr } = filters.fundId
    ? await fundQuery.eq("id", filters.fundId)
    : await fundQuery;
  if (fundErr) throw new Error(`Fund lookup failed: ${fundErr.message}`);
  if (!funds || funds.length === 0) {
    return emptyStatement(filters);
  }

  const fundIds = funds.map((f) => f.id);

  // Vouchers (OUT) — every RECORDED voucher in the fund. Voided rows
  // are excluded from the statement because the underlying balance
  // never moved on their behalf.
  const { data: vouchers } = await supabase
    .from("petty_cash_vouchers")
    .select("id, fund_id, incurred_on, created_at, amount, category, description, status")
    .in("fund_id", fundIds)
    .eq("status", "RECORDED")
    .order("incurred_on", { ascending: true });

  // Replenishments (IN) — count once `DISBURSED`, that's when cash
  // physically moves into the fund. Pending/rejected rows are
  // ignored so the running balance matches physical count.
  const { data: replens } = await supabase
    .from("petty_cash_replenishments")
    .select(
      "id, fund_id, requested_amount, disbursed_at, disbursement_ref, reason, status",
    )
    .in("fund_id", fundIds)
    .eq("status", "DISBURSED")
    .order("disbursed_at", { ascending: true });

  const from = filters.from ?? null;
  const to = filters.to ?? null;

  const rows: ReportRow[] = [];
  let totalIn = 0;
  let totalOut = 0;

  for (const fund of funds) {
    const custodian = (fund.custodian as { full_name: string } | null)
      ?.full_name;

    // Collect ALL entries for this fund, ordered chronologically. We
    // need every entry (not just in-window) so we can rewind the
    // current balance to the opening balance.
    type Entry = {
      date: string;
      type: "IN" | "OUT";
      ref: string;
      description: string;
      inAmt: number;
      outAmt: number;
    };
    const entries: Entry[] = [];
    for (const v of vouchers ?? []) {
      if (v.fund_id !== fund.id) continue;
      entries.push({
        date: v.incurred_on ?? (v.created_at as string).slice(0, 10),
        type: "OUT",
        ref: v.category ?? "—",
        description: v.description ?? "—",
        inAmt: 0,
        outAmt: Number(v.amount ?? 0),
      });
    }
    for (const r of replens ?? []) {
      if (r.fund_id !== fund.id) continue;
      entries.push({
        date: (r.disbursed_at as string).slice(0, 10),
        type: "IN",
        ref: r.disbursement_ref ?? "REPLEN",
        description: r.reason ?? "Fund replenishment",
        inAmt: Number(r.requested_amount ?? 0),
        outAmt: 0,
      });
    }
    entries.sort((a, b) => a.date.localeCompare(b.date));

    // Rewind current balance through every entry AFTER `to` to get
    // the closing balance at the end of the requested window. Then
    // rewind further through every in-window entry to get the
    // opening balance.
    const currentBalance = Number(fund.balance ?? 0);
    let closing = currentBalance;
    if (to) {
      for (const e of entries) {
        if (e.date > to) {
          // Undo the effect: subtract IN, add back OUT.
          closing = closing - e.inAmt + e.outAmt;
        }
      }
    }
    let opening = closing;
    for (const e of entries) {
      if ((!from || e.date >= from) && (!to || e.date <= to)) {
        opening = opening - e.inAmt + e.outAmt;
      }
    }

    // Emit the opening row so the statement reads like a bank
    // statement.
    rows.push([
      `${fund.location_name}${custodian ? ` · ${custodian}` : ""}`,
      from ?? "—",
      "OPENING",
      "—",
      "Opening balance",
      null,
      null,
      opening,
    ]);

    // In-window entries, running balance updated per row.
    let running = opening;
    for (const e of entries) {
      if (from && e.date < from) continue;
      if (to && e.date > to) continue;
      running = running + e.inAmt - e.outAmt;
      totalIn += e.inAmt;
      totalOut += e.outAmt;
      rows.push([
        fund.location_name,
        e.date,
        e.type,
        e.ref,
        e.description,
        e.inAmt > 0 ? e.inAmt : null,
        e.outAmt > 0 ? e.outAmt : null,
        running,
      ]);
    }

    // Closing row.
    rows.push([
      `${fund.location_name} closing`,
      to ?? "—",
      "CLOSING",
      "—",
      "Closing balance",
      null,
      null,
      closing,
    ]);
  }

  const generatedAt = new Date().toISOString();
  const scopePieces: string[] = [
    filters.fundId ? "1 fund" : `${funds.length} funds`,
  ];
  if (from && to) scopePieces.unshift(`${from} → ${to}`);

  return {
    kind: "petty-cash-statement",
    title: "Petty Cash Statement",
    generatedAt,
    scopeSummary: scopePieces.join(" · "),
    columns: [
      { key: "fund", label: "Fund" },
      { key: "date", label: "Date", format: "date" },
      { key: "type", label: "Type", format: "status" },
      { key: "ref", label: "Ref / Cat", nowrap: true },
      { key: "description", label: "Description" },
      { key: "in", label: "In", format: "money", align: "right" },
      { key: "out", label: "Out", format: "money", align: "right" },
      { key: "balance", label: "Balance", format: "money", align: "right" },
    ],
    rows,
    totals: [
      "TOTAL (movements only)",
      null,
      null,
      null,
      null,
      totalIn,
      totalOut,
      null,
    ],
  };
}

function emptyStatement(filters: ReportBaseFilters): ReportResult {
  return {
    kind: "petty-cash-statement",
    title: "Petty Cash Statement",
    generatedAt: new Date().toISOString(),
    scopeSummary:
      filters.from && filters.to
        ? `${filters.from} → ${filters.to} · 0 funds`
        : "0 funds accessible",
    columns: [
      { key: "fund", label: "Fund" },
      { key: "date", label: "Date", format: "date" },
      { key: "type", label: "Type", format: "status" },
      { key: "ref", label: "Ref / Cat", nowrap: true },
      { key: "description", label: "Description" },
      { key: "in", label: "In", format: "money", align: "right" },
      { key: "out", label: "Out", format: "money", align: "right" },
      { key: "balance", label: "Balance", format: "money", align: "right" },
    ],
    rows: [],
  };
}
