"use client";

/**
 * Edit a UPK note while it is still in DRAFT. Server enforcement in
 * `updateUpkNoteAction`:
 *   • PDP `decideUpkNote('update')` — PM / OM / FINANCE / HR /
 *     TENANT_ADMIN may edit; drafter may edit their own draft.
 *   • Status must equal `DRAFT` (see actions.ts:100). Once submitted
 *     to Finance the note becomes immutable except via reject/cancel
 *     back to draft.
 *   • `computed_upk` is recomputed server-side from base_salary,
 *     multiplier, and service_months.
 *
 * Parent (`[id]/page.tsx`) already gates on `isDrafter && status ===
 * "DRAFT"` — this sheet mirrors that. PDP re-authorizes on submit.
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
import { parseMoneyFromDb } from "@/lib/format/money";

import { updateUpkNoteAction } from "../actions";

type FormValues = {
  contract_end_date: string;
  service_months: string;
  base_salary_idr: string;
  multiplier: string;
  justification: string;
};

export type EditUpkInitial = {
  id: string;
  contract_end_date: string;
  service_months: number;
  base_salary_db: string | number;
  multiplier: string | number;
  justification: string | null;
};

function toFormValues(v: EditUpkInitial): FormValues {
  let baseInt = "";
  try {
    baseInt = String(parseMoneyFromDb(v.base_salary_db));
  } catch {
    baseInt = String(v.base_salary_db ?? "");
  }
  return {
    contract_end_date: v.contract_end_date ?? "",
    service_months: String(v.service_months ?? 0),
    base_salary_idr: baseInt,
    multiplier: String(v.multiplier ?? 1),
    justification: v.justification ?? "",
  };
}

export function EditUpkNoteSheet({ upk }: { upk: EditUpkInitial }) {
  const t = useTranslations("upk");
  const tf = useTranslations("upk.form");
  const tCommon = useTranslations("common");

  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const defaults = React.useMemo(() => toFormValues(upk), [upk]);
  const form = useForm<FormValues>({ defaultValues: defaults });

  React.useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults, open]);

  function onSubmit(values: FormValues) {
    const months = Number.parseInt(values.service_months, 10);
    const baseInt = Number.parseInt(
      values.base_salary_idr.replace(/[^0-9]/g, ""),
      10,
    );
    const mult = Number.parseFloat(values.multiplier);
    if (!Number.isFinite(months) || months < 0) {
      form.setError("service_months", { message: tf("serviceMonthsHint") });
      return;
    }
    if (!Number.isFinite(baseInt) || baseInt < 0) {
      form.setError("base_salary_idr", { message: tf("baseSalary") });
      return;
    }
    if (!Number.isFinite(mult) || mult < 0 || mult > 12) {
      form.setError("multiplier", { message: tf("multiplierHint") });
      return;
    }
    startTransition(async () => {
      const res = await updateUpkNoteAction({
        id: upk.id,
        contract_end_date: values.contract_end_date,
        service_months: months,
        base_salary_idr: baseInt,
        multiplier: mult,
        justification: values.justification.trim() || undefined,
      });
      if (res.ok) {
        toast.success(tf("updatedToast"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.reason);
      }
    });
  }

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
          <Button size="sm" variant="outline">
            <Pencil className="size-4" />
            {tCommon("edit")}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle>{tf("editTitle")}</SheetTitle>
          <SheetDescription>{tf("editDescription")}</SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
          >
            <FormField
              control={form.control}
              name="contract_end_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("contractEndDate")}</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="service_months"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("serviceMonths")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode="numeric"
                        placeholder="12"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="multiplier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("multiplier")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode="decimal"
                        placeholder="1.0"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="base_salary_idr"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("baseSalary")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      inputMode="numeric"
                      placeholder="10000000"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="justification"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("justification")}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={4}
                      {...field}
                      placeholder={tf("justificationPlaceholder")}
                    />
                  </FormControl>
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
