"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, MoreHorizontal, Play, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { allowedNextIssueStatuses } from "@/lib/issues/state";
import type { ProjectIssueStatus } from "@/types/database";

import { transitionIssueAction } from "./actions";

const ICON: Partial<Record<ProjectIssueStatus, React.ReactNode>> = {
  IN_PROGRESS: <Play className="size-3.5" />,
  RESOLVED: <CheckCircle2 className="size-3.5" />,
  CLOSED: <X className="size-3.5" />,
  REOPENED: <RotateCcw className="size-3.5" />,
  OPEN: <RotateCcw className="size-3.5" />,
};

export function IssueRowActions({
  issueId,
  currentStatus,
  canAct,
}: {
  issueId: string;
  currentStatus: ProjectIssueStatus;
  canAct: boolean;
}) {
  const tStatus = useTranslations("issues.status");
  const tActions = useTranslations("issues.actions");
  const [isPending, startTransition] = React.useTransition();

  const nextStatuses = React.useMemo(
    () => allowedNextIssueStatuses(currentStatus),
    [currentStatus],
  );

  if (!canAct || nextStatuses.length === 0) return null;

  const onTransition = (to: ProjectIssueStatus) => {
    startTransition(async () => {
      const result = await transitionIssueAction({
        issue_id: issueId,
        to_status: to,
      });
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      toast.success(tActions("transitionedToast", { status: tStatus(to) }));
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            aria-label={tActions("openMenu")}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{tActions("transitionTo")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {nextStatuses.map((to) => (
          <DropdownMenuItem
            key={to}
            onSelect={(e) => {
              e.preventDefault();
              onTransition(to);
            }}
            disabled={isPending}
          >
            {ICON[to]}
            <span className="ml-2">{tStatus(to)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
