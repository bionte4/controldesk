"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
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
  filterUnitOptions,
  type UnitOption,
} from "@/lib/finance/unit-pengaju-filter";
import {
  createBudgetSchema,
  type CreateBudgetInput,
} from "@/lib/validation/budget";

import { createBudgetAction } from "./actions";

export type ProjectOption = { id: string; label: string };

type FormValues = {
  project_id: string;
  fiscal_year: string;
  title: string;
  notes: string;
  unit_pengaju: string;
};

const CURRENT_YEAR = new Date().getFullYear();

const DEFAULT_VALUES: FormValues = {
  project_id: "",
  fiscal_year: String(CURRENT_YEAR),
  title: "",
  notes: "",
  unit_pengaju: "",
};

export function NewBudgetSheet({
  projects,
  unitOptions: allUnitOptions = [],
  allowedUnitsByProject = {},
}: {
  projects: ProjectOption[];
  /**
   * Tenant `unit_pengaju` lookup, sourced from
   * `loadFieldOpsFormLookups()` so Field-Ops CA, General CA, and
   * Budget all read from the same master list.
   */
  unitOptions?: readonly UnitOption[];
  /**
   * Per-project whitelist (migration 0086). Missing key or empty
   * list = allow every option; see `filterUnitOptions()`.
   */
  allowedUnitsByProject?: Record<string, string[]>;
}) {
  const t = useTranslations("budgets");
  const tf = useTranslations("budgets.form");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<FormValues>({
    defaultValues: DEFAULT_VALUES,
    resolver: async (values) => {
      const parsed = createBudgetSchema.safeParse({
        project_id: values.project_id,
        fiscal_year: Number(values.fiscal_year),
        title: values.title,
        notes: values.notes || undefined,
        unit_pengaju: values.unit_pengaju || undefined,
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

  const projectId = form.watch("project_id");
  const currentUnit = form.watch("unit_pengaju");
  const { unitOptions, unitFiltered } = React.useMemo(
    () =>
      filterUnitOptions({
        projectId,
        allUnitOptions,
        allowedUnitsByProject,
      }),
    [projectId, allUnitOptions, allowedUnitsByProject],
  );
  React.useEffect(() => {
    if (!currentUnit || !unitFiltered) return;
    const stillAllowed = unitOptions.some((opt) => opt.label === currentUnit);
    if (!stillAllowed) form.setValue("unit_pengaju", "", { shouldDirty: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, unitFiltered]);

  function onSubmit(values: FormValues) {
    const payload: CreateBudgetInput = {
      project_id: values.project_id,
      fiscal_year: Number(values.fiscal_year),
      title: values.title,
      notes: values.notes || undefined,
      unit_pengaju: values.unit_pengaju || undefined,
    };
    startTransition(async () => {
      const result = await createBudgetAction(payload);
      if (result.ok) {
        toast.success(tf("created"));
        form.reset(DEFAULT_VALUES);
        setOpen(false);
        router.push(`/finance/budgets/${result.data.id}`);
      } else {
        toast.error(result.reason);
      }
    });
  }

  const hasProjects = projects.length > 0;
  const yearOptions = React.useMemo(() => {
    const years: string[] = [];
    for (let y = CURRENT_YEAR - 1; y <= CURRENT_YEAR + 2; y += 1) {
      years.push(String(y));
    }
    return years;
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button size="sm" disabled={!hasProjects}>
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
          <SheetDescription>{tf("description")}</SheetDescription>
        </SheetHeader>

        {!hasProjects ? (
          <div className="px-4 text-sm text-muted-foreground">
            {tf("needsProject")}
          </div>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
            >
              <FormField
                control={form.control}
                name="project_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("project")}</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={tf("projectPlaceholder")} />
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

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="fiscal_year"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tf("fiscalYear")}</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {yearOptions.map((y) => (
                            <SelectItem key={y} value={y}>
                              {y}
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
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tf("titleField")}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="FY2026 pilot budget" />
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
                    <FormLabel>{tf("notes")}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        {...field}
                        placeholder={tf("notesPlaceholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="unit_pengaju"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("unitPengaju")}</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                      disabled={unitOptions.length === 0}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue
                            placeholder={
                              unitOptions.length === 0
                                ? unitFiltered
                                  ? tf("unitPengajuNoneAllowed")
                                  : tf("unitPengajuEmpty")
                                : tf("unitPengajuPlaceholder")
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {unitOptions.map((opt) => (
                          <SelectItem key={opt.id} value={opt.label}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {unitFiltered ? (
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {tf("unitPengajuFilteredHint")}
                      </p>
                    ) : null}
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
        )}
      </SheetContent>
    </Sheet>
  );
}
