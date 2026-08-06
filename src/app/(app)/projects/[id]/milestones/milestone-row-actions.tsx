"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, MoreVertical, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MILESTONE_STATUSES } from "@/lib/validation/milestone";
import { nextAllowedMilestoneStatuses } from "@/lib/milestones/state";
import type { MilestoneStatus } from "@/types/database";

import { deleteMilestoneAction, setMilestoneStatusAction } from "./actions";

/**
 * Row-level dropdown. Shows only the transitions allowed from the current
 * status (per `nextAllowedMilestoneStatuses`) plus a `Delete` action.
 *
 * The parent decides whether to render the buttons at all (based on
 * canonical role — the PDP is the source of truth, this is just a UI hint).
 */
export function MilestoneRowActions({
  id,
  status,
  canEdit,
  canDelete,
}: {
  id: string;
  status: MilestoneStatus;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("milestones.actions");
  const tStatus = useTranslations("milestones.status");
  const [isPending, startTransition] = React.useTransition();
  const allowed = nextAllowedMilestoneStatuses(status);

  if (!canEdit && !canDelete) return null;

  function onSetStatus(next: MilestoneStatus) {
    startTransition(async () => {
      const result = await setMilestoneStatusAction({ id, status: next });
      if (result.ok) toast.success(t("statusUpdated"));
      else toast.error(result.reason);
    });
  }

  function onDelete() {
    startTransition(async () => {
      const result = await deleteMilestoneAction({ id });
      if (result.ok) toast.success(t("deleted"));
      else toast.error(result.reason);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("openMenu")}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoreVertical className="size-4" />
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        {canEdit && allowed.length > 0 ? (
          <>
            {(MILESTONE_STATUSES as readonly MilestoneStatus[]).map((s) => {
              if (s === status) return null;
              if (!(allowed as readonly MilestoneStatus[]).includes(s)) return null;
              return (
                <DropdownMenuItem
                  key={s}
                  onClick={() => onSetStatus(s)}
                  disabled={isPending}
                >
                  <CheckCircle2 className="mr-2 size-4" />
                  {t("moveTo", { status: tStatus(s) })}
                </DropdownMenuItem>
              );
            })}
            {canDelete ? <DropdownMenuSeparator /> : null}
          </>
        ) : null}
        {canDelete ? (
          <DropdownMenuItem
            onClick={onDelete}
            disabled={isPending}
            className="text-rose-500 focus:text-rose-500"
          >
            <Trash2 className="mr-2 size-4" />
            {t("delete")}
          </DropdownMenuItem>
        ) : null}
        {!canEdit && !canDelete ? (
          <DropdownMenuItem disabled>{t("noActions")}</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
