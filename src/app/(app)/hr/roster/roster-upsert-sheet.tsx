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

/**
 * Shift options carry `projectId` so we can filter the dropdown by the
 * currently selected project. `null` = base catalog (always visible);
 * a non-null value = project-scoped override (shown only when its
 * project is selected).
 */
type ShiftOption = Option & {
  projectId: string | null;
  projectCode: string | null;
};

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
  allowedProjectIdsByEmployee,
  defaultDate,
  labels,
}: {
  triggerLabel: string;
  title: string;
  description: string;
  employees: Option[];
  shifts: ShiftOption[];
  projects: Option[];
  /**
   * Optional whitelist keyed by employee id. When present, the
   * project dropdown only shows projects the picked employee has an
   * ACTIVE assignment on. Falls back to the full `projects` list when
   * no map is passed (e.g. legacy callers) or when the map contains
   * no entry for the current employee.
   */
  allowedProjectIdsByEmployee?: Record<string, string[]>;
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

  // Only base shifts are always available. Project-scoped shifts
  // filter into view once a project is selected. Pick the first
  // base shift as the initial value so the trigger isn't blank.
  const baseShifts = React.useMemo(
    () => shifts.filter((s) => s.projectId === null),
    [shifts],
  );

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
      shift_id: baseShifts[0]?.value ?? shifts[0]?.value ?? "",
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

  // Compute the visible shift list based on the selected project.
  // Rules:
  //   1. Base shifts (`projectId === null`) are always visible.
  //   2. Project-scoped shifts are visible only when their
  //      `projectId` matches the currently selected project.
  //   3. If a project override shares a `code` with a base shift, the
  //      project version wins (base row is filtered out for that
  //      code). This lets a project temporarily re-time "DAY" for
  //      itself without renaming.
  const visibleShifts = React.useMemo(() => {
    const scoped = projectId
      ? shifts.filter((s) => s.projectId === projectId)
      : [];
    const overriddenCodes = new Set(
      scoped.map((s) => s.label.split(" — ")[0]),
    );
    const base = baseShifts.filter(
      (s) => !overriddenCodes.has(s.label.split(" — ")[0]),
    );
    return [...scoped, ...base].sort((a, b) => a.label.localeCompare(b.label));
  }, [shifts, baseShifts, projectId]);

  // If a project change makes the currently selected shift invalid
  // (e.g. it belonged to a different project), reset to the first
  // visible option.
  React.useEffect(() => {
    if (!shiftId) return;
    const stillValid = visibleShifts.some((s) => s.value === shiftId);
    if (!stillValid && visibleShifts[0]) {
      setValue("shift_id", visibleShifts[0].value);
    }
  }, [visibleShifts, shiftId, setValue]);

  // Base UI's `SelectValue` renders the raw `value` prop unless we
  // pass children that map it back to a label. Pre-compute lookups so
  // the trigger shows "Alice · A100" instead of "b8808630-…".
  const selectedEmployee = React.useMemo(
    () => employees.find((e) => e.value === employeeId),
    [employees, employeeId],
  );
  const selectedShift = React.useMemo(
    () => shifts.find((s) => s.value === shiftId),
    [shifts, shiftId],
  );
  // Filter project dropdown to just the picked employee's ACTIVE
  // assignments — server-side validation will otherwise reject on
  // submit. If no whitelist is passed for this employee, we fall back
  // to the full list so the form stays usable during migration /
  // legacy call sites.
  const visibleProjects = React.useMemo(() => {
    const allowed = employeeId
      ? allowedProjectIdsByEmployee?.[employeeId]
      : undefined;
    if (!allowed) return projects;
    const set = new Set(allowed);
    return projects.filter((p) => set.has(p.value));
  }, [projects, allowedProjectIdsByEmployee, employeeId]);

  // Reset project selection when the currently-picked project would
  // no longer be allowed for the newly-picked employee — inline in
  // the employee-select `onValueChange` (see below) rather than an
  // effect, which the React Compiler flags as a cascading render.

  const selectedProject = React.useMemo(
    () => visibleProjects.find((p) => p.value === projectId),
    [visibleProjects, projectId],
  );

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
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl data-[side=right]:lg:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4 px-4">
          {/* Employee + Shift on the same row on md+ — both are the
              two "who + what schedule" picks. Keeping them side-by-
              side matches the natural mental grouping. */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="employee_id">{labels.employee}</Label>
              <Select
                value={employeeId}
                onValueChange={(v) => {
                  const nextEmp = v ?? "";
                  setValue("employee_id", nextEmp);
                  // If the previously picked project isn't in the
                  // new employee's allowed set, clear it to force a
                  // re-pick from the filtered list.
                  const allowed = nextEmp
                    ? allowedProjectIdsByEmployee?.[nextEmp]
                    : undefined;
                  if (allowed && projectId && !allowed.includes(projectId)) {
                    setValue("project_id", "");
                  }
                }}
              >
                <SelectTrigger id="employee_id" aria-label={labels.employee}>
                  <SelectValue>{selectedEmployee?.label}</SelectValue>
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
                  <SelectValue>
                    {selectedShift ? (
                      <span className="flex items-center gap-1.5">
                        {selectedShift.label}
                        {selectedShift.projectId ? (
                          <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-indigo-300">
                            Custom
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {visibleShifts.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      <span className="flex items-center gap-1.5">
                        {opt.label}
                        {opt.projectId ? (
                          <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-indigo-300">
                            Custom
                          </span>
                        ) : null}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Project on its own row — often the widest label, and
              users scan for it before picking date / status. */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="project_id">{labels.project}</Label>
            <Select
              value={projectId === "" ? "__none" : projectId}
              onValueChange={(v) =>
                setValue("project_id", !v || v === "__none" ? "" : v)
              }
            >
              <SelectTrigger id="project_id" aria-label={labels.project}>
                <SelectValue>
                  {selectedProject?.label ?? labels.unassigned}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">{labels.unassigned}</SelectItem>
                {visibleProjects.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {employeeId &&
            allowedProjectIdsByEmployee &&
            (allowedProjectIdsByEmployee[employeeId]?.length ?? 0) === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {labels.unassigned}
              </p>
            ) : null}
          </div>

          {/* Date + Status side-by-side — short controls that would
              otherwise leave dead space on the right on wider sheets. */}
          <div className="grid gap-4 md:grid-cols-2">
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
                  <SelectValue>{labels.statuses[statusVal]}</SelectValue>
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
