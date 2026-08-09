"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { TaskStatus } from "@/types/database";

import type { TaskTreeNode } from "@/lib/data/tasks";
import type {
  EmployeeOption,
  MilestoneOption,
  TaskOption,
} from "./new-task-sheet";
import { TaskRowActions } from "./task-row-actions";

const STATUS_VARIANT: Record<
  TaskStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  TODO: "outline",
  IN_PROGRESS: "default",
  BLOCKED: "destructive",
  REVIEW: "secondary",
  DONE: "secondary",
  CANCELLED: "outline",
};

export function WbsTree({
  projectId,
  roots,
  flatOptions,
  milestones,
  employees,
  employeeById,
}: {
  projectId: string;
  roots: TaskTreeNode[];
  flatOptions: TaskOption[];
  milestones: MilestoneOption[];
  employees: EmployeeOption[];
  employeeById: Record<string, string>;
}) {
  const t = useTranslations("tasks");
  const [expanded, setExpanded] = React.useState<Set<string>>(() => {
    // Default: expand first two levels.
    const initial = new Set<string>();
    const walk = (n: TaskTreeNode) => {
      if (n.depth < 1) initial.add(n.id);
      n.children.forEach(walk);
    };
    roots.forEach(walk);
    return initial;
  });

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    const all = new Set<string>();
    const walk = (n: TaskTreeNode) => {
      all.add(n.id);
      n.children.forEach(walk);
    };
    roots.forEach(walk);
    setExpanded(all);
  }

  function collapseAll() {
    setExpanded(new Set());
  }

  if (roots.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t("empty")}
      </p>
    );
  }

  const rows: TaskTreeNode[] = [];
  const collect = (n: TaskTreeNode) => {
    rows.push(n);
    if (expanded.has(n.id)) n.children.forEach(collect);
  };
  roots.forEach(collect);

  return (
    <div>
      <div className="flex items-center justify-end gap-2 border-b px-4 py-2 text-xs">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={expandAll}
        >
          {t("expandAll")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={collapseAll}
        >
          {t("collapseAll")}
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/30 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left w-20">{t("columns.code")}</th>
            <th className="px-3 py-2 text-left">{t("columns.name")}</th>
            <th className="px-3 py-2 text-left w-32">{t("columns.owner")}</th>
            <th className="px-3 py-2 text-left w-40">
              {t("columns.progress")}
            </th>
            <th className="px-3 py-2 text-left w-36">
              {t("columns.planned")}
            </th>
            <th className="px-3 py-2 text-left w-28">{t("columns.status")}</th>
            <th className="px-3 py-2 text-right w-16">
              {t("columns.actions")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((node) => {
            const hasChildren = node.children.length > 0;
            const isOpen = expanded.has(node.id);
            const ownerLabel = node.owner_employee_id
              ? employeeById[node.owner_employee_id] ?? "—"
              : "—";
            const today = new Date().toISOString().slice(0, 10);
            const isOverdue = Boolean(
              node.planned_end_date &&
                node.planned_end_date < today &&
                node.status !== "DONE" &&
                node.status !== "CANCELLED",
            );

            return (
              <tr
                key={node.id}
                className={cn(
                  "border-b transition-colors",
                  "hover:bg-muted/30",
                )}
              >
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground align-top">
                  {node.wbs_code}
                </td>
                <td className="px-3 py-2 align-top">
                  <div
                    className="flex items-start gap-1"
                    style={{ paddingLeft: `${node.depth * 16}px` }}
                  >
                    {hasChildren ? (
                      <button
                        type="button"
                        onClick={() => toggle(node.id)}
                        aria-label={
                          isOpen ? t("collapseAll") : t("expandAll")
                        }
                        className="mt-0.5 rounded p-0.5 hover:bg-muted"
                      >
                        {isOpen ? (
                          <ChevronDown className="size-3.5" />
                        ) : (
                          <ChevronRight className="size-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="inline-block w-4" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">
                        {node.name}
                      </div>
                      {node.description ? (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {node.description}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                  {ownerLabel}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="flex items-center gap-2">
                    <Progress
                      value={node.rolled_progress}
                      className="h-1.5 w-24"
                    />
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {node.rolled_progress.toFixed(0)}%
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                  {formatRange(node.rolled_start, node.rolled_end, isOverdue)}
                </td>
                <td className="px-3 py-2 align-top">
                  <Badge variant={STATUS_VARIANT[node.status]}>
                    {t(`status.${node.status}`)}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right align-top">
                  <TaskRowActions
                    taskId={node.id}
                    projectId={projectId}
                    currentStatus={node.status}
                    currentProgress={node.progress_pct}
                    initial={{
                      name: node.name,
                      description: node.description ?? "",
                      milestone_id: node.milestone_id ?? "",
                      owner_employee_id: node.owner_employee_id ?? "",
                      depends_on_task_id: node.depends_on_task_id ?? "",
                      weight_pct: String(node.weight_pct ?? 0),
                      progress_pct: String(node.progress_pct ?? 0),
                      planned_start_date: node.planned_start_date ?? "",
                      planned_end_date: node.planned_end_date ?? "",
                      budget_amount:
                        node.budget_amount != null
                          ? String(node.budget_amount)
                          : "",
                    }}
                    parents={flatOptions.filter((o) => o.id !== node.id)}
                    milestones={milestones}
                    employees={employees}
                    predecessors={flatOptions.filter((o) => o.id !== node.id)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatRange(
  start: string | null,
  end: string | null,
  isOverdue: boolean,
): React.ReactNode {
  if (!start && !end) return "—";
  const s = start ? start.slice(5) : "—";
  const e = end ? end.slice(5) : "—";
  return (
    <span className={cn(isOverdue && "text-destructive font-medium")}>
      {s} → {e}
    </span>
  );
}
