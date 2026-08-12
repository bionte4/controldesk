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
import { Switch } from "@/components/ui/switch";

import {
  createWorkShiftAction,
  updateWorkShiftAction,
} from "./actions";

export type ShiftFormLabels = {
  title: string;
  description: string;
  code: string;
  codeHelp: string;
  name: string;
  startTime: string;
  endTime: string;
  duration: string;
  durationHelp: string;
  isNight: string;
  allowance: string;
  allowanceHrOnly: string;
  project: string;
  projectPlaceholder: string;
  projectRequired: string;
  baseCatalog: string;
  cancel: string;
  save: string;
  saving: string;
  successToast: string;
  errorToast: string;
};

type ProjectOption = { id: string; code: string; name: string };

type Existing = {
  id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  duration_hours: number;
  shift_allowance_idr: number;
  is_night: boolean;
  project_id: string | null;
};

type FormValues = {
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  duration_hours: string;
  shift_allowance_idr: string;
  is_night: boolean;
  project_id: string;
};

const BASE_SENTINEL = "__base";

export function ShiftUpsertSheet({
  triggerLabel,
  triggerRender,
  isHrOm,
  projects,
  existing,
  labels,
  open: openProp,
  onOpenChange,
}: {
  /** Rendered when no custom trigger is provided. */
  triggerLabel?: string;
  /** Provide a custom trigger element (e.g. an edit menu item). Skip
   * this and `triggerLabel` when driving the sheet from a parent. */
  triggerRender?: React.ReactElement;
  /** HR/OM tier — enables the allowance + base-catalog options. */
  isHrOm: boolean;
  /** Projects the current user can attach a shift to. HR/OM sees
   * every project in the tenant; SPV/PM sees only assignments. */
  projects: ProjectOption[];
  /** When provided, the sheet is in edit mode. */
  existing?: Existing;
  labels: ShiftFormLabels;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [pending, startTransition] = React.useTransition();

  const defaultProjectId = React.useMemo(() => {
    if (existing) {
      return existing.project_id ?? (isHrOm ? BASE_SENTINEL : "");
    }
    if (isHrOm) return BASE_SENTINEL;
    return projects[0]?.id ?? "";
  }, [existing, isHrOm, projects]);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      code: existing?.code ?? "",
      name: existing?.name ?? "",
      start_time: existing?.start_time ?? "08:00",
      end_time: existing?.end_time ?? "17:00",
      duration_hours: String(existing?.duration_hours ?? 8),
      shift_allowance_idr: String(existing?.shift_allowance_idr ?? 0),
      is_night: existing?.is_night ?? false,
      project_id: defaultProjectId,
    },
  });

  // Reset form on `existing` change (e.g. reusing the sheet for edits).
  React.useEffect(() => {
    reset({
      code: existing?.code ?? "",
      name: existing?.name ?? "",
      start_time: existing?.start_time ?? "08:00",
      end_time: existing?.end_time ?? "17:00",
      duration_hours: String(existing?.duration_hours ?? 8),
      shift_allowance_idr: String(existing?.shift_allowance_idr ?? 0),
      is_night: existing?.is_night ?? false,
      project_id: defaultProjectId,
    });
  }, [existing, defaultProjectId, reset]);

  const projectId = watch("project_id");
  const isNight = watch("is_night");

  const projectOptions = React.useMemo(() => {
    return projects.map((p) => ({
      value: p.id,
      label: `${p.code} — ${p.name}`,
    }));
  }, [projects]);

  const onSubmit = handleSubmit((values) => {
    const projectSelection = values.project_id;
    const finalProjectId =
      projectSelection === "" || projectSelection === BASE_SENTINEL
        ? null
        : projectSelection;

    // Client-side guard mirroring the PDP contract — SPV/PM MUST pick
    // a project. HR/OM may pick base catalog.
    if (!isHrOm && !finalProjectId) {
      toast.error(labels.projectRequired);
      return;
    }

    startTransition(async () => {
      const payload = {
        code: values.code,
        name: values.name,
        start_time: values.start_time,
        end_time: values.end_time,
        duration_hours: Number(values.duration_hours),
        shift_allowance_idr: Number(values.shift_allowance_idr),
        is_night: values.is_night,
        project_id: finalProjectId,
      };
      const res = existing
        ? await updateWorkShiftAction({ id: existing.id, ...payload })
        : await createWorkShiftAction(payload);
      if (res.ok) {
        toast.success(labels.successToast);
        if (!existing) {
          reset({
            code: "",
            name: "",
            start_time: "08:00",
            end_time: "17:00",
            duration_hours: "8",
            shift_allowance_idr: "0",
            is_night: false,
            project_id: defaultProjectId,
          });
        }
        setOpen(false);
      } else {
        toast.error(res.reason ?? labels.errorToast);
      }
    });
  });

  // When the parent controls `open` explicitly, we don't need a
  // SheetTrigger at all — omitting it also avoids the Base UI
  // "nativeButton on non-<button>" warning that hidden-span workarounds
  // trigger. When uncontrolled, render the default trigger button.
  const isControlled = openProp !== undefined;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {isControlled ? null : triggerRender ? (
        <SheetTrigger render={triggerRender} />
      ) : (
        <SheetTrigger
          render={<Button size="sm">{triggerLabel ?? labels.title}</Button>}
        />
      )}
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl data-[side=right]:lg:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>{labels.title}</SheetTitle>
          <SheetDescription>{labels.description}</SheetDescription>
        </SheetHeader>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4 px-4">
          {/* Project scope — always first because it drives the write
              permission at the DB level. Edits keep the same scope. */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="project_id">{labels.project}</Label>
            <Select
              value={projectId === "" ? undefined : projectId}
              onValueChange={(v) => setValue("project_id", v ?? "")}
              disabled={Boolean(existing)}
            >
              <SelectTrigger
                id="project_id"
                aria-label={labels.project}
                className="w-full"
              >
                <SelectValue placeholder={labels.projectPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {isHrOm ? (
                  <SelectItem value={BASE_SENTINEL}>
                    {labels.baseCatalog}
                  </SelectItem>
                ) : null}
                {projectOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {existing ? (
              <p className="text-xs text-muted-foreground">
                {/* Scope is immutable after creation — the server
                    action rejects scope migration outright. */}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">{labels.code}</Label>
              <Input
                id="code"
                placeholder="DAY"
                {...register("code", { required: true, maxLength: 20 })}
                aria-invalid={!!errors.code}
              />
              <p className="text-xs text-muted-foreground">{labels.codeHelp}</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{labels.name}</Label>
              <Input
                id="name"
                placeholder="Day shift 08–17"
                {...register("name", { required: true, maxLength: 80 })}
                aria-invalid={!!errors.name}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="start_time">{labels.startTime}</Label>
              <Input
                id="start_time"
                type="time"
                step="60"
                {...register("start_time", { required: true })}
                aria-invalid={!!errors.start_time}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="end_time">{labels.endTime}</Label>
              <Input
                id="end_time"
                type="time"
                step="60"
                {...register("end_time", { required: true })}
                aria-invalid={!!errors.end_time}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="duration_hours">{labels.duration}</Label>
              <Input
                id="duration_hours"
                type="number"
                step="0.5"
                min="0.5"
                max="24"
                {...register("duration_hours", { required: true })}
                aria-invalid={!!errors.duration_hours}
              />
              <p className="text-xs text-muted-foreground">
                {labels.durationHelp}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="is_night" className="cursor-pointer">
                  {labels.isNight}
                </Label>
              </div>
              <Switch
                id="is_night"
                checked={isNight}
                onCheckedChange={(v) => setValue("is_night", Boolean(v))}
              />
            </div>
          </div>

          {/* Allowance — hidden for PM/SPV since the DB trigger will
              force-inherit it. Showing a disabled 0 confuses users, so
              omit entirely. HR/OM see + edit it. */}
          {isHrOm ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="shift_allowance_idr">{labels.allowance}</Label>
              <Input
                id="shift_allowance_idr"
                type="number"
                step="1000"
                min="0"
                {...register("shift_allowance_idr", { required: true })}
                aria-invalid={!!errors.shift_allowance_idr}
              />
              <p className="text-xs text-muted-foreground">
                {labels.allowanceHrOnly}
              </p>
            </div>
          ) : null}

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
