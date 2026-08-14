"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { parseMoneyFromDb } from "@/lib/format/money";

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
  updateBudgetLineItemAction,
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
 * Best-guess CoA account CODE (chart_of_accounts.code) per budget
 * category. Kept as codes (not ids) because the postable CoA set is
 * loaded fresh from `loadPostableAccounts()` and only the row `code`
 * is stable across tenants (ids are per-tenant UUIDs from migration
 * 0055). We prefer the more specific code and fall back to a broader
 * bucket if the postable seed set does not include the primary.
 */
const CATEGORY_TO_COA_CODES: Record<string, readonly string[]> = {
  DIRECT_LABOUR: ["5101"], // Beban Gaji Direct
  INFRASTRUCTURE: ["5201"], // Beban Cloud & Hosting
  TOOLING: ["5202", "5201"], // Software & Lisensi → Cloud & Hosting
  TRAVEL: ["5301"], // Beban Transportasi
  OPERATIONS: ["5900"], // Beban Operasional Lain
  CONTINGENCY: ["5900"],
  MARKETING: ["5501"], // Beban Digital Advertising
  TRAINING: ["5401"], // Beban Pelatihan Teknis
};

function suggestCoaId(
  category: string,
  coaOptions: readonly CoaAccountOption[],
): string | null {
  const codes = CATEGORY_TO_COA_CODES[category];
  if (!codes) return null;
  for (const code of codes) {
    const hit = coaOptions.find((c) => c.code === code);
    if (hit) return hit.id;
  }
  return null;
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
              <Select
                value={field.value}
                onValueChange={(v) => {
                  if (v == null) return;
                  field.onChange(v);
                  // Auto-suggest a matching CoA when the user hasn't
                  // manually picked one yet. Preserves any explicit
                  // override — we only fill blanks / the default
                  // "None" sentinel so we never overwrite a deliberate
                  // choice mid-edit.
                  if (coaEnabled) {
                    const current = form.getValues("coa_id");
                    if (!current || current === COA_NONE) {
                      const suggested = suggestCoaId(v, coaOptions ?? []);
                      if (suggested) form.setValue("coa_id", suggested);
                    }
                  }
                }}
              >
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
 * Inline edit dialog for a single budget line-item. Renders as a small
 * pencil-icon button per row; when clicked, opens a Dialog with a form
 * bound to the existing values.
 *
 * Server enforcement lives in `updateBudgetLineItemAction`:
 *   • Parent budget must be non-terminal (not APPROVED / not CANCELLED
 *     — see `actions.ts:232`). Client mirrors this via `readOnly`.
 *   • PDP `decideProjectBudget('update')` — LEAD_FINANCE / OM / HM /
 *     GM / TENANT_ADMIN. The button is only rendered when the parent
 *     server component decides `readOnly=false`, but the action still
 *     re-authorizes on submission.
 * `realized_amount` / `outstanding_amount` are populated by downstream
 * flows (expense approval + CA disbursement) and are intentionally NOT
 * exposed in this form — only `category`, `planned_amount`, `coa_id`
 * and `description` are editable manually.
 */
type EditFormValues = {
  category: string;
  coa_id: string;
  planned_amount: string;
  description: string;
};

export function EditBudgetLineItemButton({
  id,
  readOnly,
  initial,
  categoryOptions,
  coaOptions,
}: {
  id: string;
  readOnly: boolean;
  initial: {
    category: string;
    coa_id: string | null;
    planned_amount_db: string | number;
    description: string | null;
  };
  categoryOptions?: readonly BudgetCategoryOption[];
  coaOptions?: readonly CoaAccountOption[];
}) {
  const t = useTranslations("budgets.lineItems");
  const tCat = useTranslations("budgets.categories");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const coaEnabled = (coaOptions?.length ?? 0) > 0;

  const effectiveCategories: readonly BudgetCategoryOption[] = React.useMemo(
    () => {
      if (categoryOptions && categoryOptions.length > 0) return categoryOptions;
      return LEGACY_BUDGET_CATEGORY_DEFAULTS.map((code) => {
        let label: string = code;
        try {
          const translated = tCat(code);
          if (translated && translated !== code) label = translated;
        } catch {
          // next-intl throws for missing keys — keep code verbatim.
        }
        return { code, label };
      });
    },
    [categoryOptions, tCat],
  );

  const defaults: EditFormValues = React.useMemo(() => {
    let plannedInt = "";
    try {
      plannedInt = String(parseMoneyFromDb(initial.planned_amount_db));
    } catch {
      plannedInt = String(initial.planned_amount_db ?? "");
    }
    return {
      category: initial.category,
      coa_id: initial.coa_id ?? "",
      planned_amount: plannedInt,
      description: initial.description ?? "",
    };
  }, [initial]);

  const form = useForm<EditFormValues>({
    defaultValues: defaults,
    mode: "onBlur",
  });

  React.useEffect(() => {
    if (open) form.reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults, open]);

  function onSubmit(values: EditFormValues) {
    const cleaned = values.planned_amount.replace(/[^0-9]/g, "");
    const plannedInt = Number.parseInt(cleaned, 10);
    if (!Number.isFinite(plannedInt) || plannedInt < 0) {
      form.setError("planned_amount", { message: t("plannedInvalid") });
      return;
    }
    startTransition(async () => {
      const res = await updateBudgetLineItemAction({
        id,
        category: values.category as BudgetCategory,
        coa_id:
          values.coa_id && values.coa_id !== COA_NONE ? values.coa_id : null,
        description: values.description.trim() || undefined,
        planned_amount: plannedInt,
      });
      if (res.ok) {
        toast.success(t("updated"));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.reason);
      }
    });
  }

  if (readOnly) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) form.reset(defaults);
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            aria-label={tCommon("edit")}
            disabled={isPending}
          >
            <Pencil className="size-4" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("editTitle")}</DialogTitle>
          <DialogDescription>{t("editDescription")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="grid gap-3 sm:grid-cols-2"
          >
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem className="sm:col-span-1">
                  <FormLabel>{t("category")}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
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
                <FormItem className="sm:col-span-1">
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
                  <FormItem className="sm:col-span-2">
                    <FormLabel>{t("coaAccount")}</FormLabel>
                    <Select
                      value={field.value || COA_NONE}
                      onValueChange={(v) =>
                        field.onChange(v === COA_NONE ? "" : v)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
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
                <FormItem className="sm:col-span-2">
                  <FormLabel>{t("descriptionLabel")}</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={2}
                      placeholder={t("descriptionPlaceholder")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="sm:col-span-2">
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
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
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
