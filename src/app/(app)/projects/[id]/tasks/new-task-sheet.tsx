"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Pencil } from "lucide-react";
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
import {
  createTaskSchema,
  updateTaskSchema,
  type CreateTaskInput,
  type UpdateTaskInput,
} from "@/lib/validation/task";

import { createTaskAction, updateTaskAction } from "./actions";

export type EmployeeOption = { id: string; label: string };
export type MilestoneOption = { id: string; label: string };
export type TaskOption = {
  id: string;
  label: string;
  wbs_code: string;
  depth: number;
};

type Mode = "create" | "edit";

type FormValues = {
  name: string;
  description: string;
  parent_task_id: string;
  milestone_id: string;
  owner_employee_id: string;
  depends_on_task_id: string;
  weight_pct: string;
  progress_pct: string;
  planned_start_date: string;
  planned_end_date: string;
  budget_amount: string;
};

const emptyDefaults: FormValues = {
  name: "",
  description: "",
  parent_task_id: "",
  milestone_id: "",
  owner_employee_id: "",
  depends_on_task_id: "",
  weight_pct: "0",
  progress_pct: "0",
  planned_start_date: "",
  planned_end_date: "",
  budget_amount: "",
};

/**
 * Polymorphic sheet for creating a task, adding a sub-task, or editing an
 * existing task. Pass `mode="edit"` + `initial` to pre-populate.
 */
export function TaskSheet(props: {
  mode: Mode;
  projectId: string;
  parents: TaskOption[];
  milestones: MilestoneOption[];
  employees: EmployeeOption[];
  predecessors: TaskOption[];
  initial?: Partial<FormValues> & { id?: string };
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "ghost";
  triggerIcon?: "plus" | "pencil";
  triggerSize?: "sm" | "default" | "icon";
  onDone?: () => void;
}) {
  const {
    mode,
    projectId,
    parents,
    milestones,
    employees,
    predecessors,
    initial,
    triggerLabel,
    triggerVariant = "default",
    triggerIcon = "plus",
    triggerSize = "sm",
    onDone,
  } = props;

  const t = useTranslations("tasks");
  const tf = useTranslations("tasks.form");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const defaults: FormValues = { ...emptyDefaults, ...(initial ?? {}) };

  const form = useForm<FormValues>({
    defaultValues: defaults,
    resolver: async (values) => {
      const payload = {
        project_id: projectId,
        name: values.name,
        description: values.description || undefined,
        parent_task_id: values.parent_task_id || null,
        milestone_id: values.milestone_id || null,
        owner_employee_id: values.owner_employee_id || null,
        depends_on_task_id: values.depends_on_task_id || null,
        weight_pct: values.weight_pct ? Number(values.weight_pct) : 0,
        progress_pct: values.progress_pct ? Number(values.progress_pct) : 0,
        planned_start_date: values.planned_start_date || null,
        planned_end_date: values.planned_end_date || null,
        budget_amount: values.budget_amount
          ? Number(values.budget_amount)
          : null,
      };
      const parsed =
        mode === "create"
          ? createTaskSchema.safeParse(payload)
          : updateTaskSchema.safeParse({ ...payload, id: initial?.id });
      if (parsed.success) return { values, errors: {} };
      const errors: Record<string, { type: string; message: string }> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        if (path === "project_id" || path === "id") continue;
        if (!errors[path]) {
          errors[path] = { type: "validation", message: issue.message };
        }
      }
      return { values: {}, errors };
    },
  });

  React.useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      if (mode === "create") {
        const input: CreateTaskInput = {
          project_id: projectId,
          name: values.name,
          description: values.description || undefined,
          parent_task_id: values.parent_task_id || null,
          milestone_id: values.milestone_id || null,
          owner_employee_id: values.owner_employee_id || null,
          depends_on_task_id: values.depends_on_task_id || null,
          weight_pct: values.weight_pct ? Number(values.weight_pct) : 0,
          progress_pct: values.progress_pct ? Number(values.progress_pct) : 0,
          planned_start_date: values.planned_start_date || null,
          planned_end_date: values.planned_end_date || null,
          budget_amount: values.budget_amount
            ? Number(values.budget_amount)
            : null,
        };
        const result = await createTaskAction(input);
        if (!result?.ok) {
          toast.error(result?.reason ?? "Something went wrong");
          return;
        }
        toast.success(tf("created"));
      } else {
        if (!initial?.id) return;
        const input: UpdateTaskInput = {
          id: initial.id,
          name: values.name,
          description: values.description || undefined,
          milestone_id: values.milestone_id || null,
          owner_employee_id: values.owner_employee_id || null,
          depends_on_task_id: values.depends_on_task_id || null,
          weight_pct: values.weight_pct ? Number(values.weight_pct) : 0,
          progress_pct: values.progress_pct ? Number(values.progress_pct) : 0,
          planned_start_date: values.planned_start_date || null,
          planned_end_date: values.planned_end_date || null,
          budget_amount: values.budget_amount
            ? Number(values.budget_amount)
            : null,
        };
        const result = await updateTaskAction(input);
        if (!result?.ok) {
          toast.error(result?.reason ?? "Something went wrong");
          return;
        }
        toast.success(tf("updated"));
      }
      setOpen(false);
      onDone?.();
    });
  }

  const TriggerIcon = triggerIcon === "pencil" ? Pencil : Plus;
  const defaultLabel = mode === "create" ? t("new") : tf("titleEdit");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant={triggerVariant} size={triggerSize}>
            <TriggerIcon className="size-4" />
            {triggerLabel ?? defaultLabel}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl data-[side=right]:lg:max-w-3xl overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>
            {mode === "create" ? tf("titleCreate") : tf("titleEdit")}
          </SheetTitle>
          <SheetDescription>{tf("description")}</SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="@container flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-2"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("name")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={tf("namePlaceholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("descriptionLabel")}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder={tf("descriptionPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {mode === "create" ? (
              <FormField
                control={form.control}
                name="parent_task_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("parent")}</FormLabel>
                    <Select
                      value={field.value || "__root__"}
                      onValueChange={(v) =>
                        field.onChange(v === "__root__" ? "" : v)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tf("parentPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__root__">
                          {tf("parentPlaceholder")}
                        </SelectItem>
                        {parents.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {"  ".repeat(p.depth)}
                            {p.wbs_code} · {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {/* Assignment row — Milestone + Owner */}
            <div className="grid gap-3 @md:grid-cols-2">
              <FormField
                control={form.control}
                name="milestone_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("milestone")}</FormLabel>
                    <Select
                      value={field.value || "__none__"}
                      onValueChange={(v) =>
                        field.onChange(v === "__none__" ? "" : v)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tf("milestonePlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">
                          {tf("milestonePlaceholder")}
                        </SelectItem>
                        {milestones.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.label}
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
                name="owner_employee_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("owner")}</FormLabel>
                    <Select
                      value={field.value || "__none__"}
                      onValueChange={(v) =>
                        field.onChange(v === "__none__" ? "" : v)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tf("ownerPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">
                          {tf("ownerPlaceholder")}
                        </SelectItem>
                        {employees.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Metrics row — Weight + Progress + Budget on wide, 2-up on md,
                stacked on narrow sheets */}
            <div className="grid gap-3 @md:grid-cols-2 @lg:grid-cols-3">
              <FormField
                control={form.control}
                name="weight_pct"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("weight")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step={0.01}
                        min={0}
                        max={100}
                        {...field}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      {tf("weightHint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="progress_pct"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("progress")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step={0.01}
                        min={0}
                        max={100}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="budget_amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("budget")}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step={1}
                        min={0}
                        {...field}
                        placeholder={tf("budgetPlaceholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Schedule row — Planned start + Planned end + Predecessor */}
            <div className="grid gap-3 @md:grid-cols-2 @lg:grid-cols-3">
              <FormField
                control={form.control}
                name="planned_start_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("plannedStart")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="planned_end_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("plannedEnd")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="depends_on_task_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("dependsOn")}</FormLabel>
                    <Select
                      value={field.value || "__none__"}
                      onValueChange={(v) =>
                        field.onChange(v === "__none__" ? "" : v)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tf("dependsOnPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">
                          {tf("dependsOnPlaceholder")}
                        </SelectItem>
                        {predecessors.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.wbs_code} · {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <SheetFooter>
              <SheetClose
                render={
                  <Button type="button" variant="outline" disabled={isPending}>
                    {tCommon("cancel")}
                  </Button>
                }
              />
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : null}
                {mode === "create" ? tf("submitCreate") : tf("submitEdit")}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
