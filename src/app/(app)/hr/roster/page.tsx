import type { Metadata } from "next";
import { CalendarDays } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { RosterEntryStatus } from "@/types/database";

import { RosterUpsertSheet } from "./roster-upsert-sheet";

export const metadata: Metadata = {
  title: "Roster",
};

const ROSTER_STATUSES: readonly RosterEntryStatus[] = [
  "PLANNED",
  "LEAVE",
  "SICK",
  "OFF",
] as const;

type Row = {
  id: string;
  employee_name: string;
  shift_code: string;
  project_name: string | null;
  work_date: string;
  status: RosterEntryStatus;
};

type RawRow = {
  id: string;
  work_date: string;
  status: RosterEntryStatus;
  employee: { full_name: string } | null;
  shift: { code: string } | null;
  project: { code: string; name: string } | null;
};

async function loadRoster(): Promise<Row[]> {
  const supabase = await createClient();
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 3);
  const to = new Date(today);
  to.setDate(to.getDate() + 14);

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("employee_rosters")
    .select(
      "id, work_date, status, employee:employee_id(full_name), shift:shift_id(code), project:project_id(code, name)",
    )
    .gte("work_date", iso(from))
    .lte("work_date", iso(to))
    .order("work_date", { ascending: true })
    .limit(400);
  if (error || !data) return [];
  const rows = data as unknown as RawRow[];
  return rows.map((row) => ({
    id: row.id,
    work_date: row.work_date,
    status: row.status,
    employee_name: row.employee?.full_name ?? "—",
    shift_code: row.shift?.code ?? "—",
    project_name: row.project ? `${row.project.code} · ${row.project.name}` : null,
  }));
}

async function loadOptions() {
  const supabase = await createClient();
  const [emps, shifts, projects] = await Promise.all([
    supabase
      .from("employees")
      .select("id, full_name, role")
      .eq("is_active", true)
      .order("full_name", { ascending: true })
      .limit(200),
    // Return base + project shifts in one query — the form filters
    // client-side based on the selected project. Includes `project_id`
    // + `project.code` so the dropdown can show "Custom" tags for
    // project-scoped rows.
    supabase
      .from("work_shifts")
      .select(
        "id, code, name, project_id, project:project_id(code)",
      )
      .eq("is_active", true)
      .order("project_id", { ascending: true, nullsFirst: true })
      .order("code", { ascending: true })
      .limit(500),
    supabase
      .from("projects")
      .select("id, code, name")
      .order("code", { ascending: true })
      .limit(200),
  ]);

  type ShiftRow = {
    id: string;
    code: string;
    name: string;
    project_id: string | null;
    project: { code: string } | null;
  };
  const shiftRows = (shifts.data ?? []) as unknown as ShiftRow[];

  return {
    employees: (emps.data ?? []).map((e) => ({
      value: e.id,
      label: `${e.full_name} · ${e.role}`,
    })),
    shifts: shiftRows.map((s) => ({
      value: s.id,
      label: `${s.code} — ${s.name}`,
      projectId: s.project_id,
      projectCode: s.project?.code ?? null,
    })),
    projects: (projects.data ?? []).map((p) => ({
      value: p.id,
      label: `${p.code} — ${p.name}`,
    })),
  };
}

const STATUS_TONE: Record<RosterEntryStatus, string> = {
  PLANNED: "border-indigo-400/30 bg-indigo-500/10 text-indigo-300",
  LEAVE: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  SICK: "border-rose-400/30 bg-rose-500/10 text-rose-300",
  OFF: "border-white/10 bg-white/5 text-white/70",
};

export default async function RosterPage() {
  const [employee, rows, options, t, tStatus] = await Promise.all([
    requireCurrentEmployee(),
    loadRoster(),
    loadOptions(),
    getTranslations("roster"),
    getTranslations("roster.statuses"),
  ]);
  void employee;

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
        <RosterUpsertSheet
          triggerLabel={t("actions.new")}
          title={t("form.title")}
          description={t("form.description")}
          employees={options.employees}
          shifts={options.shifts}
          projects={options.projects}
          defaultDate={today}
          labels={{
            employee: t("form.employee"),
            shift: t("form.shift"),
            project: t("form.project"),
            workDate: t("form.workDate"),
            status: t("form.status"),
            notes: t("form.notes"),
            notesPlaceholder: t("form.notesPlaceholder"),
            cancel: t("form.cancel"),
            save: t("form.save"),
            saving: t("form.saving"),
            successToast: t("form.successToast"),
            errorToast: t("form.errorToast"),
            unassigned: t("form.unassigned"),
            statuses: {
              PLANNED: tStatus("PLANNED"),
              LEAVE: tStatus("LEAVE"),
              SICK: tStatus("SICK"),
              OFF: tStatus("OFF"),
            },
          }}
        />
      </header>

      {rows.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <CalendarDays className="size-6" />
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
                    <Th>{t("columns.shift")}</Th>
                    <Th>{t("columns.project")}</Th>
                    <Th>{t("columns.status")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {r.work_date}
                      </td>
                      <td className="px-4 py-3">{r.employee_name}</td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {r.shift_code}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {r.project_name ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={STATUS_TONE[r.status]}>
                          {tStatus(r.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="sr-only">{ROSTER_STATUSES.join(",")}</p>
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
