"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { FileText, ImageIcon, Loader2, Plus, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { ALLOWED_MIME_TYPES, DEFAULT_MAX_BYTES } from "@/lib/attachments/constants";
import { businessDaysUntil } from "@/lib/format/business-days";

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
  EXPENSE_PAYMENT_METHODS,
  saveDraftExpenseSchema,
  type SaveDraftExpenseInput,
} from "@/lib/validation/expense";

import { saveDraftExpenseAction } from "./actions";
import {
  fetchBudgetLinesForProject,
  fetchCoaForProject,
} from "./lookup-actions";
import { uploadExpenseReceiptsAction } from "./upload-actions";

export type ProjectOption = { id: string; label: string };

type CoaOptionWithMa = {
  id: string;
  code: string;
  name: string;
  ma_labels: string[];
};
type BudgetLine = {
  id: string;
  label: string;
  remaining_amount: number;
};

const COA_NONE = "__none__";

type FormValues = {
  project_id: string;
  budget_detail_id: string;
  coa_id: string;
  amount_idr: string;
  incurred_on: string;
  payment_method: SaveDraftExpenseInput["payment_method"] | "";
  description: string;
  notes: string;
  late_submission_reason: string;
};

function makeDefaults(): FormValues {
  return {
    project_id: "",
    budget_detail_id: "",
    coa_id: "",
    amount_idr: "",
    incurred_on: new Date().toISOString().slice(0, 10),
    payment_method: "",
    description: "",
    notes: "",
    late_submission_reason: "",
  };
}

export function NewExpenseSheet({
  projects,
  canPickBudgetLine = false,
  canPickCoa = false,
}: {
  projects: ProjectOption[];
  /**
   * Field-level roles (EMPLOYEE/SUPERVISOR) don't classify budget lines
   * themselves — PM / Finance / OM+ code the row during review. Default
   * `false` keeps the picker hidden unless explicitly enabled.
   */
  canPickBudgetLine?: boolean;
  /**
   * When true the CoA dropdown is shown and fetches project-scoped
   * options (only CoAs registered on this project's budget lines).
   * Employees still submit without a CoA; approvers classify later
   * via `assignExpenseCoaAction`.
   */
  canPickCoa?: boolean;
}) {
  const router = useRouter();
  const t = useTranslations("expenses");
  const tf = useTranslations("expenses.form");
  const tPm = useTranslations("expenses.paymentMethods");
  const tCommon = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [budgetLines, setBudgetLines] = React.useState<BudgetLine[]>([]);
  const [linesLoading, setLinesLoading] = React.useState(false);
  const [coaOptions, setCoaOptions] = React.useState<CoaOptionWithMa[]>([]);
  const [coaLoading, setCoaLoading] = React.useState(false);
  const [stagedFiles, setStagedFiles] = React.useState<File[]>([]);
  const [uploadPhase, setUploadPhase] = React.useState<"idle" | "saving" | "uploading">("idle");
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    defaultValues: makeDefaults(),
    resolver: async (values) => {
      const rawAmount = Number(
        values.amount_idr.replaceAll(".", "").replaceAll(",", ""),
      );
      const parsed = saveDraftExpenseSchema.safeParse({
        project_id: values.project_id,
        budget_detail_id: values.budget_detail_id || undefined,
        coa_id:
          values.coa_id && values.coa_id !== COA_NONE
            ? values.coa_id
            : undefined,
        amount_idr: rawAmount,
        payment_method: values.payment_method || undefined,
        description: values.description,
        notes: values.notes || undefined,
        incurred_on: values.incurred_on,
        late_submission_reason: values.late_submission_reason || undefined,
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

  // Lookup budget lines whenever the project changes. Reset the previously
  // chosen line so the form isn't left with a stale reference. Skipped
  // entirely when the caller doesn't have MA-picker privileges.
  React.useEffect(() => {
    if (!canPickBudgetLine) return;
    if (!projectId) {
      setBudgetLines([]);
      form.setValue("budget_detail_id", "");
      return;
    }
    let cancelled = false;
    setLinesLoading(true);
    fetchBudgetLinesForProject({ project_id: projectId })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setBudgetLines(
            res.data.map((l) => ({
              id: l.id,
              label: l.label,
              remaining_amount: l.remaining_amount,
            })),
          );
        } else {
          setBudgetLines([]);
        }
      })
      .catch(() => {
        if (!cancelled) setBudgetLines([]);
      })
      .finally(() => {
        if (!cancelled) setLinesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, form, canPickBudgetLine]);

  // Project-scoped CoA options. Same rhythm as the budget-line fetch —
  // reset the previously chosen CoA when project changes so we never
  // submit a coa_id that belongs to a different project's budget.
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
  }, [projectId, form, canPickCoa]);

  // When user picks a specific MA (budget line) that has a CoA
  // registered, auto-fill the CoA field to match. Finance / PM can
  // still override — the CoA select stays enabled. Reads the current
  // options list because that's where the ma_labels metadata lives.
  const budgetDetailId = form.watch("budget_detail_id");
  React.useEffect(() => {
    if (!canPickCoa || !budgetDetailId) return;
    // Find the budget line and derive its coa_id via `budgetLines`
    // (which currently only carries id + label). We do not have the
    // coa_id here — for auto-fill we'd need it. Skipping the auto-fill
    // for now; users can still pick manually. Kept as a TODO if the
    // client wants tighter coupling later.
  }, [budgetDetailId, canPickCoa]);

  function onSelectFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files;
    if (!picked || picked.length === 0) return;
    const next: File[] = [...stagedFiles];
    for (const f of Array.from(picked)) {
      // Client-side pre-validation. The server re-validates too, so this is
      // just an early UX gate to avoid uploading a bad file.
      if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(f.type)) {
        toast.error(`${f.name}: unsupported file type`);
        continue;
      }
      if (f.size > DEFAULT_MAX_BYTES) {
        toast.error(`${f.name}: exceeds 10 MB limit`);
        continue;
      }
      next.push(f);
    }
    setStagedFiles(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeStagedFile(idx: number) {
    setStagedFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function onSaveDraft(values: FormValues) {
    const cleaned = values.amount_idr.replaceAll(".", "").replaceAll(",", "");
    const payload: SaveDraftExpenseInput = {
      project_id: values.project_id,
      budget_detail_id: values.budget_detail_id || undefined,
      coa_id:
        values.coa_id && values.coa_id !== COA_NONE
          ? values.coa_id
          : undefined,
      amount_idr: Number(cleaned),
      payment_method: values.payment_method || undefined,
      description: values.description,
      notes: values.notes || undefined,
      incurred_on: values.incurred_on,
      late_submission_reason: values.late_submission_reason || undefined,
    };
    startTransition(async () => {
      setUploadPhase("saving");
      const result = await saveDraftExpenseAction(payload);
      if (!result.ok) {
        toast.error(result.reason);
        setUploadPhase("idle");
        return;
      }
      const expenseId = result.data.id;

      // If the user staged receipts in the sheet, upload them right after the
      // draft is created so they don't have to bounce to the detail page for
      // a common case.
      if (stagedFiles.length > 0) {
        setUploadPhase("uploading");
        const fd = new FormData();
        fd.set("expense_id", expenseId);
        for (const f of stagedFiles) fd.append("files", f);
        const uploadRes = await uploadExpenseReceiptsAction(fd);
        if (!uploadRes.ok) {
          // Draft is already saved — surface the upload error but still
          // route the user to the detail page so they can retry / continue.
          toast.error(uploadRes.reason);
        } else {
          toast.success(tf("draftSaved"));
        }
      } else {
        toast.success(tf("draftSaved"));
      }

      form.reset(makeDefaults());
      setStagedFiles([]);
      setUploadPhase("idle");
      setOpen(false);
      router.push(`/finance/expenses/${expenseId}`);
    });
  }

  const hasProjects = projects.length > 0;

  // Explicit label lookups. Base UI Select's default value rendering shows
  // whatever's inside the currently mounted `<Item>` — but between renders
  // the item may not be mounted yet, which can make the trigger flash the
  // raw UUID value. Using the `children` render prop guarantees we always
  // resolve to the human label from our source array.
  const projectLabelFor = React.useCallback(
    (id: string) => projects.find((p) => p.id === id)?.label ?? id,
    [projects],
  );
  const budgetLineLabelFor = React.useCallback(
    (id: string) => budgetLines.find((l) => l.id === id)?.label ?? id,
    [budgetLines],
  );

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
          <div className="px-4 pb-4 text-sm text-muted-foreground">
            {tf("needsProject")}
          </div>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSaveDraft)}
              className="@container flex flex-1 flex-col gap-4 overflow-y-auto px-4"
            >
              {/* Row 1: Project (+ MA when the caller has classification
                  privileges). Employee-level submitters see only Project
                  here; PM/Finance code the MA line later during review. */}
              <div
                className={`grid gap-3 ${
                  canPickBudgetLine ? "@md:grid-cols-2" : ""
                }`}
              >
                <FormField
                  control={form.control}
                  name="project_id"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>
                        {tf("project")}
                        <span className="text-rose-500">*</span>
                      </FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full min-w-0">
                            <SelectValue
                              placeholder={tf("projectPlaceholder")}
                            >
                              {(value) =>
                                value
                                  ? projectLabelFor(value as string)
                                  : tf("projectPlaceholder")
                              }
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
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

                {canPickBudgetLine ? (
                <FormField
                  control={form.control}
                  name="budget_detail_id"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>
                        {tf("budgetLine")}
                        <span className="text-rose-500">*</span>
                      </FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={!projectId || linesLoading}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full min-w-0">
                            <SelectValue
                              placeholder={
                                !projectId
                                  ? tf("budgetLinePlaceholderNoProject")
                                  : linesLoading
                                    ? tf("budgetLineLoading")
                                    : budgetLines.length === 0
                                      ? tf("budgetLineEmpty")
                                      : tf("budgetLinePlaceholder")
                              }
                            >
                              {(value) =>
                                value
                                  ? budgetLineLabelFor(value as string)
                                  : !projectId
                                    ? tf("budgetLinePlaceholderNoProject")
                                    : linesLoading
                                      ? tf("budgetLineLoading")
                                      : budgetLines.length === 0
                                        ? tf("budgetLineEmpty")
                                        : tf("budgetLinePlaceholder")
                              }
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent alignItemWithTrigger={false}>
                          {budgetLines.map((l) => (
                            <SelectItem key={l.id} value={l.id}>
                              {l.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground leading-tight">
                        {projectId && !linesLoading && budgetLines.length === 0
                          ? tf("budgetLineEmptyHint")
                          : tf("budgetLineHint")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                ) : null}
              </div>

              {canPickCoa ? (
                <FormField
                  control={form.control}
                  name="coa_id"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
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

              {/* Row 2: Amount + Date. Payment method sits on its own row to
                  avoid the label wrapping when the sheet is narrow. */}
              <div className="grid gap-3 @md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="amount_idr"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>
                        {tf("amount")}
                        <span className="text-rose-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <div className="flex overflow-hidden rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-primary/40">
                          <span className="grid place-items-center border-r border-input bg-muted/50 px-3 text-xs font-medium tracking-wide text-muted-foreground">
                            IDR
                          </span>
                          <input
                            {...field}
                            inputMode="numeric"
                            placeholder="100000"
                            className="flex-1 min-w-0 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/50"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="incurred_on"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>
                        {tf("incurredOn")}
                        <span className="text-rose-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Input type="date" className="w-full" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Row 3: Payment method, full width so the label never wraps. */}
              <FormField
                control={form.control}
                name="payment_method"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{tf("paymentMethod")}</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full min-w-0">
                          <SelectValue
                            placeholder={tf("paymentMethodPlaceholder")}
                          >
                            {(value) => {
                              if (!value) return tf("paymentMethodPlaceholder");
                              const key = value as SaveDraftExpenseInput["payment_method"];
                              return key ? tPm(key) : tf("paymentMethodPlaceholder");
                            }}
                          </SelectValue>
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

              {/* Row 4: Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>
                      {tf("descriptionLabel")}
                      <span className="text-rose-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={tf("descriptionPlaceholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Row 5: Notes */}
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{tf("notes")}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        {...field}
                        placeholder={tf("notesPlaceholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Row 5b: Late-submission justification.
                  Muncul kalau `incurred_on` sudah lebih dari 7 hari kerja
                  (business-day math). Wajib diisi supaya server action
                  meloloskan submit; kalau kosong, server akan menolak
                  dengan pesan yg jelas. Terpisah dari `notes` supaya
                  approver bisa filter/flag berdasarkan alasan. */}
              {(() => {
                const incurred = form.watch("incurred_on");
                if (!incurred) return null;
                let wdOld = 0;
                try {
                  wdOld = -businessDaysUntil(incurred, new Date());
                } catch {
                  return null;
                }
                if (wdOld <= 7) return null;
                return (
                  <FormField
                    control={form.control}
                    name="late_submission_reason"
                    render={({ field }) => (
                      <FormItem className="min-w-0">
                        <FormLabel>
                          {tf("lateReasonLabel", { days: wdOld })}
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            rows={2}
                            {...field}
                            placeholder={tf("lateReasonPlaceholder")}
                          />
                        </FormControl>
                        <p className="text-xs text-muted-foreground">
                          {tf("lateReasonHint")}
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                );
              })()}

              {/* Row 6: Receipts — files are staged in memory and uploaded
                  automatically right after the draft is saved. */}
              <div className="min-w-0">
                <p className="text-sm font-medium leading-none">
                  {tf("receipts")}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_MIME_TYPES.join(",")}
                  multiple
                  className="sr-only"
                  onChange={onSelectFiles}
                  disabled={isPending}
                />
                <div className="mt-2 flex flex-col gap-3 rounded-lg border border-dashed border-input bg-muted/20 p-3 @sm:flex-row @sm:items-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isPending}
                    className="w-fit"
                  >
                    <Upload className="size-4" />
                    {tf("addReceipt")}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {stagedFiles.length > 0
                      ? tf("receiptsAttached", { n: stagedFiles.length })
                      : tf("receiptsHint")}
                  </p>
                </div>
                {stagedFiles.length > 0 ? (
                  <ul className="mt-2 grid gap-1">
                    {stagedFiles.map((file, i) => {
                      const isImage = file.type.startsWith("image/");
                      return (
                        <li
                          key={`${file.name}-${i}`}
                          className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs"
                        >
                          {isImage ? (
                            <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          ) : (
                            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="flex-1 truncate">{file.name}</span>
                          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                            {(file.size / 1024).toFixed(0)} KB
                          </span>
                          <button
                            type="button"
                            onClick={() => removeStagedFile(i)}
                            disabled={isPending}
                            aria-label={tf("removeStagedReceipt")}
                            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                          >
                            <X className="size-3.5" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>

              <SheetFooter className="sticky bottom-0 mt-auto flex-row flex-wrap items-center justify-between gap-2 border-t border-border/50 bg-popover px-0 py-3">
                <p className="text-xs text-muted-foreground">
                  {uploadPhase === "uploading"
                    ? tf("uploadingReceipts")
                    : tf("draftHint")}
                </p>
                <div className="flex gap-2">
                  <SheetClose
                    render={
                      <Button
                        variant="ghost"
                        type="button"
                        disabled={isPending}
                      >
                        {tCommon("cancel")}
                      </Button>
                    }
                  />
                  <Button type="submit" disabled={isPending}>
                    {isPending ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : null}
                    {tf("saveDraft")}
                  </Button>
                </div>
              </SheetFooter>
            </form>
          </Form>
        )}
      </SheetContent>
    </Sheet>
  );
}
