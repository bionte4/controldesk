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
import type { EmployeeRole } from "@/lib/rbac/roles";
import { createClient } from "@/lib/supabase/server";
import {
  TS_STATUS_LABEL,
  TS_STATUS_TONE,
  canApproveTimesheet,
} from "@/lib/timesheets/state";
import type { TimesheetStatus } from "@/types/database";

import { NewTimesheetSheet } from "./new-timesheet-sheet";
import { TimesheetActionButtons } from "./timesheet-action-buttons";

export const metadata: Metadata = {
  title: "Timesheets",
};

type Row = {
  id: string;
  work_date: string;
  employee_id: string;
  employee_name: string;
  project_name: string | null;
  hours_worked: number;
  hours_overtime: number;
  status: TimesheetStatus;
};

type RawRow = {
  id: string;
  work_date: string;
  employee_id: string;
  hours_worked: string;
  hours_overtime: string;
  status: TimesheetStatus;
  employee: { full_name: string } | null;
  project: { code: string; name: string } | null;
};

async function loadTimesheets(): Promise<Row[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timesheets")
    .select(
      "id, work_date, employee_id, hours_worked, hours_overtime, status, employee:employee_id(full_name), project:project_id(code, name)",
    )
    .order("work_date", { ascending: false })
    .limit(200);
  if (error || !data) return [];
  const rows = data as unknown as RawRow[];
  return rows.map((row) => ({
    id: row.id,
    work_date: row.work_date,
    employee_id: row.employee_id,
    hours_worked: Number(row.hours_worked ?? 0),
    hours_overtime: Number(row.hours_overtime ?? 0),
    status: row.status,
    employee_name: row.employee?.full_name ?? "—",
    project_name: row.project ? `${row.project.code}` : null,
  }));
}

async function loadOptions() {
  const supabase = await createClient();
  const [emps, projects] = await Promise.all([
    supabase
      .from("employees")
      .select("id, full_name, role")
      .eq("is_active", true)
      .order("full_name", { ascending: true })
      .limit(200),
    supabase
      .from("projects")
      .select("id, code, name")
      .order("code", { ascending: true })
      .limit(200),
  ]);
  return {
    employees: (emps.data ?? []).map((e) => ({
      value: e.id,
      label: `${e.full_name} · ${e.role}`,
    })),
    projects: (projects.data ?? []).map((p) => ({
      value: p.id,
      label: `${p.code} — ${p.name}`,
    })),
  };
}

export default async function TimesheetsPage() {
  const [employee, rows, options, t] = await Promise.all([
    requireCurrentEmployee(),
    loadTimesheets(),
    loadOptions(),
    getTranslations("timesheets"),
  ]);

  const today = new Date().toISOString().slice(0, 10);

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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href="/hr/timesheets/weekly" />}
          >
            {t("weekly.viewLink")}
          </Button>
          <NewTimesheetSheet
          triggerLabel={t("actions.new")}
          title={t("form.title")}
          description={t("form.description")}
          currentEmployeeId={employee.id}
          employees={options.employees}
          projects={options.projects}
          defaultDate={today}
          labels={{
            employee: t("form.employee"),
            project: t("form.project"),
            workDate: t("form.workDate"),
            hoursWorked: t("form.hoursWorked"),
            hoursOvertime: t("form.hoursOvertime"),
            notes: t("form.notes"),
            notesPlaceholder: t("form.notesPlaceholder"),
            cancel: t("form.cancel"),
            submit: t("form.submit"),
            submitting: t("form.submitting"),
            successToast: t("form.successToast"),
            errorToast: t("form.errorToast"),
            unassigned: t("form.unassigned"),
          }}
        />
        </div>
      </header>

      {rows.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <ClipboardCheck className="size-6" />
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
        <Card className="glass overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <Th>{t("columns.date")}</Th>
                    <Th>{t("columns.employee")}</Th>
                    <Th>{t("columns.project")}</Th>
                    <Th className="text-right">{t("columns.hours")}</Th>
                    <Th className="text-right">{t("columns.overtime")}</Th>
                    <Th>{t("columns.status")}</Th>
                    <Th className="text-right">{t("columns.actions")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const canAct = canApproveTimesheet(
                      employee.role as EmployeeRole,
                      r.status,
                    );
                    return (
                      <tr
                        key={r.id}
                        className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {r.work_date}
                        </td>
                        <td className="px-4 py-3">{r.employee_name}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {r.project_name ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {r.hours_worked.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {r.hours_overtime.toFixed(2)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={TS_STATUS_TONE[r.status]}
                          >
                            {TS_STATUS_LABEL[r.status]}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end">
                            {canAct ? (
                              <TimesheetActionButtons id={r.id} />
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                —
                              </span>
                            )}
                          </div>
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
