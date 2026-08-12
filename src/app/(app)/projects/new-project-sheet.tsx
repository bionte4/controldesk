"use client";

import * as React from "react";
import { useForm, useFieldArray, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Check, Flag, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { cn } from "@/lib/utils";
import {
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
  PROJECT_TYPES,
  createProjectSchema,
  type CreateProjectInput,
} from "@/lib/validation/project";

import { createProjectAction } from "./actions";

export type ClientOption = { id: string; name: string };
export type PmOption = { id: string; name: string };
export type SponsorOption = { id: string; name: string; role?: string };

/**
 * Relaxed translator signature. `useTranslations()` returns a strongly-typed
 * accessor whose parameter is a `NamespacedMessageKeys` string literal
 * union. We only pass dynamic enum keys (PROJECT_STATUSES[i], etc.) into
 * these helpers, so we widen the parameter to plain `string` for
 * composition. The compiler still checks the keys we hard-code in JSX
 * against the namespaced union at the call site.
 */
type Translator = (key: string) => string;

const DEFAULT_VALUES: CreateProjectInput = {
  client_id: "",
  contract_id: undefined,
  code: undefined,
  name: "",
  description: undefined,
  status: "DRAFT",
  priority: "MEDIUM",
  project_type: "FIXED_PRICE",
  location: undefined,
  pm_employee_id: undefined,
  start_date: undefined,
  end_date: undefined,
  contract_value_idr: undefined,
  currency: "IDR",
  notes: undefined,
  sync_calendar: true,
  bc_executive_summary: undefined,
  bc_target_gm_pct: undefined,
  bc_sponsor_id: undefined,
  milestones: [],
};

type Step = 1 | 2 | 3;

const STEP_FIELDS: Record<Step, (keyof CreateProjectInput)[]> = {
  1: [
    "client_id",
    "name",
    "priority",
    "pm_employee_id",
    "project_type",
    "status",
    "location",
    "description",
  ],
  2: [
    "start_date",
    "end_date",
    "contract_value_idr",
    "currency",
    "notes",
    "bc_executive_summary",
    "bc_target_gm_pct",
    "bc_sponsor_id",
  ],
  3: ["milestones"],
};

function computeDurationDays(start?: string, end?: string): string {
  if (!start || !end) return "—";
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return "—";
  const days = Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1;
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export function NewProjectSheet({
  clients,
  pms,
  sponsors = [],
}: {
  clients: ClientOption[];
  pms: PmOption[];
  /**
   * Candidate BC sponsors (OM + ADMIN + DIRECTOR) offered as the
   * `bc_sponsor_id` picker on Step 2. Falls back to an empty picker
   * when the caller hasn't supplied any — the field stays optional.
   */
  sponsors?: SponsorOption[];
}) {
  const t = useTranslations("projects");
  const tf = useTranslations("projects.form");
  const tw = useTranslations("projects.wizard");
  const tStatus = useTranslations("projects.status");
  const tPriority = useTranslations("projects.priority");
  const tType = useTranslations("projects.type");
  const tCommon = useTranslations("common");

  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>(1);
  const [isPending, startTransition] = React.useTransition();

  const form = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema) as unknown as Resolver<CreateProjectInput>,
    defaultValues: DEFAULT_VALUES,
    mode: "onBlur",
  });

  const milestones = useFieldArray({
    control: form.control,
    name: "milestones",
  });

  const startDate = form.watch("start_date");
  const endDate = form.watch("end_date");
  const totalWeight = form
    .watch("milestones")
    .reduce((s, m) => s + (Number(m.weight_pct) || 0), 0);

  function reset() {
    form.reset(DEFAULT_VALUES);
    setStep(1);
  }

  async function goNext() {
    const fields = STEP_FIELDS[step];
    const ok = await form.trigger(fields as never, { shouldFocus: true });
    if (!ok) return;
    setStep((s) => (s === 3 ? 3 : ((s + 1) as Step)));
  }

  function goBack() {
    setStep((s) => (s === 1 ? 1 : ((s - 1) as Step)));
  }

  function onSubmit(values: CreateProjectInput) {
    startTransition(async () => {
      const result = await createProjectAction(values);
      if (result.ok) {
        const shownName =
          result.data.project_number ?? result.data.code ?? result.data.name;
        toast.success(tf("created", { name: shownName }));
        reset();
        setOpen(false);
      } else {
        toast.error(result.reason);
      }
    });
  }

  // Surface RHF validation blockers via a toast so the wizard never
  // silently swallows a submit attempt (rules §23 accessibility).
  function onInvalid(errors: Record<string, unknown>) {
    const first = Object.entries(errors)[0];
    if (!first) return;
    const [field, err] = first;
    const message =
      typeof err === "object" && err !== null && "message" in err
        ? String((err as { message?: unknown }).message ?? "")
        : "";
    toast.error(`${field}: ${message || "Invalid"}`);
  }

  const hasClients = clients.length > 0;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <SheetTrigger
        render={
          <Button size="sm" disabled={!hasClients}>
            <Plus className="size-4" />
            {t("newProject")}
          </Button>
        }
      />
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl data-[side=right]:lg:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>{tf("createTitle")}</SheetTitle>
          <SheetDescription>{tf("createDescription")}</SheetDescription>
        </SheetHeader>

        {!hasClients ? (
          <div className="px-4 text-sm text-muted-foreground">
            {tf("needsClient")}
          </div>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit, onInvalid)}
              className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
            >
              <Stepper current={step} labels={[tw("step1"), tw("step2"), tw("step3")]} />

              {step === 1 && (
                <StepInfo
                  form={form}
                  clients={clients}
                  pms={pms}
                  tf={tf as unknown as Translator}
                  tStatus={tStatus as unknown as Translator}
                  tPriority={tPriority as unknown as Translator}
                  tType={tType as unknown as Translator}
                />
              )}

              {step === 2 && (
                <StepTimeline
                  form={form}
                  tf={tf as unknown as Translator}
                  tw={tw as unknown as Translator}
                  duration={computeDurationDays(startDate, endDate)}
                  sponsors={sponsors}
                />
              )}

              {step === 3 && (
                <StepMilestones
                  form={form}
                  milestones={milestones}
                  tw={tw as unknown as Translator}
                  totalWeight={totalWeight}
                />
              )}

              <SheetFooter className="mt-auto flex-row items-center justify-between gap-2 px-0">
                <p className="text-xs text-muted-foreground">
                  {tw("autoNumberHint")}
                </p>
                <div className="flex items-center gap-2">
                  {step === 1 ? (
                    <SheetClose
                      render={
                        <Button variant="ghost" type="button" disabled={isPending}>
                          {tCommon("cancel")}
                        </Button>
                      }
                    />
                  ) : (
                    <Button
                      variant="ghost"
                      type="button"
                      onClick={goBack}
                      disabled={isPending}
                    >
                      {tw("back")}
                    </Button>
                  )}
                  {step < 3 ? (
                    <Button type="button" onClick={goNext} disabled={isPending}>
                      {tw("next")}
                    </Button>
                  ) : (
                    // Native <button type="submit"> — BaseUI's Button primitive
                    // renders as a non-<button> element by default, which
                    // prevents implicit form submission. RHF's handleSubmit
                    // relies on the native submit event dispatched by a real
                    // <button>, so we skip the shadcn wrapper here.
                    <button
                      type="submit"
                      disabled={isPending}
                      data-slot="button"
                      data-testid="wizard-submit"
                      className="group/button inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium whitespace-nowrap text-primary-foreground transition-all hover:bg-primary/80 disabled:pointer-events-none disabled:opacity-50"
                    >
                      {isPending ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : null}
                      {tw("saveProject")}
                    </button>
                  )}
                </div>
              </SheetFooter>
            </form>
          </Form>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Stepper header (visual progress)
// ---------------------------------------------------------------------------

function Stepper({ current, labels }: { current: Step; labels: string[] }) {
  return (
    <ol
      className="flex items-center gap-1 rounded-xl border border-border/60 bg-muted/40 p-1 text-sm"
      aria-label="Wizard progress"
    >
      {labels.map((label, i) => {
        const idx = (i + 1) as Step;
        const isActive = idx === current;
        const isDone = idx < current;
        return (
          <li
            key={label}
            className={cn(
              "flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors sm:px-3 sm:py-2",
              isActive && "bg-background text-primary shadow-sm ring-1 ring-primary/20",
              isDone && "text-emerald-600 dark:text-emerald-400",
              !isActive && !isDone && "text-muted-foreground",
            )}
            aria-current={isActive ? "step" : undefined}
          >
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                isActive && "border-primary bg-primary text-primary-foreground",
                isDone && "border-emerald-500 bg-emerald-500 text-white",
                !isActive &&
                  !isDone &&
                  "border-border bg-background text-muted-foreground",
              )}
            >
              {isDone ? <Check className="size-3.5" /> : idx}
            </span>
            <span
              className={cn(
                "truncate font-medium leading-tight",
                !isActive && "hidden sm:inline",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Info
// ---------------------------------------------------------------------------

type FormProp = ReturnType<typeof useForm<CreateProjectInput>>;

function StepInfo({
  form,
  clients,
  pms,
  tf,
  tStatus,
  tPriority,
  tType,
}: {
  form: FormProp;
  clients: ClientOption[];
  pms: PmOption[];
  tf: Translator;
  tStatus: Translator;
  tPriority: Translator;
  tType: Translator;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem className="sm:col-span-2">
            <FormLabel>
              {tf("name")} <span className="text-destructive">*</span>
            </FormLabel>
            <FormControl>
              <Input {...field} autoComplete="off" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="client_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              {tf("client")} <span className="text-destructive">*</span>
            </FormLabel>
            <Select value={field.value ?? ""} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="w-full" data-testid="wizard-client">
                  <SelectValue>
                    {(value: unknown) => {
                      const c = clients.find((x) => x.id === value);
                      return (
                        <span
                          className={cn(
                            "truncate",
                            !c && "text-muted-foreground",
                          )}
                        >
                          {c ? c.name : tf("clientPlaceholder")}
                        </span>
                      );
                    }}
                  </SelectValue>
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
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
        name="pm_employee_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tf("pm")}</FormLabel>
            <Select
              value={field.value ?? "__none__"}
              onValueChange={(v) =>
                field.onChange(v === "__none__" ? undefined : v)
              }
            >
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: unknown) => {
                      const p = pms.find((x) => x.id === value);
                      const isUnassigned = !p;
                      return (
                        <span
                          className={cn(
                            "truncate",
                            isUnassigned && "text-muted-foreground",
                          )}
                        >
                          {p ? p.name : tf("pmUnassigned")}
                        </span>
                      );
                    }}
                  </SelectValue>
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="__none__">{tf("pmUnassigned")}</SelectItem>
                {pms.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
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
        name="project_type"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              {tf("projectType")} <span className="text-destructive">*</span>
            </FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="w-full" data-testid="wizard-project-type">
                  <SelectValue>
                    {(value: unknown) =>
                      value ? (
                        <span className="truncate">{tType(String(value))}</span>
                      ) : (
                        <span className="text-muted-foreground">
                          {tf("projectTypePlaceholder")}
                        </span>
                      )
                    }
                  </SelectValue>
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {PROJECT_TYPES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {tType(s)}
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
        name="priority"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tf("priority")}</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="w-full" data-testid="wizard-priority">
                  <SelectValue>
                    {(value: unknown) => (
                      <span className="truncate">
                        {value ? tPriority(String(value)) : ""}
                      </span>
                    )}
                  </SelectValue>
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {PROJECT_PRIORITIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {tPriority(s)}
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
        name="status"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tf("status")}</FormLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <FormControl>
                <SelectTrigger className="w-full" data-testid="wizard-status">
                  <SelectValue>
                    {(value: unknown) => (
                      <span className="truncate">
                        {value ? tStatus(String(value)) : ""}
                      </span>
                    )}
                  </SelectValue>
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {PROJECT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {tStatus(s)}
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
        name="location"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tf("location")}</FormLabel>
            <FormControl>
              <Input
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                placeholder={tf("locationPlaceholder")}
                autoComplete="off"
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
          <FormItem className="sm:col-span-2">
            <FormLabel>{tf("description")}</FormLabel>
            <FormControl>
              <Textarea
                rows={3}
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                placeholder={tf("descriptionPlaceholder")}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Timeline & budget
// ---------------------------------------------------------------------------

function StepTimeline({
  form,
  tf,
  tw,
  duration,
  sponsors,
}: {
  form: FormProp;
  tf: Translator;
  tw: Translator;
  duration: string;
  sponsors: SponsorOption[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Business Case block — informational for the DRAFT (BC intake)
          stage. All three fields are optional at creation; a project
          can be born in DRAFT with an empty BC and get promoted to
          PLANNING later once these fields are filled. */}
      <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded-md bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
            {tw("bcSection")}
          </span>
          <span className="text-xs text-muted-foreground">
            {tw("bcSectionHint")}
          </span>
        </div>
        <div className="flex flex-col gap-3">
          <FormField
            control={form.control}
            name="bc_executive_summary"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{tw("bcExecutiveSummary")}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={3}
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    name={field.name}
                    placeholder={tw("bcExecutiveSummaryPlaceholder")}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="bc_target_gm_pct"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tw("bcTargetGmPct")}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step={0.1}
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                        )
                      }
                      onBlur={field.onBlur}
                      name={field.name}
                      placeholder="20"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="bc_sponsor_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tw("bcSponsor")}</FormLabel>
                  <Select
                    value={field.value ?? ""}
                    onValueChange={(v) => field.onChange(v || undefined)}
                    disabled={sponsors.length === 0}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue
                          placeholder={
                            sponsors.length === 0
                              ? tw("bcSponsorNone")
                              : tw("bcSponsorPlaceholder")
                          }
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {sponsors.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                          {s.role ? (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {s.role}
                            </span>
                          ) : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <FormField
          control={form.control}
          name="start_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {tf("startDate")} <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  type="date"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="end_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {tf("endDate")} <span className="text-destructive">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  type="date"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormItem>
          <FormLabel>{tw("duration")}</FormLabel>
          <div className="flex h-9 items-center rounded-md border border-input px-3 text-sm text-muted-foreground tabular-nums">
            {duration}
          </div>
        </FormItem>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <FormField
          control={form.control}
          name="contract_value_idr"
          render={({ field }) => (
            <FormItem className="sm:col-span-2">
              <FormLabel>{tw("contractValue")}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={field.value ?? ""}
                  onChange={(e) =>
                    field.onChange(
                      e.target.value === "" ? undefined : Number(e.target.value),
                    )
                  }
                  onBlur={field.onBlur}
                  name={field.name}
                  placeholder="0"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="currency"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tw("currency")}</FormLabel>
              <FormControl>
                <Input {...field} readOnly aria-readonly className="uppercase" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="notes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tw("notes")}</FormLabel>
            <FormControl>
              <Textarea
                rows={3}
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="sync_calendar"
        render={({ field }) => (
          <FormItem className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
            <FormControl>
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
                aria-label={tw("syncCalendar")}
              />
            </FormControl>
            <div className="flex flex-col gap-1">
              <span className="font-medium text-sm">
                {tw("syncCalendar")}
                <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  {tw("comingSoon")}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {tw("syncCalendarHint")}
              </span>
            </div>
          </FormItem>
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Milestones
// ---------------------------------------------------------------------------

function StepMilestones({
  form,
  milestones,
  tw,
  totalWeight,
}: {
  form: FormProp;
  milestones: ReturnType<typeof useFieldArray<CreateProjectInput, "milestones">>;
  tw: Translator;
  totalWeight: number;
}) {
  const weightError = form.formState.errors.milestones?.message as string | undefined;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-sm">{tw("milestonesTitle")}</h3>
          <p className="text-xs text-muted-foreground">
            {tw("milestonesHint")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            milestones.append({ name: "", due_date: undefined, weight_pct: 0 })
          }
        >
          <Plus className="size-4" /> {tw("addMilestone")}
        </Button>
      </div>

      {milestones.fields.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/70 py-8 text-center text-sm text-muted-foreground">
          <Flag className="mx-auto mb-2 size-5 text-muted-foreground/70" />
          {tw("noMilestones")}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {milestones.fields.map((f, idx) => (
            <div
              key={f.id}
              className="rounded-xl border border-border/60 bg-card/40 p-3 shadow-sm"
            >
              {/* Row 1: #index + Name */}
              <FormField
                control={form.control}
                name={`milestones.${idx}.name` as const}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">
                      <span className="mr-1 inline-flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground">
                        {idx + 1}
                      </span>
                      {tw("milestoneName")}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        className="w-full"
                        placeholder={tw("milestoneNamePlaceholder")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Row 2: Due date + Weight + Remove button */}
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <FormField
                  control={form.control}
                  name={`milestones.${idx}.due_date` as const}
                  render={({ field }) => (
                    <FormItem className="min-w-0 flex-1 basis-[180px]">
                      <FormLabel className="text-xs">
                        {tw("milestoneDue")}
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="date"
                          className="w-full"
                          value={field.value ?? ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`milestones.${idx}.weight_pct` as const}
                  render={({ field }) => (
                    <FormItem className="w-24 flex-none">
                      <FormLabel className="text-xs">
                        {tw("milestoneWeight")}
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          className="w-full text-right tabular-nums"
                          value={field.value ?? 0}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === "" ? 0 : Number(e.target.value),
                            )
                          }
                          onBlur={field.onBlur}
                          name={field.name}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => milestones.remove(idx)}
                  aria-label={tw("removeMilestone")}
                  className="flex-none text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        className={cn(
          "flex items-center justify-between rounded-lg border px-3 py-2 text-sm",
          totalWeight === 0 || totalWeight === 100
            ? "border-border/60 text-muted-foreground"
            : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        )}
      >
        <span>{tw("totalWeight")}</span>
        <span className="tabular-nums font-medium">{totalWeight}%</span>
      </div>

      {weightError ? (
        <p className="text-xs text-destructive">{weightError}</p>
      ) : null}
    </div>
  );
}
