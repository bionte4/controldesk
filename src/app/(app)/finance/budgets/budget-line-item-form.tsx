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
  LEGACY_BUDGET_CATEGORY_DEFAULTS,
  type AddBudgetLineItemInput,
  type BudgetCategory,
} from "@/lib/validation/budget";

/**
 * Runtime-loaded category option (from `lookup_options` domain
 * `budget_category`). Parent passes an array so admin-added categories
 * (e.g. `SOFTWARE_LICENSE`) show up without a code change.
 */
export type BudgetCategoryOption = {
  code: string;
  label: string;
};

/**
 * Postable CoA account option (from `chart_of_accounts` filtered to
 * `is_active=true` AND `is_postable=true`). Parent passes an array so
 * finance-curated accounts (`5101`, `5102`, …) show up without needing
 * a code change. `code` doubles as the visual key in the dropdown.
 */
export type CoaAccountOption = {
  id: string;
  code: string;
  name: string;
};

import {
  addBudgetLineItemAction,
  deleteBudgetLineItemAction,
} from "./actions";

type FormValues = {
  seq: string;
  category: BudgetCategory;
  coa_id: string;
  description: string;
  planned_amount: string;
};

function makeDefaults(nextSeq: number): FormValues {
  return {
    seq: String(nextSeq),
    category: "OPERATIONS",
    coa_id: "",
    description: "",
    planned_amount: "",
  };
}

const COA_NONE = "__none__";

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
  categoryOptions,
  coaOptions,
}: {
  budgetId: string;
  nextSeq: number;
  readOnly: boolean;
  /**
   * Active budget categories loaded from `lookup_options` at the parent
   * server component. If omitted (older callers), we fall back to the
   * seeded defaults so nothing breaks during rollout.
   */
  categoryOptions?: readonly BudgetCategoryOption[];
  /**
   * Postable CoA accounts (see `loadPostableAccounts`). When omitted or
   * empty, the CoA dropdown is hidden — Fase 2 nullable rollout keeps
   * pre-CoA tenants working while adopters onboard.
   */
  coaOptions?: readonly CoaAccountOption[];
}) {
  const t = useTranslations("budgets.lineItems");
  const tCat = useTranslations("budgets.categories");
  const [isPending, startTransition] = React.useTransition();
  const [open, setOpen] = React.useState(false);
  const coaEnabled = (coaOptions?.length ?? 0) > 0;

  const effectiveCategories: readonly BudgetCategoryOption[] = React.useMemo(
    () => {
      if (categoryOptions && categoryOptions.length > 0) return categoryOptions;
      // Fallback path — the parent server component didn't pass a lookup
      // (older caller). Translate what we can, degrade to code otherwise.
      return LEGACY_BUDGET_CATEGORY_DEFAULTS.map((code) => {
        let label: string = code;
        try {
          const translated = tCat(code);
          if (translated && translated !== code) label = translated;
        } catch {
          // next-intl throws for missing keys; keep the code verbatim.
        }
        return { code, label };
      });
    },
    [categoryOptions, tCat],
  );

  const form = useForm<FormValues>({
    defaultValues: makeDefaults(nextSeq),
    resolver: async (values) => {
      const parsed = addBudgetLineItemSchema.safeParse({
        budget_id: budgetId,
        seq: Number(values.seq),
        category: values.category,
        coa_id:
          values.coa_id && values.coa_id !== COA_NONE ? values.coa_id : undefined,
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
      coa_id:
        values.coa_id && values.coa_id !== COA_NONE ? values.coa_id : undefined,
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
                  {effectiveCategories.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.label}
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
        {coaEnabled ? (
          <FormField
            control={form.control}
            name="coa_id"
            render={({ field }) => (
              <FormItem className="sm:col-span-6">
                <FormLabel>{t("coaAccount")}</FormLabel>
                <Select
                  value={field.value || COA_NONE}
                  onValueChange={(v) =>
                    field.onChange(v === COA_NONE ? "" : v)
                  }
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("coaPlaceholder")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={COA_NONE}>{t("coaNone")}</SelectItem>
                    {coaOptions!.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.code} · {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
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
