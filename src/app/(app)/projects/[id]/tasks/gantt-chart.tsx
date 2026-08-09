"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

// Static side-effect import — Turbopack's `exports` resolver can't pick up
// the `style` condition on `frappe-gantt`, so we import the raw file path.
// The `frappe-gantt` npm package explicitly whitelists `dist/` in `files`,
// so the file is always present in node_modules.
import "@/styles/frappe-gantt.css";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TaskTreeNode } from "@/lib/data/tasks";

import { setTaskProgressAction, updateTaskAction } from "./actions";

type ViewMode = "Day" | "Week" | "Month" | "Quarter Day" | "Half Day";
const VIEW_MODES: ViewMode[] = ["Day", "Week", "Month"];

type GanttTask = {
  id: string;
  name: string;
  start: string;
  end: string;
  progress: number;
  dependencies: string;
  custom_class: string;
};

type GanttInstance = {
  refresh?: (tasks: GanttTask[]) => void;
  change_view_mode?: (mode: string) => void;
} | null;

const STATUS_CLASS: Record<string, string> = {
  TODO: "bar-todo",
  IN_PROGRESS: "bar-in-progress",
  BLOCKED: "bar-blocked",
  REVIEW: "bar-review",
  DONE: "bar-done",
  CANCELLED: "bar-cancelled",
};

/**
 * Interactive Gantt chart rendered via frappe-gantt (dynamic import).
 * Drag-to-reschedule + drag-to-set-progress call server actions.
 *
 * Tasks WITHOUT planned dates are shown in a fallback list below the chart
 * so the user knows to plan them before they appear on the timeline.
 */
export function ProjectGanttChart({
  nodes,
  today,
}: {
  nodes: TaskTreeNode[];
  today: string;
}) {
  const t = useTranslations("tasks");
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const ganttRef = React.useRef<GanttInstance>(null);
  const [viewMode, setViewMode] = React.useState<ViewMode>("Week");
  const [ready, setReady] = React.useState(false);
  const [, startTransition] = React.useTransition();

  // Hoist mutation handlers into refs so the effect below can call them
  // without re-running whenever they re-identify each render. Refs are
  // written from an effect (not during render) to satisfy React Compiler.
  const handleDateChangeRef = React.useRef<
    (taskId: string, start: Date, end: Date) => void
  >(() => {});
  const handleProgressChangeRef = React.useRef<
    (taskId: string, progress: number) => void
  >(() => {});

  const onDateChange = React.useCallback(
    (taskId: string, start: Date, end: Date) => {
      const s = toIsoDate(start);
      const e = toIsoDate(end);
      startTransition(async () => {
        const result = await updateTaskAction({
          id: taskId,
          planned_start_date: s,
          planned_end_date: e,
        });
        if (!result?.ok) {
          toast.error(result?.reason ?? "Something went wrong");
          return;
        }
        toast.success(t("form.updated"));
      });
    },
    [t],
  );

  const onProgressChange = React.useCallback(
    (taskId: string, progress: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(progress)));
      startTransition(async () => {
        const result = await setTaskProgressAction({
          id: taskId,
          progress_pct: clamped,
        });
        if (!result?.ok) {
          toast.error(result?.reason ?? "Something went wrong");
          return;
        }
        toast.success(t("actions.progressUpdated"));
      });
    },
    [t],
  );

  React.useEffect(() => {
    handleDateChangeRef.current = onDateChange;
    handleProgressChangeRef.current = onProgressChange;
  }, [onDateChange, onProgressChange]);

  const { plannedTasks, unplannedTasks } = React.useMemo(() => {
    const planned: GanttTask[] = [];
    const unplanned: TaskTreeNode[] = [];
    for (const n of nodes) {
      if (n.planned_start_date && n.planned_end_date) {
        planned.push({
          id: n.id,
          name: `${n.wbs_code} ${n.name}`,
          start: n.planned_start_date,
          end: n.planned_end_date,
          progress: n.progress_pct,
          dependencies: n.depends_on_task_id ?? "",
          custom_class: STATUS_CLASS[n.status] ?? "",
        });
      } else {
        unplanned.push(n);
      }
    }
    return { plannedTasks: planned, unplannedTasks: unplanned };
  }, [nodes]);

  // Load frappe-gantt lazily on the client (SSR-safe).
  React.useEffect(() => {
    let cancelled = false;
    let instance: unknown = null;

    async function boot() {
      if (!containerRef.current || plannedTasks.length === 0) return;

      const { default: Gantt } = await import("frappe-gantt");
      if (cancelled) return;

      containerRef.current.innerHTML = "";
      const opts = {
        view_mode: viewMode,
        date_format: "YYYY-MM-DD",
        today_color: "hsl(var(--primary))",
        popup_trigger: "click" as const,
        readonly: false,
        on_date_change: (task: { id: string }, start: Date, end: Date) => {
          handleDateChangeRef.current(task.id, start, end);
        },
        on_progress_change: (task: { id: string }, progress: number) => {
          handleProgressChangeRef.current(task.id, progress);
        },
      };
      instance = new Gantt(containerRef.current, plannedTasks, opts);
      ganttRef.current = instance as GanttInstance;
      setReady(true);
    }

    boot();

    return () => {
      cancelled = true;
      if (containerRef.current) containerRef.current.innerHTML = "";
      ganttRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannedTasks, viewMode]);


  if (plannedTasks.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        {t("gantt.emptyPlanned")}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2 text-xs">
        <span className="text-muted-foreground">
          {t("gantt.hint", { date: today })}
        </span>
        <div className="flex items-center gap-1">
          {VIEW_MODES.map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={viewMode === mode ? "default" : "outline"}
              onClick={() => setViewMode(mode)}
            >
              {mode}
            </Button>
          ))}
        </div>
      </div>
      <div
        ref={containerRef}
        className={cn(
          "gantt-container overflow-x-auto",
          !ready && "opacity-70",
        )}
        style={{ minHeight: 300 }}
      />
      {unplannedTasks.length > 0 ? (
        <div className="border-t p-4 text-xs">
          <div className="font-medium text-muted-foreground">
            {t("gantt.unplanned", { count: unplannedTasks.length })}
          </div>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted-foreground">
            {unplannedTasks.slice(0, 5).map((n) => (
              <li key={n.id}>
                <span className="font-mono">{n.wbs_code}</span> · {n.name}
              </li>
            ))}
            {unplannedTasks.length > 5 ? (
              <li>… {unplannedTasks.length - 5} more</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
