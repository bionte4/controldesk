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

import { submitTimesheetAction } from "./actions";

type Option = { value: string; label: string };

type FormValues = {
  employee_id: string;
  project_id: string;
  work_date: string;
  hours_worked: number;
  hours_overtime: number;
  notes: string;
};

export function NewTimesheetSheet({
  triggerLabel,
  title,
  description,
  currentEmployeeId,
  employees,
  projects,
  defaultDate,
  labels,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  currentEmployeeId: string;
  employees: Option[];
  projects: Option[];
  defaultDate: string;
  labels: {
    employee: string;
    project: string;
    workDate: string;
    hoursWorked: string;
    hoursOvertime: string;
    notes: string;
    notesPlaceholder: string;
    cancel: string;
    submit: string;
    submitting: string;
    successToast: string;
    errorToast: string;
    unassigned: string;
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
      employee_id: currentEmployeeId,
      project_id: "",
      work_date: defaultDate,
      hours_worked: 8,
      hours_overtime: 0,
      notes: "",
    },
  });

  const employeeId = watch("employee_id");
  const projectId = watch("project_id");

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const res = await submitTimesheetAction({
        employee_id: values.employee_id,
        project_id: values.project_id === "" ? undefined : values.project_id,
        work_date: values.work_date,
        hours_worked: Number(values.hours_worked),
        hours_overtime: Number(values.hours_overtime),
        notes: values.notes,
      });
      if (res.ok) {
        toast.success(labels.successToast);
        reset({
          employee_id: values.employee_id,
          project_id: values.project_id,
          work_date: values.work_date,
          hours_worked: 8,
          hours_overtime: 0,
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

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="hours_worked">{labels.hoursWorked}</Label>
              <Input
                id="hours_worked"
                type="number"
                min={0}
                max={24}
                step="0.25"
                {...register("hours_worked", {
                  required: true,
                  valueAsNumber: true,
                })}
                aria-invalid={!!errors.hours_worked}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="hours_overtime">{labels.hoursOvertime}</Label>
              <Input
                id="hours_overtime"
                type="number"
                min={0}
                max={12}
                step="0.25"
                {...register("hours_overtime", {
                  required: true,
                  valueAsNumber: true,
                })}
                aria-invalid={!!errors.hours_overtime}
              />
            </div>
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
              {pending ? labels.submitting : labels.submit}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
