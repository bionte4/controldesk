"use client";

/**
 * Edit draft (or PENDING_L1_SUPERVISOR) expense.
 *
 * Server enforcement lives in `updateDraftExpenseAction`:
 *   • Only the submitter (`submitter_employee_id === actor.employeeId`)
 *     may edit their own draft (see `actions.ts:196`).
 *   • Editing is allowed only while status is DRAFT or PENDING_L1 —
 *     after Level-2 the finance ledger becomes append-only and
 *     changes must go through `updateBudgetLineItemAction` /
 *     `assignExpenseCoaAction` instead.
 * Client-side this sheet is guarded by the same `isDraft && isSubmitter`
 * boolean that shows Delete + Submit — mirroring `SubmitDraftButton`.
 *
 * Rules §17: mutation goes through the `withSecureAction()`-wrapped
 * action. UI never bypasses PDP.
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
  EXPENSE_CATEGORIES,
  EXPENSE_PAYMENT_METHODS,
  type ExpensePaymentMethodInput,
} from "@/lib/validation/expense";
import { parseMoneyFromDb } from "@/lib/format/money";

import { updateDraftExpenseAction } from "./actions";

/**
 * Snapshot of the current draft so RHF has stable defaults. Amount comes
 * from the DB as a numeric string (e.g. "150000.00") — normalize to a
 * plain integer for the input.
 */
export type EditDraftExpenseProject = {
  id: string;
  name: string;
  code: string;
};

export type EditDraftExpense = {
  id: string;
  project_id: string;
  amount_db: string | number;
  description: string;
  notes: string | null;
  incurred_on: string;
  payment_method: ExpensePaymentMethodInput | null;
  budget_detail_id: string | null;
  coa_id: string | null;
  category: string | null;
  late_submission_reason: string | null;
};

type FormValues = {
  amount_idr: string;
  incurred_on: string;
  payment_method: ExpensePaymentMethodInput | "";
  description: string;
  notes: string;
  category: string;
  late_submission_reason: string;
};

function amountToInputValue(v: string | number): string {
  try {
    const cents = parseMoneyFromDb(v);
    // Convert bigint cents (whole rupiah) → plain integer for input[type=number].
    return String(cents);
  } catch {
    return String(v ?? "");
  }
}

function digitsOnly(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

export function EditDraftExpenseButton({
  expense,
  project,
}: {
  expense: EditDraftExpense;
  project: EditDraftExpenseProject | null;
}) {
  const router = useRouter();
  const t = useTranslations("expenses.detail");
  const tForm = useTranslations("expenses.form");
  const tPm = useTranslations("expenses.paymentMethods");
  const tCommon = useTranslations("common");

  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const defaults: FormValues = React.useMemo(
    () => ({
      amount_idr: amountToInputValue(expense.amount_db),
      incurred_on: expense.incurred_on ?? "",
      payment_method: expense.payment_method ?? "",
      description: expense.description ?? "",
      notes: expense.notes ?? "",
      category: expense.category ?? "MISC",
      late_submission_reason: expense.late_submission_reason ?? "",
    }),
    [expense],
  );

  const form = useForm<FormValues>({
    defaultValues: defaults,
    mode: "onBlur",
  });

  React.useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults, open]);

  function onSubmit(values: FormValues) {
    const amountInt = Number.parseInt(digitsOnly(values.amount_idr), 10);
    if (!Number.isFinite(amountInt) || amountInt <= 0) {
      form.setError("amount_idr", { message: tForm("amountHint") });
      return;
    }
    if (!values.description || values.description.trim().length < 3) {
      form.setError("description", { message: tForm("descriptionPlaceholder") });
      return;
    }

    startTransition(async () => {
      const result = await updateDraftExpenseAction({
        id: expense.id,
        project_id: expense.project_id,
        amount_idr: amountInt,
        // Existing budget_detail / coa references are preserved by re-sending
        // the current values — the action does not treat null as "clear" when
        // the row was previously null.
        budget_detail_id: expense.budget_detail_id ?? undefined,
        coa_id: expense.coa_id ?? undefined,
        category: (values.category ||
          "MISC") as (typeof EXPENSE_CATEGORIES)[number],
        payment_method: values.payment_method || undefined,
        description: values.description.trim(),
        notes: values.notes.trim() || undefined,
        incurred_on: values.incurred_on,
        late_submission_reason:
          values.late_submission_reason.trim() || undefined,
      });
      if (result.ok) {
        toast.success(t("updatedToast"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.reason);
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
          <Button size="sm" variant="outline" aria-label={tCommon("edit")}>
            <Pencil className="size-4" />
            {tCommon("edit")}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader>
          <SheetTitle>{t("editTitle")}</SheetTitle>
          <SheetDescription>
            {project
              ? t("editSubtitle", { project: project.name })
              : t("editSubtitleNoProject")}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
          >
            <FormField
              control={form.control}
              name="amount_idr"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tForm("amount")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={field.value}
                      onChange={(e) => field.onChange(digitsOnly(e.target.value))}
                      autoFocus
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="incurred_on"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tForm("incurredOn")}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="payment_method"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tForm("paymentMethod")}</FormLabel>
                    <Select
                      value={field.value || ""}
                      onValueChange={(v) => field.onChange(v)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tForm("paymentMethodPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {EXPENSE_PAYMENT_METHODS.map((pm) => (
                          <SelectItem key={pm} value={pm}>
                            {tPm(pm)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tForm("category")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {EXPENSE_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
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
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tForm("descriptionLabel")}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder={tForm("descriptionPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tForm("notes")}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={2}
                      placeholder={tForm("notesPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="late_submission_reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tForm("lateReasonLabel", { days: 7 })}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={2}
                      placeholder={tForm("lateReasonPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <SheetFooter className="mt-2 flex flex-row justify-end gap-2">
              <SheetClose
                render={
                  <Button type="button" variant="ghost" disabled={isPending}>
                    {tCommon("cancel")}
                  </Button>
                }
              />
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {tCommon("save")}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
