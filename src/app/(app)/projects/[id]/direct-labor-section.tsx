import { getTranslations } from "next-intl/server";
import { HandCoins } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatIDR } from "@/lib/format/money";
import { getProjectDirectLaborCost } from "@/lib/payroll/direct-labor-data";

// ---------------------------------------------------------------------------
// Compute the current-month window (UTC-safe — display timezone conversion
// is a separate concern; DLC always aggregates against calendar month).
// ---------------------------------------------------------------------------
function currentMonthWindow(): { from: string; to: string; label: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed
  const first = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(y, m + 1, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const monthLabel = first.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return { from: iso(first), to: iso(last), label: monthLabel };
}

export async function ProjectDirectLaborSection({
  projectId,
}: {
  projectId: string;
}) {
  const [t, window] = await Promise.all([
    getTranslations("projects.directLabor"),
    Promise.resolve(currentMonthWindow()),
  ]);

  const dlc = await getProjectDirectLaborCost({
    projectId,
    from: window.from,
    to: window.to,
  });

  return (
    <Card className="glass">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HandCoins className="size-4" /> {t("title")}
            </CardTitle>
            <CardDescription>
              {t("subtitle", { period: window.label })}
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="label-meta">{t("total")}</p>
            <p className="font-display text-2xl font-semibold tabular-nums">
              {formatIDR(dlc.total_cost, { compact: true })}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Kpi
            label={t("baseCost")}
            value={formatIDR(dlc.base_cost, { compact: true })}
          />
          <Kpi
            label={t("overtimeCost")}
            value={formatIDR(dlc.overtime_cost, { compact: true })}
          />
          <Kpi
            label={t("weeklyShare")}
            value={`${dlc.provenance.weekly_share_pct.toFixed(1)}%`}
            help={t("weeklyShareHelp", {
              weekly: dlc.provenance.weekly_hours.toFixed(1),
              daily: dlc.provenance.daily_only_hours.toFixed(1),
            })}
          />
        </div>

        {dlc.employees.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {t("empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label={t("title")}>
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <Th>{t("columns.employee")}</Th>
                  <Th className="text-right">{t("columns.hoursWorked")}</Th>
                  <Th className="text-right">{t("columns.hoursOvertime")}</Th>
                  <Th className="text-right">{t("columns.rate")}</Th>
                  <Th className="text-right">{t("columns.cost")}</Th>
                  <Th>{t("columns.source")}</Th>
                </tr>
              </thead>
              <tbody>
                {dlc.employees.map((row) => {
                  const totalHours = row.hours_worked + row.hours_overtime;
                  const weeklyShare =
                    totalHours > 0
                      ? Math.round((row.weekly_hours / totalHours) * 100)
                      : 0;
                  return (
                    <tr
                      key={row.employee_id}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3">{row.full_name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.hours_worked.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {row.hours_overtime.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground text-xs">
                        {formatIDR(row.hourly_rate, { compact: true })}/hr
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        {formatIDR(row.total_cost, { compact: true })}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={
                            weeklyShare >= 50
                              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                              : weeklyShare > 0
                                ? "border-amber-400/30 bg-amber-500/10 text-amber-300"
                                : "border-white/10 bg-white/5 text-white/70"
                          }
                        >
                          {weeklyShare}% {t("weekly")}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Kpi({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help?: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
      <p className="label-meta text-[10px]">{label}</p>
      <p className="font-display text-lg font-semibold tabular-nums">
        {value}
      </p>
      {help ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">{help}</p>
      ) : null}
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
