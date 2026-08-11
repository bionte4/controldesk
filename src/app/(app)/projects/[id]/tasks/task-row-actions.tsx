"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TaskStatus } from "@/types/database";

import {
  deleteTaskAction,
  setTaskStatusAction,
  setTaskProgressAction,
} from "./actions";
import type { EmployeeOption, MilestoneOption, TaskOption } from "./new-task-sheet";
import { TaskSheet } from "./new-task-sheet";

const STATUSES: TaskStatus[] = [
  "TODO",
  "IN_PROGRESS",
  "BLOCKED",
  "REVIEW",
  "DONE",
  "CANCELLED",
];

const PROGRESS_PRESETS = [0, 25, 50, 75, 100];

export function TaskRowActions({
  taskId,
  projectId,
  currentStatus,
  currentProgress,
  initial,
  parents,
  milestones,
  employees,
  predecessors,
}: {
  taskId: string;
  projectId: string;
  currentStatus: TaskStatus;
  currentProgress: number;
  initial: {
    name: string;
    description?: string;
    milestone_id?: string;
    owner_employee_id?: string;
    depends_on_task_id?: string;
    weight_pct?: string;
    progress_pct?: string;
    planned_start_date?: string;
    planned_end_date?: string;
    budget_amount?: string;
  };
  parents: TaskOption[];
  milestones: MilestoneOption[];
  employees: EmployeeOption[];
  predecessors: TaskOption[];
}) {
  const t = useTranslations("tasks");
  const [isPending, startTransition] = React.useTransition();
  const [editOpen, setEditOpen] = React.useState(false);
  const [childOpen, setChildOpen] = React.useState(false);

  function moveStatus(nextStatus: TaskStatus) {
    startTransition(async () => {
      const result = await setTaskStatusAction({ id: taskId, status: nextStatus });
      if (!result?.ok) {
        toast.error(result?.reason ?? "Something went wrong");
        return;
      }
      toast.success(t("actions.statusUpdated"));
    });
  }

  function setProgress(pct: number) {
    startTransition(async () => {
      const result = await setTaskProgressAction({
        id: taskId,
        progress_pct: pct,
      });
      if (!result?.ok) {
        toast.error(result?.reason ?? "Something went wrong");
        return;
      }
      toast.success(t("actions.progressUpdated"));
    });
  }

  function remove() {
    if (!confirm(t("actions.deleteConfirm"))) return;
    startTransition(async () => {
      const result = await deleteTaskAction({ id: taskId });
      if (!result?.ok) {
        toast.error(result?.reason ?? "Something went wrong");
        return;
      }
      toast.success(t("actions.deleted"));
    });
  }

  return (
    <div className="flex items-center gap-1">
      {/* Hidden sheets — opened programmatically. We remount with a key so
          the form defaults reset each time the sheet is re-opened. */}
      {editOpen ? (
        <TaskSheet
          key={`edit-${taskId}`}
          mode="edit"
          projectId={projectId}
          parents={parents}
          milestones={milestones}
          employees={employees}
          predecessors={predecessors}
          initial={{ id: taskId, ...initial }}
          triggerLabel={t("actions.edit")}
          triggerIcon="pencil"
          triggerVariant="ghost"
          triggerSize="icon"
          onDone={() => setEditOpen(false)}
        />
      ) : null}
      {childOpen ? (
        <TaskSheet
          key={`child-${taskId}`}
          mode="create"
          projectId={projectId}
          parents={parents}
          milestones={milestones}
          employees={employees}
          predecessors={predecessors}
          initial={{ parent_task_id: taskId }}
          triggerLabel={t("actions.addChild")}
          triggerVariant="ghost"
          triggerSize="icon"
          onDone={() => setChildOpen(false)}
        />
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              disabled={isPending}
              aria-label={t("actions.openMenu")}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{t("actions.openMenu")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            {t("actions.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setChildOpen(true)}>
            {t("actions.addChild")}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {t("actions.setProgress")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {PROGRESS_PRESETS.map((pct) => (
                <DropdownMenuItem
                  key={pct}
                  disabled={pct === currentProgress}
                  onSelect={() => setProgress(pct)}
                >
                  {pct}%
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              {t("actions.moveTo", { status: "…" })}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {STATUSES.filter((s) => s !== currentStatus).map((s) => (
                <DropdownMenuItem key={s} onSelect={() => moveStatus(s)}>
                  {t(`status.${s}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={remove}
            className="text-destructive focus:text-destructive"
          >
            {t("actions.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

