"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

import { upsertRosterEntryAction } from "./actions";
import type { RosterEntryStatus } from "@/types/database";

type Option = { value: string; label: string };

type FormValues = {
  employee_id: string;
  shift_id: string;
  project_id: string;
  work_date: string;
  status: RosterEntryStatus;
  notes: string;
};

export function RosterUpsertSheet({
  triggerLabel,
  title,
  description,
  employees,
  shifts,
  projects,
  defaultDate,
  labels,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  employees: Option[];
  shifts: Option[];
  projects: Option[];
  defaultDate: string;
  labels: {
    employee: string;
    shift: string;
    project: string;
    workDate: string;
    status: string;
    notes: string;
    notesPlaceholder: string;
    cancel: string;
    save: string;
    saving: string;
    successToast: string;
    errorToast: string;
    unassigned: string;
    statuses: Record<RosterEntryStatus, string>;
  };
}) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      employee_id: employees[0]?.value ?? "",
      shift_id: shifts[0]?.value ?? "",
      project_id: "",
      work_date: defaultDate,
      status: "PLANNED",
      notes: "",
    },
  });

  const employeeId = watch("employee_id");
  const shiftId = watch("shift_id");
  const projectId = watch("project_id");
  const statusVal = watch("status");

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const res = await upsertRosterEntryAction({
        employee_id: values.employee_id,
        shift_id: values.shift_id,
        project_id: values.project_id === "" ? undefined : values.project_id,
        work_date: values.work_date,
        status: values.status,
        notes: values.notes,
      });
      if (res.ok) {
        toast.success(labels.successToast);
        reset({
          employee_id: values.employee_id,
          shift_id: values.shift_id,
          project_id: values.project_id,
          work_date: values.work_date,
          status: "PLANNED",
          notes: "",
        });
        setOpen(false);
      } else {
        toast.error(res.reason ?? labels.errorToast);
      }
    });
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button size="sm">{triggerLabel}</Button>} />
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="employee_id">{labels.employee}</Label>
            <Select
              value={employeeId}
              onValueChange={(v) => setValue("employee_id", v ?? "")}
            >
              <SelectTrigger id="employee_id" aria-label={labels.employee}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {employees.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="shift_id">{labels.shift}</Label>
            <Select
              value={shiftId}
              onValueChange={(v) => setValue("shift_id", v ?? "")}
            >
              <SelectTrigger id="shift_id" aria-label={labels.shift}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {shifts.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="project_id">{labels.project}</Label>
            <Select
              value={projectId === "" ? "__none" : projectId}
              onValueChange={(v) =>
                setValue("project_id", !v || v === "__none" ? "" : v)
              }
            >
              <SelectTrigger id="project_id" aria-label={labels.project}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">{labels.unassigned}</SelectItem>
                {projects.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="work_date">{labels.workDate}</Label>
            <Input
              id="work_date"
              type="date"
              {...register("work_date", { required: true })}
              aria-invalid={!!errors.work_date}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="status">{labels.status}</Label>
            <Select
              value={statusVal}
              onValueChange={(v) =>
                setValue("status", (v ?? "PLANNED") as RosterEntryStatus)
              }
            >
              <SelectTrigger id="status" aria-label={labels.status}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["PLANNED", "LEAVE", "SICK", "OFF"] as RosterEntryStatus[]).map(
                  (s) => (
                    <SelectItem key={s} value={s}>
                      {labels.statuses[s]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="notes">{labels.notes}</Label>
            <Textarea
              id="notes"
              rows={3}
              placeholder={labels.notesPlaceholder}
              {...register("notes")}
            />
          </div>

          <SheetFooter className="mt-4 flex-row justify-end gap-2">
            <SheetClose
              render={
                <Button type="button" variant="ghost">
                  {labels.cancel}
                </Button>
              }
            />
            <Button type="submit" disabled={pending}>
              {pending ? labels.saving : labels.save}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
