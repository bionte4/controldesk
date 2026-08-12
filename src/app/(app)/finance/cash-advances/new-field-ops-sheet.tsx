"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray } from "react-hook-form";
import { useTranslations } from "next-intl";
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  ALLOWED_MIME_TYPES,
  DEFAULT_MAX_BYTES,
} from "@/lib/attachments/constants";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { formatIDR } from "@/lib/format/money";
import { caFieldOpsApprovalChain } from "@/lib/rbac/roles";
import { ApprovalChainProgress } from "@/components/approvals/approval-chain-progress";

import { saveDraftFieldOpsAction } from "./field-ops-actions";
import { uploadCashAdvanceAttachmentsAction } from "./upload-actions";
import { fetchCoaForProject } from "../expenses/lookup-actions";

export type ProjectOption = { id: string; label: string };

export type LookupOption = {
  id: string;
  code: string;
  label: string;
  description: string | null;
  sort_order: number;
};

export type FieldOpsLookups = {
  unit_pengaju: LookupOption[];
  transport_need: LookupOption[];
  area: LookupOption[];
  rab_category: LookupOption[];
};

type RabRow = {
  category: string;
  detail: string;
  amount: string;
  coa_id: string;
};

type CoaOptionWithMa = {
  id: string;
  code: string;
  name: string;
  ma_labels: string[];
};

const COA_NONE = "__none__";

type FormValues = {
  project_id: string;
  ticket_number: string;
  unit_pengaju: string;
  justification: string;
  cid_company: string;
  area: string;
  tujuan: string;
  pic_name: string;
  pic_phone: string;
  pickup_key_bts: boolean;

  transport_need: string;
  jarak_pp_km: string;
  gmap_duration: string;
  driver_phone: string;

  bank_owner_name: string;
  bank_name: string;
  bank_account_no: string;

  rab_lines: RabRow[];
};

const DEFAULT_VALUES: FormValues = {
  project_id: "",
  ticket_number: "",
  unit_pengaju: "",
  justification: "",
  cid_company: "",
  area: "",
  tujuan: "",
  pic_name: "",
  pic_phone: "",
  pickup_key_bts: false,
  transport_need: "",
  jarak_pp_km: "",
  gmap_duration: "",
  driver_phone: "",
  bank_owner_name: "",
  bank_name: "",
  bank_account_no: "",
  rab_lines: [{ category: "", detail: "", amount: "", coa_id: "" }],
};

function parseAmount(input: string): number {
  const cleaned = input.replaceAll(".", "").replaceAll(",", "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function parseDecimal(input: string): number | undefined {
  const cleaned = input.replace(",", ".").trim();
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const EMPTY_LOOKUPS: FieldOpsLookups = {
  unit_pengaju: [],
  transport_need: [],
  area: [],
  rab_category: [],
};

export function NewFieldOpsSheet({
  projects,
  isFieldTech,
  disabled = false,
  disabledReason,
  lookups = EMPTY_LOOKUPS,
  canPickCoa = false,
}: {
  projects: ProjectOption[];
  isFieldTech: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /**
   * Admin-managed reference data for the four combobox fields on the
   * form. See `loadFieldOpsFormLookups()` in `src/lib/data/lookups.ts`.
   * Options are stored/read as `label` (denormalised snapshot) so
   * historical rows stay stable when admins rename entries.
   */
  lookups?: FieldOpsLookups;
  /**
   * When true each RAB row shows a CoA dropdown fed by the project-
   * scoped CoA list (only accounts already coded on this project's
   * budget lines). Employees still submit without CoAs; Finance codes
   * them during settlement / review.
   */
  canPickCoa?: boolean;
}) {
  const t = useTranslations("cashAdvances");
  const tf = useTranslations("cashAdvances.fieldOpsForm");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();
  const [stagedFiles, setStagedFiles] = React.useState<File[]>([]);
  const [uploadPhase, setUploadPhase] = React.useState<
    "idle" | "saving" | "uploading"
  >("idle");
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({ defaultValues: DEFAULT_VALUES });
  const rab = useFieldArray({ control: form.control, name: "rab_lines" });

  // Project-scoped CoA options — refetched whenever the picked project
  // changes. When project is cleared we blank every row's coa_id too
  // so the form can't submit a cross-project reference.
  const projectId = form.watch("project_id");
  const [coaOptions, setCoaOptions] = React.useState<CoaOptionWithMa[]>([]);
  const [coaLoading, setCoaLoading] = React.useState(false);

  React.useEffect(() => {
    if (!canPickCoa) return;
    if (!projectId) {
      setCoaOptions([]);
      // Reset every RAB row's coa_id in case a project was previously
      // set and the user cleared it.
      const current = form.getValues("rab_lines") ?? [];
      current.forEach((_, idx) => form.setValue(`rab_lines.${idx}.coa_id`, ""));
      return;
    }
    let cancelled = false;
    setCoaLoading(true);
    fetchCoaForProject({ project_id: projectId })
      .then((res) => {
        if (cancelled) return;
        setCoaOptions(res.ok ? res.data : []);
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

  // Live-compute RAB total for chain preview.
  const rabRows = form.watch("rab_lines");
  const rabTotal = React.useMemo(
    () =>
      rabRows.reduce((acc, row) => acc + parseAmount(row.amount ?? ""), 0),
    [rabRows],
  );

  const chainSlots = React.useMemo(
    () => caFieldOpsApprovalChain(rabTotal),
    [rabTotal],
  );
  const slotLabelMap: Record<string, string> = {
    SUPERVISOR: tf("chainSupervisor"),
    PM: tf("chainManagerOnSite"),
    OM: tf("chainLeadOm"),
    FINANCE: tf("chainFinance"),
    DIRECTOR: tf("chainHeadOps"),
  };

  const projectMap = React.useMemo(() => {
    const m = new Map<string, string>();
    projects.forEach((p) => m.set(p.id, p.label));
    return m;
  }, [projects]);

  const canSubmit = !disabled && isFieldTech && projects.length > 0;
  const buttonHint = disabled
    ? (disabledReason ?? t("newFieldOpsDisabled"))
    : !isFieldTech
      ? t("newFieldOpsDisabled")
      : projects.length === 0
        ? tf("needsFieldTech")
        : undefined;

  function onSelectFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files;
    if (!picked || picked.length === 0) return;
    const next: File[] = [...stagedFiles];
    for (const f of Array.from(picked)) {
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
    if (!values.project_id) {
      form.setError("project_id", { message: tf("projectPlaceholder") });
      return;
    }
    if (!values.ticket_number.trim()) {
      form.setError("ticket_number", { message: tf("ticketNumberPlaceholder") });
      return;
    }

    // Client-side RAB sanity: at least one row with amount > 0.
    const cleanedLines = values.rab_lines
      .map((row) => ({
        category: row.category.trim(),
        detail: row.detail.trim(),
        amount: parseAmount(row.amount),
        coa_id:
          row.coa_id && row.coa_id !== COA_NONE ? row.coa_id : undefined,
      }))
      .filter((row) => row.category !== "" && row.amount > 0);

    startTransition(async () => {
      setUploadPhase("saving");
      const result = await saveDraftFieldOpsAction({
        project_id: values.project_id,
        ticket_number: values.ticket_number.trim(),
        unit_pengaju: values.unit_pengaju.trim() || undefined,
        justification: values.justification.trim() || undefined,
        cid_company: values.cid_company.trim() || undefined,
        area: values.area.trim() || undefined,
        tujuan: values.tujuan.trim() || undefined,
        pic_name: values.pic_name.trim() || undefined,
        pic_phone: values.pic_phone.trim() || undefined,
        pickup_key_bts: values.pickup_key_bts,
        transport_need: values.transport_need.trim() || undefined,
        jarak_pp_km: parseDecimal(values.jarak_pp_km),
        gmap_duration: values.gmap_duration.trim() || undefined,
        driver_phone: values.driver_phone.trim() || undefined,
        bank_owner_name: values.bank_owner_name.trim() || undefined,
        bank_name: values.bank_name.trim() || undefined,
        bank_account_no: values.bank_account_no.trim() || undefined,
        rab_lines: cleanedLines.map((row, idx) => ({
          seq: idx + 1,
          category: row.category,
          detail: row.detail || undefined,
          amount: row.amount,
          coa_id: row.coa_id,
        })),
      });

      if (!result.ok) {
        toast.error(result.reason ?? "Failed to save draft.");
        setUploadPhase("idle");
        return;
      }

      const caId = result.data.id;

      // Upload any staged attachments right after the draft is created
      // so users don't have to bounce to the detail page for a common
      // case (Gmap screenshot + memo pendukung + foto site).
      if (stagedFiles.length > 0) {
        setUploadPhase("uploading");
        const fd = new FormData();
        fd.set("cash_advance_id", caId);
        for (const f of stagedFiles) fd.append("files", f);
        const uploadRes = await uploadCashAdvanceAttachmentsAction(fd);
        if (!uploadRes.ok) {
          // Draft is already saved — surface the upload error but still
          // route to the detail page so the user can retry there.
          toast.error(uploadRes.reason);
        } else {
          toast.success(tf("saveDraftSaved"));
        }
      } else {
        toast.success(tf("saveDraftSaved"));
      }

      form.reset(DEFAULT_VALUES);
      setStagedFiles([]);
      setUploadPhase("idle");
      setOpen(false);
      router.push(`/finance/cash-advances/${caId}`);
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            size="sm"
            variant={canSubmit ? "default" : "secondary"}
            disabled={!canSubmit}
            title={buttonHint}
          >
            <Plus className="size-4" />
            {t("newFieldOps")}
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
          <form
            onSubmit={form.handleSubmit(onSaveDraft)}
            className="@container flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-2"
          >
            {/* ---------- Section 1 ---------- */}
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {tf("section1")}
              </h3>

              <div className="grid gap-3 @md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="project_id"
                  render={({ field }) => (
                    <FormItem className="min-w-0 @md:col-span-2">
                      <FormLabel>{tf("project")} *</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full min-w-0">
                            <SelectValue placeholder={tf("projectPlaceholder")}>
                              {field.value
                                ? projectMap.get(field.value)
                                : undefined}
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
                  )}
                />

                <FormField
                  control={form.control}
                  name="ticket_number"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>{tf("ticketNumber")} *</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={tf("ticketNumberPlaceholder")}
                          {...field}
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
                    <FormItem className="min-w-0">
                      <FormLabel>{tf("unitPengaju")}</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={lookups.unit_pengaju.length === 0}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full min-w-0">
                            <SelectValue
                              placeholder={
                                lookups.unit_pengaju.length === 0
                                  ? tf("lookupEmpty")
                                  : tf("unitPengajuPlaceholder")
                              }
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {lookups.unit_pengaju.map((opt) => (
                            <SelectItem key={opt.id} value={opt.label}>
                              {opt.label}
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
                  name="justification"
                  render={({ field }) => (
                    <FormItem className="min-w-0 @md:col-span-2">
                      <FormLabel>{tf("justification")}</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={2}
                          placeholder={tf("justificationPlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="cid_company"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>{tf("cidCompany")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={tf("cidCompanyPlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="area"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>{tf("area")}</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={lookups.area.length === 0}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full min-w-0">
                            <SelectValue
                              placeholder={
                                lookups.area.length === 0
                                  ? tf("lookupEmpty")
                                  : tf("areaPlaceholder")
                              }
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {lookups.area.map((opt) => (
                            <SelectItem key={opt.id} value={opt.label}>
                              {opt.label}
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
                  name="tujuan"
                  render={({ field }) => (
                    <FormItem className="min-w-0 @md:col-span-2">
                      <FormLabel>{tf("tujuan")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={tf("tujuanPlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="pic_name"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>{tf("picName")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={tf("picNamePlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="pic_phone"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>{tf("picPhone")}</FormLabel>
                      <FormControl>
                        <Input placeholder="+62 …" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="pickup_key_bts"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center gap-2 pt-6 @md:col-span-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                      <FormLabel className="!m-0 font-normal">
                        {tf("pickupKeyBts")}
                      </FormLabel>
                    </FormItem>
                  )}
                />
              </div>
            </section>

            {/* ---------- Section 2 ---------- */}
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {tf("section2")}
              </h3>

              <div className="grid gap-3 @md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="transport_need"
                  render={({ field }) => (
                    <FormItem className="min-w-0 @md:col-span-2">
                      <FormLabel>{tf("transportNeed")}</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={lookups.transport_need.length === 0}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full min-w-0">
                            <SelectValue
                              placeholder={
                                lookups.transport_need.length === 0
                                  ? tf("lookupEmpty")
                                  : tf("transportNeedPlaceholder")
                              }
                            />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {lookups.transport_need.map((opt) => (
                            <SelectItem key={opt.id} value={opt.label}>
                              {opt.label}
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
                  name="jarak_pp_km"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>{tf("jarakPpKm")}</FormLabel>
                      <FormControl>
                        <Input inputMode="decimal" placeholder="0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="gmap_duration"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>{tf("gmapDuration")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={tf("gmapDurationPlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="driver_phone"
                  render={({ field }) => (
                    <FormItem className="min-w-0 @md:col-span-2">
                      <FormLabel>{tf("driverPhone")}</FormLabel>
                      <FormControl>
                        <Input placeholder="+62 …" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </section>

            {/* ---------- RAB Table ---------- */}
            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {tf("rabTitle")}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {tf("rabHint")}
                </span>
              </div>

              {rab.fields.length === 0 ? (
                <p className="rounded-md border border-dashed border-white/10 px-3 py-4 text-sm text-muted-foreground">
                  {tf("rabEmpty")}
                </p>
              ) : (
                <div className="flex flex-col gap-1 rounded-md border border-white/10 bg-white/5 p-2">
                  {/* Table header — rendered once. Hidden on narrow
                      viewports where the rows stack single-column. The
                      column widths mirror the row grid template so the
                      labels always line up with their inputs. */}
                  <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)_auto] gap-2 px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground @md:grid">
                    <span>{tf("rabCategory")}</span>
                    <span>{tf("rabDetail")}</span>
                    <span>{tf("rabAmount")}</span>
                    <span className="w-8" aria-hidden />
                  </div>

                  <div className="flex flex-col gap-2 @md:gap-3">
                    {rab.fields.map((f, idx) => (
                      <div
                        key={f.id}
                        className="flex flex-col gap-2 @md:gap-1 @md:rounded-none @md:border-0 @md:bg-transparent @md:p-0"
                      >
                      <div className="grid grid-cols-1 items-start gap-2 @md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)_auto] @md:items-center @md:gap-2">
                        <FormField
                          control={form.control}
                          name={`rab_lines.${idx}.category`}
                          render={({ field }) => (
                            <FormItem className="min-w-0 space-y-1">
                              <FormLabel className="text-[11px] uppercase text-muted-foreground @md:sr-only">
                                {tf("rabCategory")}
                              </FormLabel>
                              <Select
                                value={field.value}
                                onValueChange={field.onChange}
                                disabled={lookups.rab_category.length === 0}
                              >
                                <FormControl>
                                  <SelectTrigger className="w-full min-w-0">
                                    <SelectValue
                                      placeholder={
                                        lookups.rab_category.length === 0
                                          ? tf("lookupEmpty")
                                          : tf("rabCategoryPlaceholder")
                                      }
                                    />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {lookups.rab_category.map((opt) => (
                                    <SelectItem key={opt.id} value={opt.label}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`rab_lines.${idx}.detail`}
                          render={({ field }) => (
                            <FormItem className="min-w-0 space-y-1">
                              <FormLabel className="text-[11px] uppercase text-muted-foreground @md:sr-only">
                                {tf("rabDetail")}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  placeholder={tf("rabDetailPlaceholder")}
                                  {...field}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name={`rab_lines.${idx}.amount`}
                          render={({ field }) => (
                            <FormItem className="min-w-0 space-y-1">
                              <FormLabel className="text-[11px] uppercase text-muted-foreground @md:sr-only">
                                {tf("rabAmount")}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  inputMode="numeric"
                                  placeholder="0"
                                  {...field}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                        <div className="flex justify-end @md:items-center @md:pt-0">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => rab.remove(idx)}
                            aria-label={tf("rabRemove")}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>

                      {canPickCoa ? (
                        <FormField
                          control={form.control}
                          name={`rab_lines.${idx}.coa_id`}
                          render={({ field }) => (
                            <FormItem className="min-w-0 space-y-1 @md:pl-1">
                              <FormLabel className="text-[11px] uppercase text-muted-foreground">
                                {tf("rabCoa")}
                              </FormLabel>
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
                                          ? tf("rabCoaPlaceholderNoProject")
                                          : coaLoading
                                            ? tf("rabCoaLoading")
                                            : coaOptions.length === 0
                                              ? tf("rabCoaEmpty")
                                              : tf("rabCoaPlaceholder")
                                      }
                                    >
                                      {(value) => {
                                        if (!value || value === COA_NONE) {
                                          return tf("rabCoaNone");
                                        }
                                        const hit = coaOptions.find(
                                          (o) => o.id === value,
                                        );
                                        return hit
                                          ? `${hit.code} · ${hit.name}`
                                          : (value as string);
                                      }}
                                    </SelectValue>
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent alignItemWithTrigger={false}>
                                  <SelectItem value={COA_NONE}>
                                    {tf("rabCoaNone")}
                                  </SelectItem>
                                  {coaOptions.map((o) => (
                                    <SelectItem key={o.id} value={o.id}>
                                      <span className="flex flex-col items-start">
                                        <span>
                                          {o.code} · {o.name}
                                        </span>
                                        {o.ma_labels.length > 0 ? (
                                          <span className="text-[11px] text-muted-foreground">
                                            MA:{" "}
                                            {o.ma_labels.slice(0, 2).join(", ")}
                                            {o.ma_labels.length > 2
                                              ? ` +${o.ma_labels.length - 2}`
                                              : ""}
                                          </span>
                                        ) : null}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                      ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    rab.append({
                      category: "",
                      detail: "",
                      amount: "",
                      coa_id: "",
                    })
                  }
                >
                  <Plus className="size-4" />
                  {tf("rabAdd")}
                </Button>
                <div className="text-right">
                  <div className="text-[11px] uppercase text-muted-foreground">
                    {tf("rabTotal")}
                  </div>
                  <div className="font-display text-lg font-semibold tabular-nums">
                    {formatIDR(rabTotal)}
                  </div>
                </div>
              </div>

              {rabTotal > 0 ? (
                <div className="rounded-md border border-white/10 bg-white/5 p-3">
                  <div className="mb-2 text-[11px] uppercase text-muted-foreground">
                    {tf("chainPreview")}
                  </div>
                  <ApprovalChainProgress
                    slots={chainSlots}
                    variant="preview"
                    size="sm"
                    renderSlot={(slot) => slotLabelMap[slot] ?? slot}
                    data-testid="ca-fieldops-chain-preview"
                    ariaLabel="Cash advance field-ops approval chain preview"
                  />
                </div>
              ) : null}
            </section>

            {/* ---------- Section 3 ---------- */}
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {tf("section3")}
              </h3>

              <div className="grid gap-3 @md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="bank_owner_name"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>{tf("bankOwnerName")}</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="bank_name"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>{tf("bankName")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={tf("bankNamePlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="bank_account_no"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>{tf("bankAccountNo")}</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" {...field} />
                      </FormControl>
                      <FormDescription>{tf("bankAccountHint")}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </section>

            {/* ---------- Section 4 — Attachments (staged) ---------- */}
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {tf("section4")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {tf("attachmentsHint")}
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
              <div className="flex flex-col gap-3 rounded-lg border border-dashed border-input bg-muted/20 p-3 @sm:flex-row @sm:items-center">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isPending}
                  className="w-fit"
                >
                  <Upload className="size-4" />
                  {tf("addAttachment")}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {stagedFiles.length > 0
                    ? tf("attachmentsAttached", { n: stagedFiles.length })
                    : tf("attachmentsPickHint")}
                </p>
              </div>

              {stagedFiles.length > 0 ? (
                <ul className="grid gap-1">
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
                          aria-label={tf("removeStagedAttachment")}
                          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                        >
                          <X className="size-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>

            <SheetFooter className="mt-2 flex flex-row items-center justify-end gap-2 border-t border-white/10 bg-background/40 px-4 py-3 backdrop-blur">
              <SheetClose
                render={
                  <Button type="button" variant="ghost" disabled={isPending}>
                    {tf("cancel")}
                  </Button>
                }
              />
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {uploadPhase === "uploading"
                  ? tf("uploadingAttachments")
                  : tf("saveDraft")}
              </Button>
            </SheetFooter>

            {!canSubmit && buttonHint ? (
              <p
                className="mt-1 px-4 pb-4 text-xs text-muted-foreground"
                aria-live="polite"
              >
                {buttonHint}
              </p>
            ) : null}
            <span className="sr-only">{tCommon("save")}</span>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
