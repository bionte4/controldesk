import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Banknote } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatIDR, parseMoneyFromDb } from "@/lib/format/money";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { resolveCapabilitiesFor } from "@/lib/rbac/capability-resolver";
import { createClient } from "@/lib/supabase/server";
import type { PayrollPeriodStatus } from "@/types/database";

import {
  FinalizePeriodButton,
  GeneratePayrollPeriodButton,
} from "./generate-period-buttons";

export const metadata: Metadata = {
  title: "Payroll",
};

type PeriodRow = {
  id: string;
  period_year: number;
  period_month: number;
  status: PayrollPeriodStatus;
  gross_total: string;
  net_total: string;
  line_count: number;
  /** Percent of approved hours (0..100) sourced from an APPROVED weekly packet. */
  weekly_share_pct: number;
  /** Absolute hours from weekly packets — helpful tooltip data. */
  weekly_hours: number;
  daily_only_hours: number;
};

type LineRow = {
  id: string;
  period_id: string;
  employee_name: string;
  hours_worked: string;
  hours_overtime: string;
  base_salary: string;
  overtime_pay: string;
  shift_allowance: string;
  gross_pay: string;
  net_pay: string;
};

type PeriodRaw = {
  id: string;
  period_year: number;
  period_month: number;
  status: PayrollPeriodStatus;
};

type LineRaw = {
  id: string;
  period_id: string;
  hours_worked: string;
  hours_overtime: string;
  base_salary: string;
  overtime_pay: string;
  shift_allowance: string;
  gross_pay: string;
  net_pay: string;
  employee: { full_name: string } | null;
};

async function loadData(): Promise<{
  periods: PeriodRow[];
  linesByPeriod: Record<string, LineRow[]>;
}> {
  const supabase = await createClient();
  const { data: periodsRaw } = await supabase
    .from("payroll_periods")
    .select("id, period_year, period_month, status")
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false })
    .limit(12);

  const periodIds = (periodsRaw ?? []).map((p) => p.id);
  const { data: linesRaw } = periodIds.length
    ? await supabase
        .from("payroll_lines")
        .select(
          "id, period_id, hours_worked, hours_overtime, base_salary, overtime_pay, shift_allowance, gross_pay, net_pay, employee:employee_id(full_name)",
        )
        .in("period_id", periodIds)
        .order("net_pay", { ascending: false })
    : { data: [] };

  const linesTyped = (linesRaw as unknown as LineRaw[]) ?? [];

  const linesByPeriod: Record<string, LineRow[]> = {};
  for (const l of linesTyped) {
    const row: LineRow = {
      id: l.id,
      period_id: l.period_id,
      employee_name: l.employee?.full_name ?? "—",
      hours_worked: l.hours_worked,
      hours_overtime: l.hours_overtime,
      base_salary: l.base_salary,
      overtime_pay: l.overtime_pay,
      shift_allowance: l.shift_allowance,
      gross_pay: l.gross_pay,
      net_pay: l.net_pay,
    };
    (linesByPeriod[row.period_id] ??= []).push(row);
  }

  // Provenance: for each period, compute how many approved hours were
  // sourced from an APPROVED weekly packet (GAS §27) vs. legacy per-day
  // approvals. Runs one bounded query joining timesheets with their week.
  const provenanceByPeriodKey = new Map<
    string, // `${year}-${month}`
    { weekly: number; daily: number }
  >();
  if ((periodsRaw ?? []).length > 0) {
    // Compute [minStart, maxEnd] to bound the query.
    let minStart = "9999-12-31";
    let maxEnd = "0000-01-01";
    for (const p of periodsRaw ?? []) {
      const s = new Date(Date.UTC(p.period_year, p.period_month - 1, 1));
      const e = new Date(Date.UTC(p.period_year, p.period_month, 0));
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      if (iso(s) < minStart) minStart = iso(s);
      if (iso(e) > maxEnd) maxEnd = iso(e);
    }
    type Row = {
      work_date: string;
      hours_worked: string;
      hours_overtime: string;
      week: { status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" } | null;
    };
    const { data: tsRaw } = await supabase
      .from("timesheets")
      .select(
        "work_date, hours_worked, hours_overtime, week:timesheet_weeks!timesheets_week_id_fkey(status)",
      )
      .eq("status", "APPROVED")
      .gte("work_date", minStart)
      .lte("work_date", maxEnd)
      .limit(20_000);
    for (const r of (tsRaw ?? []) as unknown as Row[]) {
      const d = new Date(`${r.work_date}T00:00:00Z`);
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;
      const cur = provenanceByPeriodKey.get(key) ?? { weekly: 0, daily: 0 };
      const hrs =
        Number(r.hours_worked ?? 0) + Number(r.hours_overtime ?? 0);
      if (r.week && r.week.status === "APPROVED") {
        cur.weekly += hrs;
      } else {
        cur.daily += hrs;
      }
      provenanceByPeriodKey.set(key, cur);
    }
  }

  const periods: PeriodRow[] = ((periodsRaw as PeriodRaw[]) ?? []).map((p) => {
    const lines = linesByPeriod[p.id] ?? [];
    let gross = 0n;
    let net = 0n;
    for (const l of lines) {
      gross += parseMoneyFromDb(l.gross_pay);
      net += parseMoneyFromDb(l.net_pay);
    }
    const prov = provenanceByPeriodKey.get(
      `${p.period_year}-${p.period_month}`,
    ) ?? { weekly: 0, daily: 0 };
    const totalHrs = prov.weekly + prov.daily;
    const share = totalHrs > 0 ? (prov.weekly / totalHrs) * 100 : 0;
    return {
      id: p.id,
      period_year: p.period_year,
      period_month: p.period_month,
      status: p.status,
      gross_total: gross.toString(),
      net_total: net.toString(),
      line_count: lines.length,
      weekly_share_pct: Math.round(share * 10) / 10,
      weekly_hours: Math.round(prov.weekly * 100) / 100,
      daily_only_hours: Math.round(prov.daily * 100) / 100,
    };
  });

  return { periods, linesByPeriod };
}

const STATUS_TONE: Record<PayrollPeriodStatus, string> = {
  DRAFT: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  FINALIZED: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
};

function monthName(month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long" }).format(
    new Date(2000, month - 1, 1),
  );
}

export default async function PayrollPage() {
  await requireCurrentEmployee();
  const capabilities = await resolveCapabilitiesFor();
  if (!capabilities.can("view_payroll")) {
    redirect("/dashboard?error=forbidden");
  }

  const [{ periods, linesByPeriod }, t, tStatus] = await Promise.all([
    loadData(),
    getTranslations("payroll"),
    getTranslations("payroll.status"),
  ]);

  const today = new Date();
  const currentYear = today.getUTCFullYear();
  const currentMonth = today.getUTCMonth() + 1;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t("subtitle")}
          </p>
        </div>
        <GeneratePayrollPeriodButton
          year={currentYear}
          month={currentMonth}
          label={t("actions.generate", {
            month: monthName(currentMonth, "id-ID"),
            year: currentYear,
          })}
          loadingLabel={t("actions.generating")}
          successLabel={t("actions.generateSuccess")}
          errorLabel={t("actions.generateError")}
        />
      </header>

      {periods.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Banknote className="size-6" />
            </div>
            <CardTitle className="font-display text-xl">
              {t("empty")}
            </CardTitle>
            <CardDescription className="max-w-md text-center">
              {t("emptyBody")}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4">
          {periods.map((p) => (
            <Card key={p.id} className="glass">
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="font-display">
                    {monthName(p.period_month, "id-ID")} {p.period_year}
                  </CardTitle>
                  <CardDescription>
                    {t("period.summary", {
                      count: p.line_count,
                      gross: formatIDR(parseMoneyFromDb(p.gross_total)),
                      net: formatIDR(parseMoneyFromDb(p.net_total)),
                    })}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {p.weekly_hours + p.daily_only_hours > 0 ? (
                    <Badge
                      variant="outline"
                      className={
                        p.weekly_share_pct >= 75
                          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                          : p.weekly_share_pct >= 25
                            ? "border-amber-400/30 bg-amber-500/10 text-amber-300"
                            : "border-white/10 bg-white/5 text-white/70"
                      }
                      title={t("weeklyShareTooltip", {
                        weekly: p.weekly_hours.toFixed(1),
                        daily: p.daily_only_hours.toFixed(1),
                      })}
                    >
                      {t("weeklyShareBadge", {
                        pct: p.weekly_share_pct.toFixed(1),
                      })}
                    </Badge>
                  ) : null}
                  <Badge
                    variant="outline"
                    className={STATUS_TONE[p.status]}
                  >
                    {tStatus(p.status)}
                  </Badge>
                  {p.status === "DRAFT" ? (
                    <FinalizePeriodButton
                      id={p.id}
                      label={t("actions.finalize")}
                      successLabel={t("actions.finalizeSuccess")}
                      errorLabel={t("actions.finalizeError")}
                    />
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr className="text-left">
                        <Th>{t("columns.employee")}</Th>
                        <Th className="text-right">{t("columns.hours")}</Th>
                        <Th className="text-right">{t("columns.overtime")}</Th>
                        <Th className="text-right">{t("columns.base")}</Th>
                        <Th className="text-right">
                          {t("columns.overtimePay")}
                        </Th>
                        <Th className="text-right">{t("columns.allowance")}</Th>
                        <Th className="text-right">{t("columns.gross")}</Th>
                        <Th className="text-right">{t("columns.net")}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {(linesByPeriod[p.id] ?? []).map((l) => (
                        <tr
                          key={l.id}
                          className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-3">{l.employee_name}</td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {Number(l.hours_worked).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {Number(l.hours_overtime).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatIDR(parseMoneyFromDb(l.base_salary))}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatIDR(parseMoneyFromDb(l.overtime_pay))}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {formatIDR(parseMoneyFromDb(l.shift_allowance))}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-medium">
                            {formatIDR(parseMoneyFromDb(l.gross_pay))}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-300">
                            {formatIDR(parseMoneyFromDb(l.net_pay))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`label-meta px-4 py-3 text-xs font-medium text-muted-foreground ${className ?? ""}`}
    >
      {children}
    </th>
  );
}
