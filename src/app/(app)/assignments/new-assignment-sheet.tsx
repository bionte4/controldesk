"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  ASSIGNMENT_ROLES,
  createAssignmentSchema,
  isPmRole,
  type CreateAssignmentInput,
} from "@/lib/validation/assignment";

import { createAssignmentAction } from "./actions";

export type ProjectOption = {
  id: string;
  label: string;
};

export type EmployeeOption = {
  id: string;
  full_name: string;
  role: string;
};

export type WorkloadLookup = Record<
  string,
  { total: number; remaining: number }
>;

type Translator = (key: string, values?: Record<string, string | number>) => string;

const DEFAULT_VALUES: CreateAssignmentInput = {
  project_id: "",
  employee_id: "",
  role: "MEMBER",
  allocation_percentage: 100,
  started_at: new Date().toISOString().slice(0, 10),
  ended_at: undefined,
  notes: undefined,
};

export function NewAssignmentSheet({
  projects,
  employees,
  workload,
  triggerLabel,
  disabled,
  buttonVariant = "default",
  lockedProject,
}: {
  projects: ProjectOption[];
  employees: EmployeeOption[];
  workload: WorkloadLookup;
  triggerLabel: string;
  disabled?: boolean;
  buttonVariant?: "default" | "outline";
  /**
   * When set, the sheet is opened from a project detail context: the project
   * field is locked to this option (rendered as a read-only chip) and the
   * form is submitted with this `project_id` pre-filled. Enables PM to add a
   * team member without navigating away from the project page.
   */
  lockedProject?: ProjectOption;
}) {
  const t = useTranslations("assignments") as unknown as Translator;
  const tCommon = useTranslations("common") as unknown as Translator;

  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const initialValues = React.useMemo<CreateAssignmentInput>(
    () => ({
      ...DEFAULT_VALUES,
      project_id: lockedProject?.id ?? "",
    }),
    [lockedProject?.id],
  );

  const form = useForm<CreateAssignmentInput>({
    resolver: zodResolver(createAssignmentSchema),
    defaultValues: initialValues,
    mode: "onBlur",
  });

  const selectedEmployeeId = form.watch("employee_id");
  const selectedRole = form.watch("role");
  const selectedAllocation = form.watch("allocation_percentage");

  const selectedEmployee = React.useMemo(
    () => employees.find((e) => e.id === selectedEmployeeId),
    [employees, selectedEmployeeId],
  );

  // Compute remaining capacity live from the workload lookup.
  const capacity = React.useMemo(() => {
    if (!selectedEmployeeId) return null;
    const entry = workload[selectedEmployeeId];
    return entry ?? { total: 0, remaining: 100 };
  }, [selectedEmployeeId, workload]);

  const isPm = isPmRole(selectedRole);

  // If user flips to a PM role, force allocation to 100 for coherence with
  // the DB rule that PMs are always 100%.
  React.useEffect(() => {
    if (isPm && selectedAllocation !== 100) {
      form.setValue("allocation_percentage", 100);
    }
  }, [isPm, selectedAllocation, form]);

  const capacityWarning = React.useMemo(() => {
    if (!capacity || !selectedAllocation || isPm) return null;
    if (capacity.remaining < selectedAllocation) {
      return t("form.capacityWarning", {
        remaining: capacity.remaining,
        requested: selectedAllocation,
      });
    }
    return null;
  }, [capacity, selectedAllocation, isPm, t]);

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const res = await createAssignmentAction(values);
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      toast.success(t("actions.createdToast"));
      // Preserve `lockedProject` so PMs can quickly add multiple members
      // in a row without re-selecting the project.
      form.reset(initialValues);
      setOpen(false);
    });
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button size="sm" variant={buttonVariant} disabled={disabled}>
            <UserPlus className="size-4" />
            {triggerLabel}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl data-[side=right]:lg:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>{t("form.title")}</SheetTitle>
          <SheetDescription>{t("form.description")}</SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={onSubmit}
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
          >
            {/* Row 1: Project — full width so long "PRJ-YYYY-#### — Name" fits.
                When invoked from a project detail page, `lockedProject` is set
                and we render a read-only chip instead of a select so the PM
                can't accidentally assign to a different project. */}
            {lockedProject ? (
              <FormItem className="min-w-0">
                <FormLabel>{t("form.project")}</FormLabel>
                <div
                  data-slot="locked-project"
                  className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-foreground"
                  aria-readonly="true"
                >
                  <span className="block min-w-0 flex-1 truncate">
                    {lockedProject.label}
                  </span>
                </div>
                {/* Keep RHF aware of the value so submit passes validation. */}
                <input type="hidden" {...form.register("project_id")} />
              </FormItem>
            ) : (
              <FormField
                control={form.control}
                name="project_id"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>
                      {t("form.project")}{" "}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full min-w-0">
                          <SelectValue>
                            {(value: unknown) => {
                              const opt = projects.find((p) => p.id === value);
                              return (
                                <span
                                  className={cn(
                                    "block min-w-0 flex-1 truncate text-left",
                                    !opt && "text-muted-foreground",
                                  )}
                                >
                                  {opt
                                    ? opt.label
                                    : t("form.projectPlaceholder")}
                                </span>
                              );
                            }}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Row 2: Role + Employee side-by-side on md+, stacked below. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>
                      {t("form.role")} <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full min-w-0">
                          <SelectValue>
                            {(value: unknown) =>
                              value ? (
                                <span className="block min-w-0 flex-1 truncate text-left">
                                  {t(`roles.${String(value)}`)}
                                </span>
                              ) : (
                                <span className="block min-w-0 flex-1 truncate text-left text-muted-foreground">
                                  {t("form.rolePlaceholder")}
                                </span>
                              )
                            }
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ASSIGNMENT_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {t(`roles.${r}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="employee_id"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>
                      {t("form.employee")} <span className="text-destructive">*</span>
                    </FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full min-w-0">
                          <SelectValue>
                            {(value: unknown) => {
                              const opt = employees.find((e) => e.id === value);
                              return (
                                <span
                                  className={cn(
                                    "block min-w-0 flex-1 truncate text-left",
                                    !opt && "text-muted-foreground",
                                  )}
                                >
                                  {opt
                                    ? opt.full_name
                                    : t("form.employeePlaceholder")}
                                </span>
                              );
                            }}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {employees.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Live capacity indicator */}
            {selectedEmployee && capacity && !isPm && (
              <div
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs",
                  capacityWarning
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                )}
                aria-live="polite"
              >
                <div className="font-medium">
                  {t("form.remainingCapacity", {
                    name: selectedEmployee.full_name,
                    pct: capacity.remaining,
                  })}
                </div>
                {capacityWarning ? (
                  <div className="mt-1">{capacityWarning}</div>
                ) : (
                  <div className="mt-1 opacity-80">{t("form.capacityOk")}</div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="started_at"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>
                      {t("form.startDate")} <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        className="w-full min-w-0"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ended_at"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{t("form.endDate")}</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        className="w-full min-w-0"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(e.target.value || undefined)
                        }
                        onBlur={field.onBlur}
                        name={field.name}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="allocation_percentage"
                render={({ field }) => (
                  <FormItem className="min-w-0 sm:col-span-2 md:col-span-1">
                    <FormLabel>
                      {t("form.allocation")} <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        step={1}
                        disabled={isPm}
                        className="w-full min-w-0 text-right tabular-nums"
                        value={field.value ?? 0}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === "" ? 0 : Number(e.target.value),
                          )
                        }
                        onBlur={field.onBlur}
                        name={field.name}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.notes")}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={3}
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(e.target.value || undefined)
                      }
                      onBlur={field.onBlur}
                      name={field.name}
                      placeholder={t("form.notesPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <SheetFooter className="mt-auto flex-row items-center justify-between gap-2 px-0">
              <p className="text-xs text-muted-foreground">
                {t("form.idAutoAssigned")}
              </p>
              <div className="flex items-center gap-2">
                <SheetClose
                  render={
                    <Button variant="ghost" type="button" disabled={isPending}>
                      {tCommon("cancel")}
                    </Button>
                  }
                />
                <button
                  type="submit"
                  disabled={isPending || Boolean(capacityWarning)}
                  data-slot="button"
                  className="group/button inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium whitespace-nowrap text-primary-foreground transition-all hover:bg-primary/80 disabled:pointer-events-none disabled:opacity-50"
                >
                  {isPending ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : null}
                  {t("form.save")}
                </button>
              </div>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
