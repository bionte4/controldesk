"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { Info, Loader2, Lock, Plus } from "lucide-react";
import { toast } from "sonner";

import { AiCopilot } from "@/components/ai/ai-copilot";
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
import {
  filterUnitOptions,
  type UnitOption,
} from "@/lib/finance/unit-pengaju-filter";
import { addBusinessDays } from "@/lib/format/business-days";
import { formatInTz } from "@/lib/format/date";
import { formatIDR } from "@/lib/format/money";
import type { CanonicalApprovalSlot } from "@/lib/rbac/roles";
import {
  submitCanonicalCashAdvanceSchema,
  type CashAdvanceTypeInput,
  type SubmitCanonicalCashAdvanceInput,
} from "@/lib/validation/cash-advance-canonical";

import { submitCanonicalCashAdvanceAction } from "./actions-canonical";
import { fetchCoaForProject } from "../expenses/lookup-actions";

export type ProjectOption = { id: string; label: string };

type CoaOptionWithMa = {
  id: string;
  code: string;
  name: string;
  ma_labels: string[];
};

const COA_NONE = "__none__";

type FormValues = {
  ca_type: CashAdvanceTypeInput;
  project_id: string;
  amount_idr: string;
  purpose: string;
  needed_by: string;
  coa_id: string;
  unit_pengaju: string;
};

const DEFAULT_VALUES: FormValues = {
  ca_type: "GENERAL",
  project_id: "",
  amount_idr: "",
  purpose: "",
  needed_by: "",
  coa_id: "",
  unit_pengaju: "",
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

/**
 * Live-format the amount input as the user types. Only digits survive, and
 * every 3 digits from the right get a "." separator (id-ID locale). We keep
 * the store as a formatted string so the input display + form state stay in
 * sync — parsing back to number happens once on submit via `parseAmount`.
 *
 * Example: "5000000" → "5.000.000"
 */
function formatAmountInput(raw: string): string {
  const digitsOnly = raw.replace(/[^\d]/g, "");
  if (!digitsOnly) return "";
  const withoutLeadingZeros = digitsOnly.replace(/^0+(?=\d)/, "");
  return withoutLeadingZeros.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function NewCashAdvanceSheet({
  projects,
  disabled = false,
  disabledReason,
  canFieldOps = false,
  canPickCoa = false,
  unitOptions: allUnitOptions = [],
  allowedUnitsByProject = {},
}: {
  projects: ProjectOption[];
  /**
   * Tenant `unit_pengaju` lookup (see `loadFieldOpsFormLookups`).
   * Empty array = admin hasn't populated the master list yet; the
   * dropdown renders disabled with a hint.
   */
  unitOptions?: readonly UnitOption[];
  /**
   * Per-project whitelist (migration 0086). Same shape as Field-Ops
   * & Budget forms; empty entry = fall back to the full lookup.
   */
  allowedUnitsByProject?: Record<string, string[]>;
  /**
   * When true the trigger button is rendered inert. Used by the page to
   * gate field-technicians away from the "General" flow — they should
   * use "Pengajuan Operasional" instead.
   */
  disabled?: boolean;
  disabledReason?: string;
  /**
   * Whether the actor is eligible to raise a Field-Ops CA (Supervisor or
   * Field Technician with an active assignment). Controls the tooltip
   * copy on the Field Ops type card — the card itself is always disabled
   * inside this sheet because Field Ops uses a dedicated flow via
   * `NewFieldOpsSheet` (which captures RAB, site details, attachments).
   */
  canFieldOps?: boolean;
  /**
   * Whether the caller is a classification-eligible role
   * (PM / Finance / OM+ / Admin). When true the CoA dropdown is rendered
   * and fetches project-scoped options (only CoAs already coded on this
   * project's budget lines). Employees still submit without a CoA;
   * Finance codes the account later during review.
   */
  canPickCoa?: boolean;
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
        coa_id:
          values.coa_id && values.coa_id !== COA_NONE
            ? values.coa_id
            : undefined,
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

  const caType = form.watch("ca_type");
  const amountRaw = form.watch("amount_idr");
  const amountIDR = parseAmount(amountRaw);
  const projectId = form.watch("project_id");
  const currentUnit = form.watch("unit_pengaju");

  // Migration 0086 — narrow Unit Pengaju options by the project's
  // allowed list. Shared helper keeps every finance form in lockstep.
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

  const [coaOptions, setCoaOptions] = React.useState<CoaOptionWithMa[]>([]);
  const [coaLoading, setCoaLoading] = React.useState(false);

  // Refetch CoA list whenever the picked project changes. We deliberately
  // do not memoise across projects — the list is tiny (≤50 rows) and
  // stale entries would confuse Finance users. Reset the previously
  // chosen CoA so the form doesn't submit a cross-project reference.
  React.useEffect(() => {
    if (!canPickCoa) return;
    if (!projectId) {
      setCoaOptions([]);
      form.setValue("coa_id", "");
      return;
    }
    let cancelled = false;
    setCoaLoading(true);
    fetchCoaForProject({ project_id: projectId })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setCoaOptions(res.data);
        } else {
          setCoaOptions([]);
        }
      })
      .catch(() => {
        if (!cancelled) setCoaOptions([]);
      })
      .finally(() => {
        if (!cancelled) setCoaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, canPickCoa, form]);

  // Chain preview — recomputed as user types. Zero amount yields an empty
  // chain; we render a "instant approval" hint in that case.
  const chain: CanonicalApprovalSlot[] = React.useMemo(() => {
    if (amountIDR <= 0) return [];
    return caCanonicalChain({ type: caType, amountIDR });
  }, [caType, amountIDR]);

  // Settlement preview — "if disbursed today, deadline = today + 7 wd".
  // We deliberately do NOT show this if amount is zero (nothing to settle
  // yet). Computed client-side using the same helper as the trigger.
  const settlementPreview = React.useMemo(() => {
    if (amountIDR <= 0) return null;
    const due = addBusinessDays(new Date(), 7);
    return formatInTz(due, "dd MMM yyyy");
  }, [amountIDR]);

  function onSubmit(values: FormValues) {
    // Force GENERAL — the Field Ops card is UI-only in this sheet.
    // (Server also rejects mismatches via PDP, but this keeps the intent
    // explicit in case future refactors touch the type selector.)
    const payload: SubmitCanonicalCashAdvanceInput = {
      ca_type: "GENERAL",
      project_id: values.project_id,
      amount_idr: parseAmount(values.amount_idr),
      purpose: values.purpose,
      needed_by: values.needed_by || undefined,
      coa_id:
        values.coa_id && values.coa_id !== COA_NONE
          ? values.coa_id
          : undefined,
      unit_pengaju: values.unit_pengaju || undefined,
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
  const canOpen = !disabled && hasProjects;

  const fieldOpsLockedTitle = tf("fieldOpsCardLockedTitle");
  const fieldOpsLockedHint = canFieldOps
    ? tf("fieldOpsCardLockedEligible")
    : tf("fieldOpsCardLockedNotEligible");
  const fieldOpsLockedToast = canFieldOps
    ? tf("fieldOpsCardLockedToastEligible")
    : tf("fieldOpsCardLockedToastNotEligible");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            size="sm"
            variant={canOpen ? "default" : "secondary"}
            disabled={!canOpen}
            title={disabled ? disabledReason : undefined}
          >
            <Plus className="size-4" />
            {t("new")}
          </Button>
        }
      />
      <SheetContent side="right" className="w-full sm:max-w-2xl">
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
                          const isLocked = opt === "FIELD_OPS";
                          const label =
                            opt === "GENERAL"
                              ? tTypes("general")
                              : tTypes("fieldOps");
                          const hint = isLocked
                            ? fieldOpsLockedHint
                            : opt === "GENERAL"
                              ? tTypes("generalHint")
                              : tTypes("fieldOpsHint");
                          return (
                            <Label
                              key={opt}
                              htmlFor={`ca-type-${opt}`}
                              onClick={
                                isLocked
                                  ? (e) => {
                                      e.preventDefault();
                                      toast.info(fieldOpsLockedToast);
                                    }
                                  : undefined
                              }
                              className={[
                                "relative flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors",
                                isLocked
                                  ? "cursor-not-allowed border-border/60 bg-muted/40 opacity-70"
                                  : active
                                    ? "cursor-pointer border-primary/60 bg-primary/10 ring-1 ring-primary/40"
                                    : "cursor-pointer border-border hover:border-primary/30",
                              ].join(" ")}
                              title={isLocked ? fieldOpsLockedHint : undefined}
                              aria-disabled={isLocked || undefined}
                            >
                              <input
                                id={`ca-type-${opt}`}
                                type="radio"
                                name={field.name}
                                value={opt}
                                checked={active}
                                onChange={() => {
                                  if (isLocked) return;
                                  field.onChange(opt);
                                }}
                                disabled={isLocked}
                                className="sr-only"
                              />
                              <span className="flex items-center gap-1.5 text-sm font-semibold">
                                {label}
                                {isLocked ? (
                                  <Lock
                                    aria-hidden
                                    className="size-3.5 text-muted-foreground"
                                  />
                                ) : null}
                              </span>
                              <span className="text-[10px] leading-4 text-muted-foreground">
                                {hint}
                              </span>
                              {isLocked ? (
                                <span className="sr-only">
                                  {fieldOpsLockedTitle}
                                </span>
                              ) : null}
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
                render={({ field }) => {
                  const selected = projects.find((p) => p.id === field.value);
                  return (
                    <FormItem>
                      <FormLabel>{tf("project")}</FormLabel>
                      <Select
                        value={field.value ?? ""}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={tf("projectPlaceholder")}>
                              {selected?.label}
                            </SelectValue>
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
                  );
                }}
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
                          autoComplete="off"
                          placeholder="5.000.000"
                          onChange={(e) => {
                            field.onChange(formatAmountInput(e.target.value));
                          }}
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
                render={({ field }) => {
                  const selectedProject = projects.find(
                    (p) => p.id === form.watch("project_id"),
                  );
                  return (
                    <FormItem>
                      <div className="flex items-center justify-between gap-2">
                        <FormLabel>{tf("purposeLabel")}</FormLabel>
                        <AiCopilot
                          surface="ca_purpose"
                          currentValue={field.value}
                          onAccept={(suggestion) => field.onChange(suggestion)}
                          context={{
                            amount: form.watch("amount_idr"),
                            project_name: selectedProject?.label,
                          }}
                        />
                      </div>
                      <FormControl>
                        <Textarea
                          rows={3}
                          {...field}
                          placeholder={tf("purposePlaceholder")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  );
                }}
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

              {canPickCoa ? (
                <FormField
                  control={form.control}
                  name="coa_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tf("coaAccount")}</FormLabel>
                      <Select
                        value={field.value || COA_NONE}
                        onValueChange={field.onChange}
                        disabled={!projectId || coaLoading}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full min-w-0">
                            <SelectValue
                              placeholder={
                                !projectId
                                  ? tf("coaPlaceholderNoProject")
                                  : coaLoading
                                    ? tf("coaLoading")
                                    : coaOptions.length === 0
                                      ? tf("coaEmpty")
                                      : tf("coaPlaceholder")
                              }
                            >
                              {(value) => {
                                if (!value || value === COA_NONE) {
                                  return tf("coaNone");
                                }
                                const hit = coaOptions.find(
                                  (o) => o.id === value,
                                );
                                return hit ? `${hit.code} · ${hit.name}` : value;
                              }}
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectItem value={COA_NONE}>{tf("coaNone")}</SelectItem>
                          {coaOptions.map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                              <span className="flex flex-col items-start">
                                <span>
                                  {o.code} · {o.name}
                                </span>
                                {o.ma_labels.length > 0 ? (
                                  <span className="text-[11px] text-muted-foreground">
                                    MA: {o.ma_labels.slice(0, 3).join(", ")}
                                    {o.ma_labels.length > 3
                                      ? ` +${o.ma_labels.length - 3}`
                                      : ""}
                                  </span>
                                ) : null}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground leading-tight">
                        {projectId && !coaLoading && coaOptions.length === 0
                          ? tf("coaEmptyHint")
                          : tf("coaHint")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : null}

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

              {settlementPreview ? (
                <section
                  aria-labelledby="ca-settlement-preview"
                  className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
                >
                  <Info
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-amber-500"
                  />
                  <div className="min-w-0">
                    <p
                      id="ca-settlement-preview"
                      className="label-meta text-[10px] text-amber-600 dark:text-amber-400"
                    >
                      {tf("settlementPreviewTitle")}
                    </p>
                    <p className="text-xs text-foreground/90">
                      {tf("settlementPreviewBody", {
                        date: settlementPreview,
                      })}
                    </p>
                  </div>
                </section>
              ) : null}

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
