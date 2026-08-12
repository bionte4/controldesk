import "server-only";

import { getTranslations } from "next-intl/server";
import { AlertTriangle, CheckCircle2, ListTree, Loader2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import {
  buildTaskTree,
  computeTaskStats,
  flattenTaskTree,
  loadProjectTasks,
} from "@/lib/data/tasks";

import { TaskSheet, type EmployeeOption, type MilestoneOption, type TaskOption } from "./new-task-sheet";
import { TasksView } from "./tasks-view";

/**
 * Server component that renders the WBS (Work Breakdown Structure) section
 * for a project detail page. Wraps a stats strip + tree table + new-task
 * sheet trigger. Data is fetched via `loadProjectTasks()` (RSC-cached) and
 * folded into a tree with derived `wbs_code` / rolled progress.
 */
export async function ProjectTasksSection({
  projectId,
  tenantId,
}: {
  projectId: string;
  tenantId: string;
}) {
  const t = await getTranslations("tasks");
  const supabase = await createClient();

  const [rows, employeesResult, milestonesResult] = await Promise.all([
    loadProjectTasks(projectId),
    supabase
      .from("employees")
      .select("id, full_name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("full_name", { ascending: true })
      .limit(500),
    supabase
      .from("project_milestones")
      .select("id, seq, name")
      .eq("project_id", projectId)
      .eq("tenant_id", tenantId)
      .order("seq", { ascending: true }),
  ]);

  const employees: EmployeeOption[] = (employeesResult.data ?? []).map((e) => ({
    id: e.id,
    label: e.full_name,
  }));
  const employeeById = Object.fromEntries(
    employees.map((e) => [e.id, e.label]),
  );

  const milestones: MilestoneOption[] = (milestonesResult.data ?? []).map(
    (m) => ({
      id: m.id,
      label: `#${m.seq} · ${m.name}`,
    }),
  );

  const tree = buildTaskTree(rows);
  const flat = flattenTaskTree(tree);
  const flatOptions: TaskOption[] = flat.map((n) => ({
    id: n.id,
    label: n.name,
    wbs_code: n.wbs_code,
    depth: n.depth,
  }));

  const stats = computeTaskStats(rows);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-4">
        <div className="min-w-0 flex-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListTree className="size-4 text-muted-foreground" />
            {t("title")}
          </CardTitle>
          <CardDescription>
            {t("subtitle", {
              total: stats.total,
              overdue: stats.overdue,
              progress: stats.averageProgress,
            })}
          </CardDescription>
        </div>
        <TaskSheet
          mode="create"
          projectId={projectId}
          parents={flatOptions}
          milestones={milestones}
          employees={employees}
          predecessors={flatOptions}
        />
      </CardHeader>

      {stats.total > 0 ? (
        <div className="grid grid-cols-2 gap-2 border-t px-6 py-3 text-xs sm:grid-cols-5">
          <Stat label={t("stats.total")} value={String(stats.total)} />
          <Stat
            label={t("stats.inProgress")}
            value={String(stats.byStatus.IN_PROGRESS)}
            icon={<Loader2 className="size-3.5 text-primary" />}
          />
          <Stat
            label={t("stats.done")}
            value={String(stats.byStatus.DONE)}
            icon={<CheckCircle2 className="size-3.5 text-emerald-500" />}
          />
          <Stat
            label={t("stats.overdue")}
            value={String(stats.overdue)}
            icon={
              stats.overdue > 0 ? (
                <AlertTriangle className="size-3.5 text-destructive" />
              ) : undefined
            }
            tone={stats.overdue > 0 ? "danger" : undefined}
          />
          <Stat
            label={t("stats.avgProgress")}
            value={`${stats.averageProgress.toFixed(0)}%`}
          />
        </div>
      ) : null}

      <CardContent className="p-0">
        <TasksView
          projectId={projectId}
          roots={tree}
          flat={flat}
          flatOptions={flatOptions}
          milestones={milestones}
          employees={employees}
          employeeById={employeeById}
          today={new Date().toISOString().slice(0, 10)}
        />
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  tone?: "danger";
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase text-muted-foreground">
        {label}
      </span>
      <span
        className={`flex items-center gap-1 text-lg font-semibold tabular-nums ${
          tone === "danger" ? "text-destructive" : ""
        }`}
      >
        {icon}
        {value}
      </span>
    </div>
  );
}
