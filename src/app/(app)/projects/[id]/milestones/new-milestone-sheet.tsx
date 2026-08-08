"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
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
  createMilestoneSchema,
  type CreateMilestoneInput,
} from "@/lib/validation/milestone";
import { percentToBps, bpsToPercent } from "@/lib/milestones/state";

import { createMilestoneAction } from "./actions";

export type EmployeeOption = { id: string; label: string };

type FormValues = {
  seq: string;
  name: string;
  description: string;
  weight_pct: string;
  planned_start_date: string;
  planned_end_date: string;
  owner_employee_id: string;
};

function makeDefaults(nextSeq: number, remainingBps: number): FormValues {
  return {
    seq: String(nextSeq),
    name: "",
    description: "",
    weight_pct: String(bpsToPercent(Math.max(0, Math.min(remainingBps, 2500)))),
    planned_start_date: "",
    planned_end_date: "",
    owner_employee_id: "",
  };
}

/**
 * Slide-over form to add a new milestone. Users type weight in *percent*
 * (0-100 with 2 decimals) — we translate to bps on submit so the API stays
 * on the DB storage unit.
 */
export function NewMilestoneSheet({
  projectId,
  nextSeq,
  remainingBps,
  employees,
}: {
  projectId: string;
  nextSeq: number;
  remainingBps: number;
  employees: EmployeeOption[];
}) {
  const t = useTranslations("milestones");
  const tf = useTranslations("milestones.form");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<FormValues>({
    defaultValues: makeDefaults(nextSeq, remainingBps),
    resolver: async (values) => {
      const weightBps = percentToBps(Number(values.weight_pct));
      const parsed = createMilestoneSchema.safeParse({
        project_id: projectId,
        seq: Number(values.seq),
        name: values.name,
        description: values.description || undefined,
        weight_bps: weightBps,
        planned_start_date: values.planned_start_date || undefined,
        planned_end_date: values.planned_end_date || undefined,
        owner_employee_id: values.owner_employee_id || undefined,
      });
      if (parsed.success) return { values, errors: {} };
      const errors: Record<string, { type: string; message: string }> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        if (!errors[path]) {
          errors[path] = { type: "validation", message: issue.message };
        }
      }
      return { values: {}, errors };
    },
  });

  React.useEffect(() => {
    if (!open) form.reset(makeDefaults(nextSeq, remainingBps));
  }, [nextSeq, remainingBps, open, form]);

  function onSubmit(values: FormValues) {
    const weightBps = percentToBps(Number(values.weight_pct));
    if (weightBps > remainingBps) {
      form.setError("weight_pct", {
        message: tf("weightBudgetError", {
          remaining: bpsToPercent(remainingBps).toFixed(2),
        }),
      });
      return;
    }
    const payload: CreateMilestoneInput = {
      project_id: projectId,
      seq: Number(values.seq),
      name: values.name,
      description: values.description || undefined,
      weight_bps: weightBps,
      planned_start_date: values.planned_start_date || undefined,
      planned_end_date: values.planned_end_date || undefined,
      owner_employee_id: values.owner_employee_id || undefined,
    };
    startTransition(async () => {
      const result = await createMilestoneAction(payload);
      if (result.ok) {
        toast.success(tf("created"));
        form.reset(makeDefaults(nextSeq + 1, remainingBps - weightBps));
        setOpen(false);
      } else {
        toast.error(result.reason);
      }
    });
  }

  const remainingPct = bpsToPercent(remainingBps);
  const disabled = remainingBps <= 0;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button size="sm" variant="outline" disabled={disabled}>
            <Plus className="size-4" />
            {t("new")}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl data-[side=right]:lg:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>{tf("title")}</SheetTitle>
          <SheetDescription>
            {tf("description", { remaining: remainingPct.toFixed(2) })}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
          >
            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="seq"
                render={({ field }) => (
                  <FormItem className="col-span-1">
                    <FormLabel>{tf("seq")}</FormLabel>
                    <FormControl>
                      <Input {...field} inputMode="numeric" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="weight_pct"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>{tf("weight")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode="decimal"
                        placeholder="25.50"
                      />
                    </FormControl>
                    <p className="text-[10px] text-muted-foreground">
                      {tf("weightHint", {
                        remaining: remainingPct.toFixed(2),
                      })}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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
                      rows={3}
                      {...field}
                      placeholder={tf("descriptionPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
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
            </div>

            <FormField
              control={form.control}
              name="owner_employee_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("owner")}</FormLabel>
                  <Select
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={tf("ownerPlaceholder")} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
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

            <SheetFooter className="mt-auto flex-row justify-end gap-2 px-0">
              <SheetClose
                render={
                  <Button variant="ghost" type="button" disabled={isPending}>
                    {tCommon("cancel")}
                  </Button>
                }
              />
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                {tf("submit")}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
