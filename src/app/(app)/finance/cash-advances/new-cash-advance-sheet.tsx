"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { ApprovalChainProgress } from "@/components/approvals/approval-chain-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { caCanonicalChain } from "@/lib/cash-advance/state-canonical";
import { formatIDR } from "@/lib/format/money";
import type { CanonicalApprovalSlot } from "@/lib/rbac/roles";
import {
  submitCanonicalCashAdvanceSchema,
  type CashAdvanceTypeInput,
  type SubmitCanonicalCashAdvanceInput,
} from "@/lib/validation/cash-advance-canonical";

import { submitCanonicalCashAdvanceAction } from "./actions-canonical";

export type ProjectOption = { id: string; label: string };

type FormValues = {
  ca_type: CashAdvanceTypeInput;
  project_id: string;
  amount_idr: string;
  purpose: string;
  needed_by: string;
};

const DEFAULT_VALUES: FormValues = {
  ca_type: "GENERAL",
  project_id: "",
  amount_idr: "",
  purpose: "",
  needed_by: "",
};

/**
 * Parse the raw amount input (users may type "5.000.000" or "5,000,000").
 * Returns 0 when the value is empty or non-numeric.
 */
function parseAmount(input: string): number {
  const cleaned = input.replaceAll(".", "").replaceAll(",", "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function NewCashAdvanceSheet({
  projects,
}: {
  projects: ProjectOption[];
}) {
  const t = useTranslations("cashAdvances");
  const tf = useTranslations("cashAdvances.form");
  const tTypes = useTranslations("cashAdvances.types");
  const tSlots = useTranslations("cashAdvances.chainSlot");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<FormValues>({
    defaultValues: DEFAULT_VALUES,
    resolver: async (values) => {
      const rawAmount = parseAmount(values.amount_idr);
      const parsed = submitCanonicalCashAdvanceSchema.safeParse({
        ca_type: values.ca_type,
        project_id: values.project_id,
        amount_idr: rawAmount,
        purpose: values.purpose,
        needed_by: values.needed_by || undefined,
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

  const caType = form.watch("ca_type");
  const amountRaw = form.watch("amount_idr");
  const amountIDR = parseAmount(amountRaw);

  // Chain preview — recomputed as user types. Zero amount yields an empty
  // chain; we render a "instant approval" hint in that case.
  const chain: CanonicalApprovalSlot[] = React.useMemo(() => {
    if (amountIDR <= 0) return [];
    return caCanonicalChain({ type: caType, amountIDR });
  }, [caType, amountIDR]);

  function onSubmit(values: FormValues) {
    const payload: SubmitCanonicalCashAdvanceInput = {
      ca_type: values.ca_type,
      project_id: values.project_id,
      amount_idr: parseAmount(values.amount_idr),
      purpose: values.purpose,
      needed_by: values.needed_by || undefined,
    };
    startTransition(async () => {
      const result = await submitCanonicalCashAdvanceAction(payload);
      if (result.ok) {
        toast.success(tf("submitted"));
        form.reset(DEFAULT_VALUES);
        setOpen(false);
      } else {
        toast.error(result.reason);
      }
    });
  }

  const hasProjects = projects.length > 0;

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
      <SheetContent side="right" className="w-full sm:max-w-lg">
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
                name="ca_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("type")}</FormLabel>
                    <FormControl>
                      <fieldset
                        className="grid grid-cols-2 gap-2"
                        aria-label={tf("type")}
                      >
                        {(["GENERAL", "FIELD_OPS"] as const).map((opt) => {
                          const active = field.value === opt;
                          const label =
                            opt === "GENERAL"
                              ? tTypes("general")
                              : tTypes("fieldOps");
                          const hint =
                            opt === "GENERAL"
                              ? tTypes("generalHint")
                              : tTypes("fieldOpsHint");
                          return (
                            <Label
                              key={opt}
                              htmlFor={`ca-type-${opt}`}
                              className={[
                                "flex cursor-pointer flex-col gap-1 rounded-xl border p-3 text-left transition-colors",
                                active
                                  ? "border-primary/60 bg-primary/10 ring-1 ring-primary/40"
                                  : "border-border hover:border-primary/30",
                              ].join(" ")}
                            >
                              <input
                                id={`ca-type-${opt}`}
                                type="radio"
                                name={field.name}
                                value={opt}
                                checked={active}
                                onChange={() => field.onChange(opt)}
                                className="sr-only"
                              />
                              <span className="text-sm font-semibold">
                                {label}
                              </span>
                              <span className="text-[10px] leading-4 text-muted-foreground">
                                {hint}
                              </span>
                            </Label>
                          );
                        })}
                      </fieldset>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="project_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("project")}</FormLabel>
                    <Select
                      value={field.value || undefined}
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
                  name="amount_idr"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tf("amount")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          inputMode="numeric"
                          placeholder="5000000"
                        />
                      </FormControl>
                      <p className="text-[10px] text-muted-foreground">
                        {tf("amountHint")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="needed_by"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tf("neededBy")}</FormLabel>
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
                name="purpose"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("purposeLabel")}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        {...field}
                        placeholder={tf("purposePlaceholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <section
                aria-labelledby="ca-chain-preview"
                className="rounded-xl border border-border/60 bg-muted/30 p-3"
              >
                <p
                  id="ca-chain-preview"
                  className="label-meta mb-2 text-[10px] text-muted-foreground"
                >
                  {tf("chainPreviewTitle")}
                  {amountIDR > 0 ? (
                    <span className="ml-2 font-mono text-foreground/80">
                      {formatIDR(BigInt(amountIDR), { compact: true })}
                    </span>
                  ) : null}
                </p>
                {amountIDR <= 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {tf("chainPreviewEmpty")}
                  </p>
                ) : chain.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {tf("chainPreviewAuto")}
                  </p>
                ) : (
                  <ApprovalChainProgress
                    slots={chain}
                    variant="preview"
                    size="sm"
                    renderSlot={(slot) =>
                      tSlots(slot as CanonicalApprovalSlot)
                    }
                    data-testid="ca-chain-preview"
                    ariaLabel="Cash advance approval chain preview"
                  />
                )}
              </section>

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
