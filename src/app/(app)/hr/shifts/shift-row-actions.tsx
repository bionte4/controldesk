"use client";

import * as React from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { WorkShiftRow } from "@/lib/data/shifts";

import { deleteWorkShiftAction } from "./actions";
import { ShiftUpsertSheet, type ShiftFormLabels } from "./shift-upsert-sheet";

/**
 * Per-row edit / delete menu for the shifts table. Wraps an edit
 * sheet (reused across create + update) and a lightweight confirm
 * dialog for delete. Delete requests may still fail server-side if
 * the shift is referenced by a roster or timesheet — the action
 * translates the FK error into a friendlier toast.
 */
export function ShiftRowActions({
  row,
  isHrOm,
  projects,
  labels,
  editLabel,
  deleteLabel,
  deleteConfirm,
  successDelete,
  errorDelete,
}: {
  row: WorkShiftRow;
  isHrOm: boolean;
  projects: { id: string; code: string; name: string }[];
  labels: ShiftFormLabels;
  editLabel: string;
  deleteLabel: string;
  deleteConfirm: string;
  successDelete: string;
  errorDelete: string;
}) {
  const [editOpen, setEditOpen] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const onDelete = () => {
    startTransition(async () => {
      const res = await deleteWorkShiftAction({ id: row.id });
      if (res.ok) {
        toast.success(successDelete);
        setConfirmOpen(false);
      } else {
        toast.error(res.reason ?? errorDelete);
      }
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="Row actions"
              className="size-8"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          {/*
            `event.preventDefault()` keeps Base UI's Menu from
            auto-closing before we flip the sheet/dialog state.
            Without it, the menu close routine restores focus to the
            trigger in the same tick that the Sheet mounts, and Base
            UI's dismiss layer treats the click as a click-outside on
            the freshly-opened Sheet — so the Sheet never appears.
            (Same pattern used in calendar-sync-panel.tsx.)
          */}
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setEditOpen(true);
            }}
          >
            <Pencil className="mr-2 size-4" /> {editLabel}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setConfirmOpen(true);
            }}
            className="text-rose-500 focus:text-rose-500"
          >
            <Trash2 className="mr-2 size-4" /> {deleteLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Reuse the same upsert sheet in edit mode. When `open` is
          controlled from here, ShiftUpsertSheet omits its own trigger
          — the DropdownMenu item above toggles `editOpen` instead. */}
      <ShiftUpsertSheet
        isHrOm={isHrOm}
        projects={projects}
        labels={labels}
        existing={{
          id: row.id,
          code: row.code,
          name: row.name,
          start_time: row.start_time,
          end_time: row.end_time,
          duration_hours: row.duration_hours,
          shift_allowance_idr: row.shift_allowance_idr,
          is_night: row.is_night,
          project_id: row.project_id,
        }}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deleteLabel}</DialogTitle>
            <DialogDescription>{deleteConfirm}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={pending}
            >
              {labels.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={onDelete}
              disabled={pending}
            >
              {pending ? labels.saving : deleteLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
