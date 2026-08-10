import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { UserPlus, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatInTz } from "@/lib/format/date";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { ASSIGNMENT_VIEWER_ROLES } from "@/lib/rbac/roles";
import {
  loadAssignments,
  loadEmployeeOptions,
  loadProjectOptions,
  loadWorkload,
  groupByEmployee,
  groupByProject,
  type AssignmentRow,
} from "@/lib/data/assignments";

import { NewAssignmentSheet } from "./new-assignment-sheet";
import { EndAssignmentButton } from "./assignment-row-actions";

export const metadata: Metadata = { title: "Assignments" };

type SearchParams = {
  tab?: string;
  project?: string;
  role?: string;
  status?: string;
};

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const employee = await requireCurrentEmployee();
  if (!ASSIGNMENT_VIEWER_ROLES.includes(employee.role)) {
    redirect("/dashboard?error=forbidden");
  }

  const [params, t] = await Promise.all([
    searchParams,
    getTranslations("assignments"),
  ]);

  const tab = (params.tab ?? "byProject") as "byProject" | "byEmployee" | "workload";
  const status = params.status === "all" ? undefined : "ACTIVE";
  const projectFilter = params.project && params.project !== "all" ? params.project : undefined;
  const roleFilter = params.role && params.role !== "all" ? params.role : undefined;

  const [{ rows }, projectOpts, employeeOpts, workload] = await Promise.all([
    loadAssignments({
      projectId: projectFilter,
      role: roleFilter,
      status: status as "ACTIVE" | undefined,
    }),
    loadProjectOptions(),
    loadEmployeeOptions(),
    loadWorkload(),
  ]);

  // Build the workload lookup for the sheet's live capacity indicator.
  const workloadLookup: Record<string, { total: number; remaining: number }> = {};
  for (const w of workload) {
    workloadLookup[w.employee_id] = {
      total: w.total_alloc_pct,
      remaining: w.remaining_pct,
    };
  }

  // Sheet project options: `label = project_number · name` for readability.
  const sheetProjects = projectOpts.map((p) => ({
    id: p.id,
    label: `${p.project_number ?? p.code ?? "—"} — ${p.name}`,
  }));

  // Prefer employees whose role hints "engineer/PM/etc" but keep all active.
  const sheetEmployees = employeeOpts.map((e) => ({
    id: e.id,
    full_name: e.full_name,
    role: e.role,
  }));

  const canWrite = true;
  const tabBadgeCount = workload.filter((w) => w.total_alloc_pct > 100).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <NewAssignmentSheet
          projects={sheetProjects}
          employees={sheetEmployees}
          workload={workloadLookup}
          triggerLabel={t("newAssignment")}
          disabled={!canWrite}
        />
      </header>

      {/* Tab bar */}
      <div className="flex items-center gap-2 border-b border-border/60">
        <TabLink
          href={buildTabHref(params, "byProject")}
          active={tab === "byProject"}
          label={t("tabs.byProject")}
        />
        <TabLink
          href={buildTabHref(params, "byEmployee")}
          active={tab === "byEmployee"}
          label={t("tabs.byEmployee")}
        />
        <TabLink
          href={buildTabHref(params, "workload")}
          active={tab === "workload"}
          label={t("tabs.workload")}
          badge={tabBadgeCount || undefined}
        />
      </div>

      {tab === "workload" ? (
        <WorkloadTab workload={workload} />
      ) : rows.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Users className="size-6" />
            </div>
            <CardTitle className="font-display text-xl">{t("empty")}</CardTitle>
            <CardDescription className="max-w-md text-center">
              {t("emptyBody")}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : tab === "byProject" ? (
        <ByProjectView rows={rows} />
      ) : (
        <ByEmployeeView rows={rows} />
      )}
    </div>
  );
}

function TabLink({
  href,
  active,
  label,
  badge,
}: {
  href: string;
  active: boolean;
  label: string;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={
        "flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 transition-colors " +
        (active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground")
      }
    >
      {label}
      {badge != null && (
        <Badge variant="destructive" className="ml-1 h-5 min-w-5 px-1">
          {badge}
        </Badge>
      )}
    </Link>
  );
}

function buildTabHref(params: SearchParams, tab: string): string {
  const sp = new URLSearchParams();
  sp.set("tab", tab);
  if (params.project) sp.set("project", params.project);
  if (params.role) sp.set("role", params.role);
  if (params.status) sp.set("status", params.status);
  return `/assignments?${sp.toString()}`;
}

// ---------------------------------------------------------------------------
// By Project
// ---------------------------------------------------------------------------

async function ByProjectView({ rows }: { rows: AssignmentRow[] }) {
  const tRaw = await getTranslations("assignments");
  const t = tRaw as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
  const groups = groupByProject(rows);

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <Card key={group.project.id} className="glass">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold">
                {group.project.project_number ?? group.project.code ?? "—"} —{" "}
                {group.project.name}
              </CardTitle>
              <CardDescription>
                {t("list.activeAllocation", {
                  pct: group.totalActiveAllocationPct,
                })}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border/40">
            {Array.from(group.byRole.entries()).map(([role, roleRows]) => (
              <div key={role} className="py-2 first:pt-0 last:pb-0">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("list.roleGroup", {
                      role: t(`roles.${role}`),
                      count: roleRows.length,
                    })}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {roleRows.map((row) => (
                    <AssignmentRowItem
                      key={`${row.kind}-${row.id}`}
                      row={row}
                      showEmployee
                      dense
                    />
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// By Employee
// ---------------------------------------------------------------------------

async function ByEmployeeView({ rows }: { rows: AssignmentRow[] }) {
  const tRaw = await getTranslations("assignments");
  const t = tRaw as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
  const groups = groupByEmployee(rows);

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => {
        const overloaded = group.totalActiveAllocationPct > 100;
        return (
          <Card key={group.employee.id} className="glass">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">
                  {group.employee.full_name}
                </CardTitle>
                <CardDescription>
                  {t("list.activeAllocation", {
                    pct: group.totalActiveAllocationPct,
                  })}
                </CardDescription>
              </div>
              {overloaded ? (
                <Badge variant="destructive">{t("workload.overloaded")}</Badge>
              ) : (
                <Badge variant="secondary">
                  {group.totalActiveAllocationPct === 0
                    ? t("workload.idle")
                    : t("workload.healthy")}
                </Badge>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {group.rows.map((row) => (
                <AssignmentRowItem
                  key={`${row.kind}-${row.id}`}
                  row={row}
                  showProject
                  dense
                />
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workload heatmap (simple list with progress bars)
// ---------------------------------------------------------------------------

async function WorkloadTab({
  workload,
}: {
  workload: Awaited<ReturnType<typeof loadWorkload>>;
}) {
  const t = await getTranslations("assignments");

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="text-base font-semibold">
          {t("workload.total")}
        </CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border/40">
        {workload.map((w) => {
          const pct = Math.min(100, w.total_alloc_pct);
          const overloaded = w.total_alloc_pct > 100;
          const idle = w.total_alloc_pct === 0;
          return (
            <div
              key={w.employee_id}
              className="grid grid-cols-1 md:grid-cols-[minmax(220px,1fr)_1fr_180px] gap-3 py-3 items-center"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{w.full_name}</div>
                <div className="text-xs text-muted-foreground">
                  {t("workload.activeCount", { count: w.active_assignments })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Progress
                  value={pct}
                  className={
                    overloaded
                      ? "[&>[data-slot=progress-indicator]]:bg-destructive"
                      : idle
                        ? "opacity-60"
                        : ""
                  }
                />
                <span className="w-14 shrink-0 text-right text-sm tabular-nums font-medium">
                  {w.total_alloc_pct}%
                </span>
              </div>
              <div className="flex items-center justify-end gap-2">
                {overloaded ? (
                  <Badge variant="destructive">{t("workload.overloaded")}</Badge>
                ) : idle ? (
                  <Badge variant="secondary">{t("workload.idle")}</Badge>
                ) : (
                  <Badge variant="outline">
                    {t("workload.remaining")}: {w.remaining_pct}%
                  </Badge>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Row item (used by both grouped views)
// ---------------------------------------------------------------------------

async function AssignmentRowItem({
  row,
  showEmployee,
  showProject,
  dense,
}: {
  row: AssignmentRow;
  showEmployee?: boolean;
  showProject?: boolean;
  dense?: boolean;
}) {
  const tRaw = await getTranslations("assignments");
  const t = tRaw as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
  // formatInTz signature is (value, pattern, timezone) — pattern comes
  // BEFORE timezone. Defaults to Asia/Jakarta so we can drop it here.
  const started = formatInTz(row.started_at, "dd MMM yyyy");
  const ended = row.ended_at ? formatInTz(row.ended_at, "dd MMM yyyy") : "—";
  const activePct = row.status === "ACTIVE" ? row.allocation_pct : 0;

  return (
    <div
      className={
        "grid grid-cols-1 gap-2 md:grid-cols-[minmax(220px,1fr)_140px_1fr_120px_80px] md:items-center " +
        (dense ? "py-1" : "py-2")
      }
    >
      <div className="min-w-0">
        {showEmployee && (
          <div className="truncate font-medium">{row.employee.full_name}</div>
        )}
        {showProject && (
          <div className="truncate text-sm">
            <Link
              href={`/projects/${row.project.id}`}
              className="hover:underline underline-offset-2"
            >
              {row.project.project_number ?? row.project.code ?? "—"} —{" "}
              {row.project.name}
            </Link>
          </div>
        )}
        {!showEmployee && !showProject && (
          <div className="truncate font-medium">{row.employee.full_name}</div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Progress value={activePct} className="h-1.5" />
        <span className="w-10 shrink-0 text-right text-xs tabular-nums font-medium">
          {activePct}%
        </span>
      </div>

      <div className="text-xs text-muted-foreground tabular-nums">
        {started} → {ended}
      </div>

      <div>
        <Badge variant={row.status === "ACTIVE" ? "default" : "secondary"}>
          {t(`status.${row.status}`)}
        </Badge>
      </div>

      <div className="flex justify-end">
        {row.status === "ACTIVE" ? (
          <EndAssignmentButton id={row.id} kind={row.kind} />
        ) : null}
      </div>
    </div>
  );
}
