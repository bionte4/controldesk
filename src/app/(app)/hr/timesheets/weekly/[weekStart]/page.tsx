import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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
import type { EmployeeRole } from "@/lib/rbac/roles";
import { createClient } from "@/lib/supabase/server";
import {
  findWeekByEmployeeAndStart,
  type WeekDetail,
} from "@/lib/timesheets/week-data";
import {
  TW_STATUS_TONE,
  canApproveWeek,
  isIsoMonday,
  weekDatesFromStart,
  weekEndFromStart,
} from "@/lib/timesheets/week-state";
import type { TimesheetStatus } from "@/types/database";

import { WeeklyTimesheetEditor } from "./weekly-editor";
import { WeeklyReviewButtons } from "./weekly-review-buttons";

export const metadata: Metadata = {
  title: "Weekly timesheet",
};

const STATUS_LABEL: Record<TimesheetStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

type PageProps = {
  params: Promise<{ weekStart: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function WeeklyEditorPage({ params, searchParams }: PageProps) {
  const [{ weekStart }, search, t] = await Promise.all([
    params,
    searchParams,
    getTranslations("timesheets"),
  ]);

  if (!isIsoMonday(weekStart)) {
    notFound();
  }

  const currentEmployee = await requireCurrentEmployee();
  const requestedEmployeeId =
    typeof search.employee_id === "string" && search.employee_id
      ? search.employee_id
      : currentEmployee.id;

  const [existing, projects] = await Promise.all([
    findWeekByEmployeeAndStart({
      employeeId: requestedEmployeeId,
      weekStartDate: weekStart,
    }),
    loadProjectOptions(requestedEmployeeId),
  ]);

  const isSelf = requestedEmployeeId === currentEmployee.id;
  const days = weekDatesFromStart(weekStart);
  const dayDefaults = buildDayDefaults(days, existing);
  const editable = isSelf && (!existing || existing.status === "DRAFT" || existing.status === "REJECTED");
  const canReview =
    !isSelf &&
    !!existing &&
    canApproveWeek(currentEmployee.role as EmployeeRole, existing.status);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("weekly.editor.title", { start: weekStart, end: weekEndFromStart(weekStart) })}
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t("weekly.editor.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {existing ? (
            <Badge
              variant="outline"
              className={TW_STATUS_TONE[existing.status]}
            >
              {STATUS_LABEL[existing.status]}
            </Badge>
          ) : null}
          <Link
            href="/hr/timesheets/weekly"
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            {t("weekly.editor.back")}
          </Link>
        </div>
      </header>

      {existing?.status === "REJECTED" && existing.rejection_reason ? (
        <Card className="glass border-rose-400/30 bg-rose-500/5">
          <CardHeader>
            <CardTitle className="text-base font-medium text-rose-300">
              {t("weekly.editor.rejectionTitle")}
            </CardTitle>
            <CardDescription className="text-rose-200/80">
              {existing.rejection_reason}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {editable ? (
        <WeeklyTimesheetEditor
          employeeId={requestedEmployeeId}
          weekStartDate={weekStart}
          existingNotes={existing?.notes ?? ""}
          days={dayDefaults}
          projects={projects}
        />
      ) : (
        <WeekReadonlyGrid
          dayDefaults={dayDefaults}
          projects={projects}
          notesLabel={t("weekly.editor.notes")}
          notes={existing?.notes ?? ""}
        />
      )}

      {canReview && existing ? (
        <WeeklyReviewButtons
          id={existing.id}
          labels={{
            approve: t("weekly.actions.approve"),
            reject: t("weekly.actions.reject"),
            approveTitle: t("weekly.actions.approveTitle"),
            approveDescription: t("weekly.actions.approveDescription"),
            rejectTitle: t("weekly.actions.rejectTitle"),
            rejectDescription: t("weekly.actions.rejectDescription"),
            comment: t("weekly.actions.comment"),
            commentPlaceholder: t("weekly.actions.commentPlaceholder"),
            reason: t("weekly.actions.reason"),
            reasonPlaceholder: t("weekly.actions.reasonPlaceholder"),
            confirmApprove: t("weekly.actions.confirmApprove"),
            confirmReject: t("weekly.actions.confirmReject"),
            approvedToast: t("weekly.actions.approvedToast"),
            rejectedToast: t("weekly.actions.rejectedToast"),
          }}
        />
      ) : null}

      {existing && existing.logs.length > 0 ? (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              {t("weekly.editor.timelineTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {existing.logs.map((log) => (
                <li key={log.id} className="flex items-center gap-3">
                  <Badge variant="outline" className="text-[10px]">
                    {log.action}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {log.from_status} → {log.to_status}
                  </span>
                  <span>
                    {log.actor?.full_name ?? "—"}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({log.actor_role ?? "—"})
                    </span>
                  </span>
                  {log.comment ? (
                    <span className="text-xs text-muted-foreground truncate max-w-md">
                      {log.comment}
                    </span>
                  ) : null}
                  <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                    {new Date(log.created_at).toISOString().slice(0, 16).replace("T", " ")}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

type ProjectOption = {
  value: string;
  label: string;
};

/**
 * Only surface projects the target employee has an ACTIVE assignment
 * on (member OR PM). Previously this loaded every project in the
 * tenant — which let an employee log timesheet hours to projects
 * they aren't formally on, skewing profitability & utilization.
 * Server-side we also enforce this in `submitWeeklyTimesheetAction`
 * (see weekly/actions.ts) — the client filter is UX polish so the
 * dropdown never contains a project that would be rejected on
 * submit.
 */
async function loadProjectOptions(
  employeeId: string,
): Promise<ProjectOption[]> {
  const supabase = await createClient();
  const [{ data: memberRows }, { data: pmRows }] = await Promise.all([
    supabase
      .from("project_employee_assignments")
      .select("project:projects!inner(id, code, name)")
      .eq("employee_id", employeeId)
      .eq("status", "ACTIVE"),
    supabase
      .from("project_pm_assignments")
      .select("project:projects!inner(id, code, name)")
      .eq("pm_employee_id", employeeId)
      .eq("status", "ACTIVE"),
  ]);
  type ProjRel = { id: string; code: string | null; name: string } | null;
  const bag = new Map<string, { code: string | null; name: string }>();
  for (const r of memberRows ?? []) {
    const proj = r.project as unknown as ProjRel;
    if (proj?.id) bag.set(proj.id, { code: proj.code, name: proj.name });
  }
  for (const r of pmRows ?? []) {
    const proj = r.project as unknown as ProjRel;
    if (proj?.id) bag.set(proj.id, { code: proj.code, name: proj.name });
  }
  return Array.from(bag.entries())
    .map(([id, { code, name }]) => ({
      value: id,
      label: code ? `${code} — ${name}` : name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

type DayDefault = {
  work_date: string;
  project_id: string | null;
  hours_worked: number;
  hours_overtime: number;
  notes: string | null;
};

function buildDayDefaults(
  dates: string[],
  existing: WeekDetail | null,
): DayDefault[] {
  const byDate = new Map<string, WeekDetail["days"][number]>();
  for (const d of existing?.days ?? []) {
    byDate.set(d.work_date, d);
  }
  return dates.map((wd) => {
    const found = byDate.get(wd);
    return {
      work_date: wd,
      project_id: found?.project_id ?? null,
      hours_worked: found ? Number(found.hours_worked) : 0,
      hours_overtime: found ? Number(found.hours_overtime) : 0,
      notes: found?.notes ?? null,
    };
  });
}

function WeekReadonlyGrid({
  dayDefaults,
  projects,
  notes,
  notesLabel,
}: {
  dayDefaults: DayDefault[];
  projects: ProjectOption[];
  notes: string;
  notesLabel: string;
}) {
  const projMap = new Map(projects.map((p) => [p.value, p.label]));
  return (
    <Card className="glass overflow-hidden">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="label-meta px-4 py-3 text-xs">Date</th>
                <th className="label-meta px-4 py-3 text-xs">Project</th>
                <th className="label-meta px-4 py-3 text-right text-xs">
                  Hours
                </th>
                <th className="label-meta px-4 py-3 text-right text-xs">
                  Overtime
                </th>
              </tr>
            </thead>
            <tbody>
              {dayDefaults.map((d) => (
                <tr key={d.work_date} className="border-t border-border/50">
                  <td className="px-4 py-3 tabular-nums">{d.work_date}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {d.project_id ? (projMap.get(d.project_id) ?? d.project_id) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {d.hours_worked.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {d.hours_overtime.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {notes ? (
          <div className="border-t border-border/50 px-4 py-3 text-sm text-muted-foreground">
            <span className="font-medium">{notesLabel}: </span>
            {notes}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
