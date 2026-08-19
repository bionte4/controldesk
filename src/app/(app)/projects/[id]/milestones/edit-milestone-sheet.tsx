"use client";

/**
 * Edit an existing milestone. Server enforcement in
 * `updateMilestoneAction`:
 *   • Canonical PDP `decideProjectMilestone('update')` — PM / OM /
 *     DIRECTOR / ADMIN (mirrors delete).
 *   • Σ `weight_bps` across the project must stay ≤ 10 000 — the
 *     action re-validates using `weightFitsBudget()` before writing.
 *
 * UX: reuses the same field-set as `NewMilestoneSheet` so the mental
 * model matches. Weight is entered in percent (5.25%) and translated
 * to bps on submit.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, Save } from "lucide-react";
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
  updateMilestoneSchema,
  type UpdateMilestoneInput,
} from "@/lib/validation/milestone";
import { percentToBps, bpsToPercent } from "@/lib/milestones/state";

import { updateMilestoneAction } from "./actions";
import type { EmployeeOption } from "./new-milestone-sheet";

type FormValues = {
  seq: string;
  name: string;
  description: string;
  weight_pct: string;
  planned_start_date: string;
  planned_end_date: string;
  owner_employee_id: string;
};

export type EditMilestoneInitial = {
  id: string;
  seq: number;
  name: string;
  description: string | null;
  weight_bps: number;
  planned_start_date: string | null;
  planned_end_date: string | null;
  owner_employee_id: string | null;
};

function toFormValues(m: EditMilestoneInitial): FormValues {
  return {
    seq: String(m.seq ?? 1),
    name: m.name ?? "",
    description: m.description ?? "",
    weight_pct: String(bpsToPercent(m.weight_bps ?? 0)),
    planned_start_date: m.planned_start_date ?? "",
    planned_end_date: m.planned_end_date ?? "",
    owner_employee_id: m.owner_employee_id ?? "",
  };
}

export function EditMilestoneSheet({
  milestone,
  employees,
  /**
   * Total weight already allocated to *other* milestones on this project
   * (excluding this milestone's own weight). Used for a friendly max-
   * remaining hint — the server still authoritatively re-checks via
   * `weightFitsBudget()` on submit.
   */
  otherWeightBps,
}: {
  milestone: EditMilestoneInitial;
  employees: EmployeeOption[];
  otherWeightBps: number;
}) {
  const t = useTranslations("milestones");
  const tf = useTranslations("milestones.form");
  const tCommon = useTranslations("common");

  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const defaults = React.useMemo(() => toFormValues(milestone), [milestone]);
  const form = useForm<FormValues>({
    defaultValues: defaults,
    resolver: async (values) => {
      const weightBps = percentToBps(Number(values.weight_pct));
      const parsed = updateMilestoneSchema.safeParse({
        id: milestone.id,
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
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults, open]);

  function onSubmit(values: FormValues) {
    const weightBps = percentToBps(Number(values.weight_pct));
    const remainingCapacityBps = 10_000 - otherWeightBps;
    if (weightBps > remainingCapacityBps) {
      form.setError("weight_pct", {
        message: tf("weightBudgetError", {
          remaining: bpsToPercent(Math.max(0, remainingCapacityBps)).toFixed(2),
        }),
      });
      return;
    }
    const payload: UpdateMilestoneInput = {
      id: milestone.id,
      seq: Number(values.seq),
      name: values.name,
      description: values.description || undefined,
      weight_bps: weightBps,
      planned_start_date: values.planned_start_date || undefined,
      planned_end_date: values.planned_end_date || undefined,
      owner_employee_id: values.owner_employee_id || undefined,
    };
    startTransition(async () => {
      const result = await updateMilestoneAction(payload);
      if (result.ok) {
        toast.success(tf("updated"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.reason);
      }
    });
  }

  const remainingPct = bpsToPercent(Math.max(0, 10_000 - otherWeightBps));

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset(defaults);
      }}
    >
      <SheetTrigger
        render={
          <Button size="sm" variant="ghost" aria-label={tCommon("edit")}>
            <Pencil className="size-4" />
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle>{tf("editTitle")}</SheetTitle>
          <SheetDescription>
            {tf("editDescription", { remaining: remainingPct.toFixed(2) })}
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
                      {tf("weightHint", { remaining: remainingPct.toFixed(2) })}
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
                    value={field.value ?? ""}
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
                ) : (
                  <Save className="mr-2 size-4" />
                )}
                {tf("submitEdit")}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
