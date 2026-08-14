"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { GanttChart, ListTree } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TaskTreeNode } from "@/lib/data/tasks";

import { ProjectGanttChart } from "./gantt-chart";
import { WbsTree } from "./wbs-tree";
import type {
  EmployeeOption,
  MilestoneOption,
  TaskOption,
} from "./new-task-sheet";

type Mode = "tree" | "gantt";

/**
 * Client-side tabs to switch between WBS tree (default) and Gantt chart.
 * Both views share the same task data — no extra fetch on switch. Gantt
 * loads frappe-gantt lazily so it doesn't tax the initial bundle.
 */
export function TasksView({
  projectId,
  roots,
  flat,
  flatOptions,
  milestones,
  employees,
  employeeById,
  today,
  canManage,
  canDelete,
}: {
  projectId: string;
  roots: TaskTreeNode[];
  flat: TaskTreeNode[];
  flatOptions: TaskOption[];
  milestones: MilestoneOption[];
  employees: EmployeeOption[];
  employeeById: Record<string, string>;
  today: string;
  canManage: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("tasks");
  const [mode, setMode] = React.useState<Mode>("tree");

  return (
    <div className="flex flex-col">
      <div
        className="flex items-center gap-1 border-b px-4 py-1.5"
        role="tablist"
        aria-label={t("title")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "tree"}
          onClick={() => setMode("tree")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
            mode === "tree"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <ListTree className="size-3.5" />
          {t("tabs.tree")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "gantt"}
          onClick={() => setMode("gantt")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
            mode === "gantt"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <GanttChart className="size-3.5" />
          {t("tabs.gantt")}
        </button>
      </div>

      <div hidden={mode !== "tree"}>
        <WbsTree
          projectId={projectId}
          roots={roots}
          flatOptions={flatOptions}
          milestones={milestones}
          employees={employees}
          employeeById={employeeById}
          canManage={canManage}
          canDelete={canDelete}
        />
      </div>

      {mode === "gantt" ? (
        <ProjectGanttChart nodes={flat} today={today} />
      ) : null}
    </div>
  );
}
