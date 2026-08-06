import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { listWeeklyTimesheets } from "@/lib/timesheets/week-data";
import {
  TW_STATUS_TONE,
  weekStartFromDate,
  weekEndFromStart,
} from "@/lib/timesheets/week-state";
import type { TimesheetStatus } from "@/types/database";

export const metadata: Metadata = {
  title: "Weekly timesheets",
};

const STATUS_LABEL: Record<TimesheetStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export default async function WeeklyTimesheetsPage() {
  const [employee, t, weeks] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("timesheets"),
    listWeeklyTimesheets({ limit: 100 }),
  ]);

  const todayWeek = weekStartFromDate(new Date());

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("weekly.title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t("weekly.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" render={<Link href="/hr/timesheets" />}>
            {t("weekly.dailyView")}
          </Button>
          <Button size="sm" render={<Link href={`/hr/timesheets/weekly/${todayWeek}`} />}>
            {t("weekly.newForCurrentWeek", { week: todayWeek })}
          </Button>
        </div>
      </header>

      {weeks.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <ClipboardCheck className="size-6" />
            </div>
            <CardTitle className="font-display text-xl">
              {t("weekly.empty")}
            </CardTitle>
            <CardDescription className="max-w-md text-center">
              {t("weekly.emptyBody")}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card className="glass overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label={t("weekly.title")}>
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <Th>{t("weekly.columns.week")}</Th>
                    <Th>{t("weekly.columns.employee")}</Th>
                    <Th className="text-right">{t("weekly.columns.hours")}</Th>
                    <Th className="text-right">
                      {t("weekly.columns.overtime")}
                    </Th>
                    <Th>{t("weekly.columns.status")}</Th>
                    <Th className="text-right">
                      {t("weekly.columns.actions")}
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w) => {
                    const end = weekEndFromStart(w.week_start_date);
                    const isSelf = w.employee_id === employee.id;
                    return (
                      <tr
                        key={w.id}
                        className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <Link
                            className="font-medium underline-offset-2 hover:underline"
                            href={`/hr/timesheets/weekly/${w.week_start_date}${isSelf ? "" : `?employee_id=${w.employee_id}`}`}
                          >
                            {w.week_start_date} → {end}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          {w.employee?.full_name ?? "—"}
                          <span className="text-xs text-muted-foreground ml-1">
                            ({w.employee?.role ?? "—"})
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {Number(w.total_hours).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {Number(w.total_overtime).toFixed(2)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={TW_STATUS_TONE[w.status]}
                          >
                            {STATUS_LABEL[w.status]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                            href={`/hr/timesheets/weekly/${w.week_start_date}${isSelf ? "" : `?employee_id=${w.employee_id}`}`}
                          >
                            {t("weekly.open")}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
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
