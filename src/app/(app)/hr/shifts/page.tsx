import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarClock, ShieldCheck } from "lucide-react";
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
import { roleInGate, toCanonicalRole } from "@/lib/rbac/roles";
import { createClient } from "@/lib/supabase/server";
import { listAllShifts, type WorkShiftRow } from "@/lib/data/shifts";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";

import { ShiftUpsertSheet, type ShiftFormLabels } from "./shift-upsert-sheet";
import { ShiftRowActions } from "./shift-row-actions";

export const metadata: Metadata = { title: "Shifts" };

// Any role that can WRITE at least one scope of shift catalog. Read is
// unrestricted for authenticated tenant members (needed by roster
// form + timesheet lookups).
const CAN_MANAGE_ANY_SHIFT: readonly AnyDbEmployeeRole[] = [
  "HR_ADMIN",
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
  "HEAD_MANAGER",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "SUPERVISOR",
];

const HR_OM_ROLES: readonly AnyDbEmployeeRole[] = [
  "HR_ADMIN",
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
  "HEAD_MANAGER",
  "OPERATIONS_MANAGER",
];

async function loadMyProjectAssignments(
  employeeId: string,
): Promise<{ id: string; code: string; name: string }[]> {
  const supabase = await createClient();
  const [pmRes, empRes] = await Promise.all([
    supabase
      .from("project_pm_assignments")
      .select("project:project_id(id, code, name)")
      .eq("pm_employee_id", employeeId)
      .eq("status", "ACTIVE"),
    supabase
      .from("project_employee_assignments")
      .select("project:project_id(id, code, name)")
      .eq("employee_id", employeeId)
      .eq("status", "ACTIVE"),
  ]);

  const merged = new Map<string, { id: string; code: string; name: string }>();
  const collect = (rows: unknown) => {
    for (const row of (rows as Array<{ project: unknown }>) ?? []) {
      const p = row.project as { id?: string; code?: string; name?: string } | null;
      if (p?.id && p.code && p.name) {
        merged.set(p.id, { id: p.id, code: p.code, name: p.name });
      }
    }
  };
  collect(pmRes.data);
  collect(empRes.data);
  return [...merged.values()].sort((a, b) => a.code.localeCompare(b.code));
}

async function loadAllProjects(): Promise<
  { id: string; code: string; name: string }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("id, code, name")
    .order("code", { ascending: true })
    .limit(500);
  return (data ?? []) as { id: string; code: string; name: string }[];
}

export default async function ShiftsPage() {
  const employee = await requireCurrentEmployee();
  const role = employee.role as AnyDbEmployeeRole;
  if (!roleInGate(role, CAN_MANAGE_ANY_SHIFT)) {
    // 404 rather than 403 — keeps the URL undiscoverable to employees
    // without any shift-management authority.
    notFound();
  }

  const isHrOm = roleInGate(role, HR_OM_ROLES);
  const canonical = toCanonicalRole(employee.role as AnyDbEmployeeRole);

  const [shifts, projects, t] = await Promise.all([
    listAllShifts(),
    isHrOm
      ? loadAllProjects()
      : loadMyProjectAssignments(employee.id),
    getTranslations("shifts"),
  ]);

  const baseShifts = shifts.filter((s) => s.is_base_catalog);
  const projectShifts = shifts.filter((s) => !s.is_base_catalog);

  // Group project shifts by project for cleaner display.
  const byProject = new Map<
    string,
    { projectCode: string; projectName: string; rows: WorkShiftRow[] }
  >();
  for (const s of projectShifts) {
    const key = s.project_id!;
    const existing = byProject.get(key);
    if (existing) {
      existing.rows.push(s);
    } else {
      byProject.set(key, {
        projectCode: s.project_code ?? "—",
        projectName: s.project_name ?? "—",
        rows: [s],
      });
    }
  }

  const formLabels: ShiftFormLabels = {
    title: t("form.title"),
    description: t("form.description"),
    code: t("form.code"),
    codeHelp: t("form.codeHelp"),
    name: t("form.name"),
    startTime: t("form.startTime"),
    endTime: t("form.endTime"),
    duration: t("form.duration"),
    durationHelp: t("form.durationHelp"),
    isNight: t("form.isNight"),
    allowance: t("form.allowance"),
    allowanceHrOnly: t("form.allowanceHrOnly"),
    project: t("form.project"),
    projectPlaceholder: t("form.projectPlaceholder"),
    projectRequired: t("form.projectRequired"),
    baseCatalog: t("form.baseCatalog"),
    cancel: t("form.cancel"),
    save: t("form.save"),
    saving: t("form.saving"),
    successToast: t("form.successToast"),
    errorToast: t("form.errorToast"),
  };

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
        <ShiftUpsertSheet
          triggerLabel={t("actions.new")}
          isHrOm={isHrOm}
          projects={projects}
          labels={formLabels}
        />
      </header>

      {/* Governance banner — makes the SPV/PM boundary explicit */}
      <Card className="glass border-indigo-400/20 bg-indigo-500/5">
        <CardHeader className="flex-row items-start gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-indigo-500/15 text-indigo-300">
            <ShieldCheck className="size-5" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-base">{t("governance.title")}</CardTitle>
            <CardDescription>
              {isHrOm
                ? t("governance.bodyHrOm")
                : t("governance.bodyPmSpv")}
            </CardDescription>
          </div>
          <Badge variant="outline" className="uppercase tracking-wider">
            {canonical}
          </Badge>
        </CardHeader>
      </Card>

      {/* Base catalog section */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold">
            {t("sections.base")}
          </h2>
          <Badge variant="outline" className="text-xs">
            {baseShifts.length}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("sections.baseHint")}
        </p>
        {baseShifts.length === 0 ? (
          <Card className="glass">
            <CardHeader className="items-center text-center">
              <CalendarClock className="size-6 text-muted-foreground" />
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t("empty.base")}
              </CardTitle>
            </CardHeader>
          </Card>
        ) : (
          <ShiftTable
            rows={baseShifts}
            isHrOm={isHrOm}
            canEditRow={isHrOm}
            labels={formLabels}
            projects={projects}
            columns={{
              code: t("columns.code"),
              name: t("columns.name"),
              start: t("columns.start"),
              end: t("columns.end"),
              duration: t("columns.duration"),
              night: t("columns.night"),
              allowance: t("columns.allowance"),
              status: t("columns.status"),
              actions: t("columns.actions"),
              editSr: t("actions.edit"),
              deleteSr: t("actions.delete"),
              night_yes: t("badges.night_yes"),
              night_no: t("badges.night_no"),
              active: t("badges.active"),
              inactive: t("badges.inactive"),
              deleteConfirm: t("actions.deleteConfirm"),
              successDelete: t("actions.successDelete"),
              errorDelete: t("actions.errorDelete"),
            }}
          />
        )}
      </section>

      {/* Project overrides section */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold">
            {t("sections.projectOverrides")}
          </h2>
          <Badge variant="outline" className="text-xs">
            {projectShifts.length}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("sections.projectHint")}
        </p>

        {byProject.size === 0 ? (
          <Card className="glass">
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              {t("empty.projects")}
            </CardContent>
          </Card>
        ) : (
          [...byProject.values()].map((group) => (
            <div key={group.projectCode} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 pl-1">
                <span className="font-mono text-xs text-muted-foreground">
                  {group.projectCode}
                </span>
                <span className="text-sm text-foreground/80">
                  {group.projectName}
                </span>
              </div>
              <ShiftTable
                rows={group.rows}
                isHrOm={isHrOm}
                canEditRow={
                  isHrOm ||
                  Boolean(
                    projects.find((p) => p.id === group.rows[0].project_id),
                  )
                }
                labels={formLabels}
                projects={projects}
                columns={{
                  code: t("columns.code"),
                  name: t("columns.name"),
                  start: t("columns.start"),
                  end: t("columns.end"),
                  duration: t("columns.duration"),
                  night: t("columns.night"),
                  allowance: t("columns.allowance"),
                  status: t("columns.status"),
                  actions: t("columns.actions"),
                  editSr: t("actions.edit"),
                  deleteSr: t("actions.delete"),
                  night_yes: t("badges.night_yes"),
                  night_no: t("badges.night_no"),
                  active: t("badges.active"),
                  inactive: t("badges.inactive"),
                  deleteConfirm: t("actions.deleteConfirm"),
                  successDelete: t("actions.successDelete"),
                  errorDelete: t("actions.errorDelete"),
                }}
              />
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function ShiftTable({
  rows,
  isHrOm,
  canEditRow,
  labels,
  projects,
  columns,
}: {
  rows: WorkShiftRow[];
  isHrOm: boolean;
  canEditRow: boolean;
  labels: ShiftFormLabels;
  projects: { id: string; code: string; name: string }[];
  columns: {
    code: string;
    name: string;
    start: string;
    end: string;
    duration: string;
    night: string;
    allowance: string;
    status: string;
    actions: string;
    editSr: string;
    deleteSr: string;
    night_yes: string;
    night_no: string;
    active: string;
    inactive: string;
    deleteConfirm: string;
    successDelete: string;
    errorDelete: string;
  };
}) {
  const idrFmt = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  });
  return (
    <Card className="glass overflow-hidden">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <Th>{columns.code}</Th>
                <Th>{columns.name}</Th>
                <Th>{columns.start}</Th>
                <Th>{columns.end}</Th>
                <Th>{columns.duration}</Th>
                <Th>{columns.night}</Th>
                <Th>{columns.allowance}</Th>
                <Th>{columns.status}</Th>
                <Th className="text-right">{columns.actions}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs">{row.code}</td>
                  <td className="px-4 py-3">{row.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {row.start_time}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {row.end_time}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {row.duration_hours}h
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className={
                        row.is_night
                          ? "border-indigo-400/30 bg-indigo-500/10 text-indigo-300"
                          : "border-white/10 bg-white/5 text-white/70"
                      }
                    >
                      {row.is_night ? columns.night_yes : columns.night_no}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {idrFmt.format(row.shift_allowance_idr)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className={
                        row.is_active
                          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                          : "border-white/10 bg-white/5 text-white/70"
                      }
                    >
                      {row.is_active ? columns.active : columns.inactive}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEditRow ? (
                      <ShiftRowActions
                        row={row}
                        isHrOm={isHrOm}
                        projects={projects}
                        labels={labels}
                        deleteLabel={columns.deleteSr}
                        editLabel={columns.editSr}
                        deleteConfirm={columns.deleteConfirm}
                        successDelete={columns.successDelete}
                        errorDelete={columns.errorDelete}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
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
