import type { Metadata } from "next";
import { CalendarDays, Pencil } from "lucide-react";
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
import { loadActiveProjectIdsByEmployee } from "@/lib/data/assignments";
import { createClient } from "@/lib/supabase/server";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";
import {
  isApproverRole,
  resolveEmployeeScope,
  resolveProjectScope,
} from "@/lib/security/project-scope";
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
  employee_id: string;
  employee_name: string;
  shift_id: string;
  shift_code: string;
  project_id: string | null;
  project_name: string | null;
  work_date: string;
  status: RosterEntryStatus;
  notes: string | null;
};

type RawRow = {
  id: string;
  work_date: string;
  status: RosterEntryStatus;
  notes: string | null;
  employee_id: string;
  shift_id: string;
  project_id: string | null;
  employee: { full_name: string } | null;
  shift: { code: string } | null;
  project: { code: string; name: string } | null;
};

async function loadRoster(
  caller: { id: string; role: AnyDbEmployeeRole },
): Promise<Row[]> {
  const supabase = await createClient();
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 3);
  const to = new Date(today);
  to.setDate(to.getDate() + 14);

  const iso = (d: Date) => d.toISOString().slice(0, 10);

  // Roster reveals LEAVE / SICK / OFF alongside project assignments —
  // it's a two-way PII leak (calendar + medical inference) if a plain
  // Employee can see the whole crew's day. Rules §3 splits the visible
  // set the same way `/hr/employees` and `/hr/requests` do:
  //   • Org roles (HR / OM+ / Admin) — full tenant.
  //   • Approvers (SPV / PM / FIN) — self + teammates on assigned
  //     projects (via `resolveEmployeeScope`).
  //   • Non-approvers — only their own row.
  const scope = await resolveEmployeeScope(caller);
  const approver = isApproverRole(caller.role);

  let query = supabase
    .from("employee_rosters")
    .select(
      "id, work_date, status, notes, employee_id, shift_id, project_id, employee:employee_id(full_name), shift:shift_id(code), project:project_id(code, name)",
    )
    .gte("work_date", iso(from))
    .lte("work_date", iso(to))
    .order("work_date", { ascending: true })
    .limit(400);

  if (scope.kind !== "org") {
    if (!approver || scope.ids.length === 0) {
      query = query.eq("employee_id", caller.id);
    } else {
      query = query.in("employee_id", scope.ids);
    }
  }

  const { data, error } = await query;
  if (error || !data) return [];
  const rows = data as unknown as RawRow[];
  return rows.map((row) => ({
    id: row.id,
    employee_id: row.employee_id,
    shift_id: row.shift_id,
    project_id: row.project_id,
    work_date: row.work_date,
    status: row.status,
    notes: row.notes,
    employee_name: row.employee?.full_name ?? "—",
    shift_code: row.shift?.code ?? "—",
    project_name: row.project ? `${row.project.code} · ${row.project.name}` : null,
  }));
}

async function loadOptions(caller: { id: string; role: AnyDbEmployeeRole }) {
  const supabase = await createClient();
  const [empScope, projScope] = await Promise.all([
    resolveEmployeeScope(caller),
    resolveProjectScope(caller),
  ]);

  const empQuery = (() => {
    let q = supabase
      .from("employees")
      .select("id, full_name, role")
      .eq("is_active", true)
      .order("full_name", { ascending: true })
      .limit(200);
    if (empScope.kind !== "org") {
      if (empScope.ids.length === 0) {
        // Scoped caller with empty ids would leak everyone via
        // supabase-js `.in("id", [])` bypass — pin to self.
        q = q.eq("id", caller.id);
      } else {
        q = q.in("id", empScope.ids);
      }
    }
    return q;
  })();

  const projQuery = (() => {
    let q = supabase
      .from("projects")
      .select("id, code, name")
      .order("code", { ascending: true })
      .limit(200);
    if (projScope.kind !== "org") {
      if (projScope.empty) {
        // No visible projects → empty picker rather than tenant leak.
        q = q.eq("id", "00000000-0000-0000-0000-000000000000");
      } else {
        q = q.in("id", projScope.projectIds);
      }
    }
    return q;
  })();

  const [emps, shifts, projects] = await Promise.all([
    empQuery,
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
    projQuery,
  ]);

  type ShiftRow = {
    id: string;
    code: string;
    name: string;
    project_id: string | null;
    project: { code: string } | null;
  };
  const shiftRows = (shifts.data ?? []) as unknown as ShiftRow[];

  const employeeRows = (emps.data ?? []) as Array<{
    id: string;
    full_name: string;
    role: string;
  }>;

  // Batch-load each visible employee's ACTIVE project assignments so
  // the roster form can filter the project dropdown to just the
  // proyek the picked employee is actually on. Server-side we still
  // enforce this in `upsertRosterEntryAction` — this map is UX
  // polish (dropdown never contains a project that would be rejected).
  const empIds = employeeRows.map((e) => e.id);
  const assignmentMap = await loadActiveProjectIdsByEmployee(empIds);
  const allowedProjectIdsByEmployee: Record<string, string[]> = {};
  for (const [empId, set] of assignmentMap.entries()) {
    allowedProjectIdsByEmployee[empId] = Array.from(set);
  }

  return {
    employees: employeeRows.map((e) => ({
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
    allowedProjectIdsByEmployee,
  };
}

const STATUS_TONE: Record<RosterEntryStatus, string> = {
  PLANNED: "border-indigo-400/30 bg-indigo-500/10 text-indigo-300",
  LEAVE: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  SICK: "border-rose-400/30 bg-rose-500/10 text-rose-300",
  OFF: "border-white/10 bg-white/5 text-white/70",
};

export default async function RosterPage() {
  const employee = await requireCurrentEmployee();
  const caller = {
    id: employee.id,
    role: employee.role as AnyDbEmployeeRole,
  };
  const [rows, options, t, tStatus] = await Promise.all([
    loadRoster(caller),
    loadOptions(caller),
    getTranslations("roster"),
    getTranslations("roster.statuses"),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  // Non-approver roles can view their own roster but cannot upsert
  // anyone's — PDP would reject the mutation anyway, so we suppress
  // the "New" button rather than dangle a dead form.
  const canManageRoster = isApproverRole(caller.role);

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
        {canManageRoster ? (
        <RosterUpsertSheet
          triggerLabel={t("actions.new")}
          title={t("form.title")}
          description={t("form.description")}
          employees={options.employees}
          shifts={options.shifts}
          projects={options.projects}
          allowedProjectIdsByEmployee={options.allowedProjectIdsByEmployee}
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
        ) : null}
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
                    {canManageRoster ? <Th className="text-right">·</Th> : null}
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
                      {canManageRoster ? (
                        <td className="px-2 py-2 text-right">
                          <RosterUpsertSheet
                            triggerNode={
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={t("actions.edit")}
                              >
                                <Pencil className="size-4" />
                              </Button>
                            }
                            title={t("form.editTitle")}
                            description={t("form.editDescription")}
                            employees={options.employees}
                            shifts={options.shifts}
                            projects={options.projects}
                            allowedProjectIdsByEmployee={
                              options.allowedProjectIdsByEmployee
                            }
                            defaultDate={today}
                            initial={{
                              employee_id: r.employee_id,
                              shift_id: r.shift_id,
                              project_id: r.project_id,
                              work_date: r.work_date,
                              status: r.status,
                              notes: r.notes,
                            }}
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
                              successToast: t("form.updatedToast"),
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
                        </td>
                      ) : null}
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
