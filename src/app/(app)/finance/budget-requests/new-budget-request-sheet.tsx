"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { ApprovalChainProgress } from "@/components/approvals/approval-chain-progress";
import type { CanonicalApprovalSlot } from "@/lib/rbac/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
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
  BR_KIND_VALUES,
  submitBudgetRequestSchema,
} from "@/lib/validation/budget-request";
import { brApprovalChain } from "@/lib/budget-requests/state";
import { formatIDR } from "@/lib/format/money";
import type { BudgetRequestKind } from "@/types/database";

import { submitBudgetRequestAction } from "./actions";

export type BudgetDetailOption = {
  id: string;
  seq: number;
  category: string;
  remaining_idr: number;
};

type FormValues = {
  kind: BudgetRequestKind;
  amount_idr: number | "";
  justification: string;
  source_detail_id: string;
  target_detail_id: string;
};

export function NewBudgetRequestSheet({
  budgetId,
  details,
}: {
  budgetId: string;
  details: BudgetDetailOption[];
}) {
  const t = useTranslations("budgetRequests");
  const tf = useTranslations("budgetRequests.form");
  const tKind = useTranslations("budgetRequests.kind");
  const tCommon = useTranslations("common");
  // Approval-chain slot labels live under `cashAdvances.chainSlot` but hold
  // canonical role names (SUPERVISOR/PM/OM/FINANCE/DIRECTOR) with no CA-
  // specific wording, so it is safe to reuse cross-module. See Slice 3
  // (`<FinanceStatusBadge>` refactor) for the planned rename to
  // `approvals.chainSlot`.
  const tSlots = useTranslations("cashAdvances.chainSlot");

  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<FormValues, unknown, FormValues>({
    defaultValues: {
      kind: "INCREASE",
      amount_idr: "" as unknown as number,
      justification: "",
      source_detail_id: "",
      target_detail_id: "",
    },
    resolver: async (values) => {
      const amt = Number(values.amount_idr);
      const payload: Record<string, unknown> = {
        kind: values.kind,
        budget_id: budgetId,
        amount_idr: Number.isFinite(amt) ? amt : 0,
        justification: values.justification,
      };
      if (values.kind === "INCREASE") {
        payload.target_detail_id = values.target_detail_id;
      } else if (values.kind === "DECREASE") {
        payload.source_detail_id = values.source_detail_id;
      } else {
        payload.source_detail_id = values.source_detail_id;
        payload.target_detail_id = values.target_detail_id;
      }
      const parsed = submitBudgetRequestSchema.safeParse(payload);
      if (parsed.success) return { values, errors: {} };
      const errs: Record<string, { type: string; message: string }> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[issue.path.length - 1] ?? "root");
        errs[key] = { type: "validate", message: issue.message };
      }
      return { values: {}, errors: errs };
    },
  });

  const kind = form.watch("kind");
  const amountRaw = form.watch("amount_idr");
  const amountNumeric = Number(amountRaw);
  const chain =
    Number.isFinite(amountNumeric) && amountNumeric > 0
      ? brApprovalChain(amountNumeric)
      : [];

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const amt = Number(values.amount_idr);
      const base = {
        budget_id: budgetId,
        amount_idr: amt,
        justification: values.justification,
      };
      const payload =
        values.kind === "INCREASE"
          ? {
              ...base,
              kind: "INCREASE" as const,
              target_detail_id: values.target_detail_id,
            }
          : values.kind === "DECREASE"
            ? {
                ...base,
                kind: "DECREASE" as const,
                source_detail_id: values.source_detail_id,
              }
            : {
                ...base,
                kind: "TRANSFER" as const,
                source_detail_id: values.source_detail_id,
                target_detail_id: values.target_detail_id,
              };
      const result = await submitBudgetRequestAction(payload);
      if (!result.ok) {
        toast.error(result.reason);
        return;
      }
      toast.success(tf("createdToast"));
      form.reset({
        kind: "INCREASE",
        amount_idr: "" as unknown as number,
        justification: "",
        source_detail_id: "",
        target_detail_id: "",
      });
      setOpen(false);
    });
  });

  const showSource = kind === "DECREASE" || kind === "TRANSFER";
  const showTarget = kind === "INCREASE" || kind === "TRANSFER";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button size="sm" variant="outline">
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
        <Form {...form}>
          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
            <FormField
              control={form.control}
              name="kind"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("kind")}</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) =>
                      field.onChange(v as BudgetRequestKind)
                    }
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {BR_KIND_VALUES.map((k) => (
                        <SelectItem key={k} value={k}>
                          {tKind(k)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {tf(`kindHint.${field.value}` as const)}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="amount_idr"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("amount")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1000}
                      value={field.value === "" ? "" : String(field.value)}
                      onChange={(e) => {
                        const v = e.target.value;
                        field.onChange(v === "" ? "" : Number(v));
                      }}
                      placeholder="1000000"
                    />
                  </FormControl>
                  {chain.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
                      <span className="label-meta text-[10px] uppercase">
                        {tf("chainPreviewLabel")}
                      </span>
                      <ApprovalChainProgress
                        slots={chain}
                        variant="preview"
                        size="xs"
                        renderSlot={(slot) =>
                          tSlots(slot as CanonicalApprovalSlot)
                        }
                        data-testid="budget-request-chain-preview"
                        ariaLabel="Budget request approval chain preview"
                      />
                    </div>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />

            {showSource ? (
              <FormField
                control={form.control}
                name="source_detail_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("sourceLine")}</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={(v) => field.onChange(v)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tf("linePickerPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {details.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            #{d.seq} · {d.category} ·{" "}
                            {formatIDR(BigInt(d.remaining_idr), {
                              compact: true,
                            })}{" "}
                            {tf("remaining")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {showTarget ? (
              <FormField
                control={form.control}
                name="target_detail_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("targetLine")}</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={(v) => field.onChange(v)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={tf("linePickerPlaceholder")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {details.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            #{d.seq} · {d.category}
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
              name="justification"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tf("justification")}</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={5}
                      {...field}
                      placeholder={tf("justificationPlaceholder")}
                    />
                  </FormControl>
                  <FormDescription>
                    {tf("justificationHint")}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <SheetFooter className="mt-2 flex-row justify-end gap-2">
              <SheetClose
                render={
                  <Button type="button" variant="ghost" disabled={isPending}>
                    {tCommon("cancel")}
                  </Button>
                }
              />
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {tCommon("loading")}
                  </>
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
