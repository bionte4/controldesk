"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addBudgetLineItemSchema,
  BUDGET_CATEGORIES,
  type AddBudgetLineItemInput,
  type BudgetCategory,
} from "@/lib/validation/budget";

import {
  addBudgetLineItemAction,
  deleteBudgetLineItemAction,
} from "./actions";

type FormValues = {
  seq: string;
  category: BudgetCategory;
  description: string;
  planned_amount: string;
};

function makeDefaults(nextSeq: number): FormValues {
  return {
    seq: String(nextSeq),
    category: "OPERATIONS",
    description: "",
    planned_amount: "",
  };
}

/**
 * Inline "add row" form rendered under the line-items table. Locked out
 * automatically when the parent passes `readOnly` (i.e. budget is APPROVED
 * or CANCELLED). Handles category / description / planned_amount only —
 * realized / outstanding are populated by downstream integrations (expense
 * approval, CA disbursement) rather than a manual form.
 */
export function AddBudgetLineItem({
  budgetId,
  nextSeq,
  readOnly,
}: {
  budgetId: string;
  nextSeq: number;
  readOnly: boolean;
}) {
  const t = useTranslations("budgets.lineItems");
  const tCat = useTranslations("budgets.categories");
  const [isPending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);

  const form = useForm<FormValues>({
    defaultValues: makeDefaults(nextSeq),
    resolver: async (values) => {
      const parsed = addBudgetLineItemSchema.safeParse({
        budget_id: budgetId,
        seq: Number(values.seq),
        category: values.category,
        description: values.description || undefined,
        planned_amount: Number(
          values.planned_amount.replaceAll(".", "").replaceAll(",", ""),
        ),
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
    form.reset(makeDefaults(nextSeq));
  }, [nextSeq, form]);

  function onSubmit(values: FormValues) {
    const cleaned = values.planned_amount
      .replaceAll(".", "")
      .replaceAll(",", "");
    const payload: AddBudgetLineItemInput = {
      budget_id: budgetId,
      seq: Number(values.seq),
      category: values.category,
      description: values.description || undefined,
      planned_amount: Number(cleaned),
    };
    startTransition(async () => {
      const result = await addBudgetLineItemAction(payload);
      if (result.ok) {
        toast.success(t("added"));
        form.reset(makeDefaults(nextSeq + 1));
        setOpen(false);
      } else {
        toast.error(result.reason);
      }
    });
  }

  if (readOnly) return null;

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="w-fit"
      >
        <Plus className="size-4" />
        {t("addRow")}
      </Button>
    );
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid gap-3 rounded-lg border border-border/60 bg-muted/30 p-4 sm:grid-cols-6"
      >
        <FormField
          control={form.control}
          name="seq"
          render={({ field }) => (
            <FormItem className="sm:col-span-1">
              <FormLabel>{t("seq")}</FormLabel>
              <FormControl>
                <Input {...field} inputMode="numeric" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>{t("category")}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {BUDGET_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {tCat(c)}
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
          name="planned_amount"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>{t("plannedAmount")}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  inputMode="numeric"
                  placeholder="1000000"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem className="sm:col-span-6">
              <FormLabel>{t("descriptionLabel")}</FormLabel>
              <FormControl>
                <Textarea
                  rows={2}
                  {...field}
                  placeholder={t("descriptionPlaceholder")}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="sm:col-span-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            {t("cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {t("save")}
          </Button>
        </div>
      </form>
    </Form>
  );
}

/**
 * Small trash button rendered per row. Only clickable when the parent
 * declares `readOnly=false`.
 */
export function DeleteBudgetLineItemButton({
  id,
  readOnly,
}: {
  id: string;
  readOnly: boolean;
}) {
  const t = useTranslations("budgets.lineItems");
  const [isPending, startTransition] = React.useTransition();

  function onDelete() {
    startTransition(async () => {
      const result = await deleteBudgetLineItemAction({ id });
      if (result.ok) toast.success(t("deleted"));
      else toast.error(result.reason);
    });
  }

  if (readOnly) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onDelete}
      disabled={isPending}
      aria-label={t("delete")}
    >
      {isPending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Trash2 className="size-4" />
      )}
    </Button>
  );
}
