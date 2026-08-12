"use client";

import * as React from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  createEmployeeSchema,
  EMPLOYEE_AVAILABILITIES,
  EMPLOYEE_ROLES,
  EMPLOYMENT_TYPES,
  NON_PERMANENT_TYPES,
  type CreateEmployeeInput,
  type EmployeeAvailabilityInput,
  type EmployeeRoleInput,
  type EmploymentTypeInput,
} from "@/lib/validation/employee";

import { createEmployeeAction, updateEmployeeAction } from "./actions";

/**
 * Manager candidate for the reports-to select. Passed from the parent
 * server component so the sheet doesn't need its own client-side
 * fetcher — the directory list already loads these rows for the main
 * table.
 */
export type ManagerOption = {
  id: string;
  full_name: string;
  role: string;
};

/**
 * Existing employee prefill payload for edit mode. All optional fields
 * come as `null` from Postgres — the form defaults coerce those to
 * `undefined` so RHF doesn't treat them as "user cleared this field on
 * purpose" (which would then send `null` to the server and blow away
 * data unintentionally).
 */
export type ExistingEmployee = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  department: string | null;
  position_title: string | null;
  role: string;
  date_of_birth: string | null;
  join_date: string;
  employment_type: string;
  contract_end_date: string | null;
  availability: string;
  reports_to_employee_id: string | null;
};

/**
 * Sentinel value for the "no manager" option. `<Select>` refuses an
 * empty string, and RHF treats `undefined` as "leave the field alone",
 * so we round-trip through this literal and coerce it back to
 * `undefined` in the onValueChange handler.
 */
const REPORTS_TO_NONE = "__none";

/**
 * `role` on manager options is `string` because the parent projects
 * `EmployeeRoleEnum` from the DB shape — which is a broader union
 * (legacy DB enum) than `EmployeeRoleInput` (canonical). Fall back to
 * the raw string when the key is unknown so the select still shows
 * something useful for legacy rows instead of throwing.
 */
function roleLabel(
  tRole: (key: EmployeeRoleInput) => string,
  raw: string,
): string {
  if ((EMPLOYEE_ROLES as readonly string[]).includes(raw)) {
    return tRole(raw as EmployeeRoleInput);
  }
  return raw;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Coerce a DB role string back into the canonical enum. Rows created
 * during the legacy 10-value phase may still carry values like
 * `HEAD_MANAGER`; those are already in `EMPLOYEE_ROLES` so this is
 * effectively a null-safe cast.
 */
function coerceRole(raw: string | null | undefined): EmployeeRoleInput {
  if (raw && (EMPLOYEE_ROLES as readonly string[]).includes(raw)) {
    return raw as EmployeeRoleInput;
  }
  return "EMPLOYEE";
}

function coerceEmployment(raw: string | null | undefined): EmploymentTypeInput {
  if (raw && (EMPLOYMENT_TYPES as readonly string[]).includes(raw)) {
    return raw as EmploymentTypeInput;
  }
  return "PERMANENT";
}

function coerceAvailability(
  raw: string | null | undefined,
): EmployeeAvailabilityInput {
  if (raw && (EMPLOYEE_AVAILABILITIES as readonly string[]).includes(raw)) {
    return raw as EmployeeAvailabilityInput;
  }
  return "AVAILABLE";
}

function buildDefaults(existing?: ExistingEmployee): CreateEmployeeInput {
  if (!existing) {
    return {
      first_name: "",
      last_name: undefined,
      email: "",
      phone: undefined,
      department: undefined,
      position_title: undefined,
      role: "EMPLOYEE",
      date_of_birth: undefined,
      join_date: todayIso(),
      employment_type: "PERMANENT",
      contract_end_date: undefined,
      availability: "AVAILABLE",
      reports_to_employee_id: undefined,
      notes: undefined,
    };
  }
  return {
    first_name: existing.first_name,
    last_name: existing.last_name ?? undefined,
    email: existing.email,
    phone: existing.phone ?? undefined,
    department: existing.department ?? undefined,
    position_title: existing.position_title ?? undefined,
    role: coerceRole(existing.role),
    date_of_birth: existing.date_of_birth ?? undefined,
    join_date: existing.join_date,
    employment_type: coerceEmployment(existing.employment_type),
    contract_end_date: existing.contract_end_date ?? undefined,
    availability: coerceAvailability(existing.availability),
    reports_to_employee_id: existing.reports_to_employee_id ?? undefined,
    notes: undefined,
  };
}

/**
 * `departmentOptions` and `positionOptions` are the ACTIVE labels loaded
 * from `lookup_options` (domain: department / position) at the parent
 * server-component level. They feed the datalist attached to the free-text
 * inputs — users may pick a suggestion OR type a custom value (rules §6
 * "free-text with Combobox suggestion").
 */
type EmployeeUpsertSheetProps = {
  /** When provided, the sheet is in edit mode — prefills fields and
   *  calls `updateEmployeeAction` on submit. Skip for create mode. */
  existing?: ExistingEmployee;
  departmentOptions?: readonly string[];
  positionOptions?: readonly string[];
  /**
   * Existing employees that a hire can report to. Rendered in the
   * `reports_to_employee_id` select alongside a "no manager" sentinel.
   * When empty, the field renders disabled with a helper hint. In edit
   * mode the current row is filtered out client-side to prevent
   * self-reporting (the DB-level FK check would otherwise be the only
   * guard, and its error message is not friendly).
   */
  managerOptions?: readonly ManagerOption[];
  /**
   * Controlled open state. When provided (e.g. from a row-actions
   * dropdown driving the edit flow), the sheet omits its own trigger
   * button.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function EmployeeUpsertSheet({
  existing,
  departmentOptions = [],
  positionOptions = [],
  managerOptions = [],
  open: openProp,
  onOpenChange,
}: EmployeeUpsertSheetProps = {}) {
  const t = useTranslations("employees");
  const tf = useTranslations("employees.form");
  const tType = useTranslations("employees.employmentType");
  const tAvail = useTranslations("employees.availability");
  const tRole = useTranslations("employees.role");
  const tCommon = useTranslations("common");

  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [isPending, startTransition] = React.useTransition();

  const isEdit = Boolean(existing);
  // Only render the "+ New employee" trigger when no external control
  // is provided AND we're in create mode. Edit sheets are always driven
  // externally from a row-action dropdown.
  const showTrigger = !isEdit && openProp === undefined;

  const form = useForm<CreateEmployeeInput>({
    resolver: zodResolver(
      createEmployeeSchema,
    ) as unknown as Resolver<CreateEmployeeInput>,
    defaultValues: buildDefaults(existing),
    mode: "onBlur",
  });

  // When the caller swaps `existing` (e.g. clicked Edit on a different
  // row while the sheet was still mounted, or reopened after a save),
  // wipe RHF state to the new snapshot. Also reset when the sheet
  // closes in create mode so the next open starts empty.
  React.useEffect(() => {
    if (open) {
      form.reset(buildDefaults(existing));
    }
    // Purposefully NOT re-running on `form` changes — RHF's `reset`
    // is stable-by-reference across renders. The dep array only cares
    // about which snapshot we're loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id]);

  const employmentType = form.watch("employment_type");
  const isPermanent = employmentType === "PERMANENT";
  const endDateRequired = NON_PERMANENT_TYPES.includes(employmentType);

  // In edit mode, exclude the row itself from the manager candidates so
  // the admin can't accidentally point `reports_to` at the same
  // employee. The FK constraint at the DB level does not prevent this
  // (a self-cycle is a valid FK).
  const filteredManagers = React.useMemo(() => {
    if (!existing) return managerOptions;
    return managerOptions.filter((m) => m.id !== existing.id);
  }, [managerOptions, existing]);

  function onSubmit(values: CreateEmployeeInput) {
    startTransition(async () => {
      const result = existing
        ? await updateEmployeeAction({ id: existing.id, ...values })
        : await createEmployeeAction(values);
      if (result.ok) {
        toast.success(
          isEdit
            ? tf("updated", { name: values.first_name })
            : tf("created", { name: values.first_name }),
        );
        if (!isEdit) {
          form.reset(buildDefaults());
        }
        setOpen(false);
      } else {
        toast.error(result.reason);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {showTrigger ? (
        <SheetTrigger
          render={
            <Button size="sm">
              <Plus className="size-4" />
              {t("newEmployee")}
            </Button>
          }
        />
      ) : null}
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-xl data-[side=right]:md:max-w-2xl data-[side=right]:lg:max-w-3xl"
      >
        <SheetHeader>
          <SheetTitle>
            {isEdit ? tf("editTitle") : tf("createTitle")}
          </SheetTitle>
          <SheetDescription>
            {isEdit ? tf("editDescription") : tf("createDescription")}
          </SheetDescription>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
          >
            {/* Name row */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="first_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {tf("firstName")}{" "}
                      <span className="text-rose-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="last_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("lastName")}</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="off"
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
            </div>

            {/* Contact row */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {tf("email")} <span className="text-rose-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("phone")}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="+62 812 3456 7890"
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
            </div>

            {/* Department + Position — free-text with datalist suggestions.
                Admin curates the option pool via `/settings/lookups`; users
                may still type a custom value (rules §6 "loose" mode). */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("department")}</FormLabel>
                    <FormControl>
                      <Input
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value.length > 0
                              ? e.target.value
                              : undefined,
                          )
                        }
                        list="employee-department-suggestions"
                        placeholder={tf("selectDepartment")}
                        autoComplete="off"
                      />
                    </FormControl>
                    <datalist id="employee-department-suggestions">
                      {departmentOptions.map((label) => (
                        <option key={label} value={label} />
                      ))}
                    </datalist>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="position_title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("position")}</FormLabel>
                    <FormControl>
                      <Input
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value.length > 0
                              ? e.target.value
                              : undefined,
                          )
                        }
                        list="employee-position-suggestions"
                        placeholder={tf("selectPosition")}
                        autoComplete="off"
                      />
                    </FormControl>
                    <datalist id="employee-position-suggestions">
                      {positionOptions.map((label) => (
                        <option key={label} value={label} />
                      ))}
                    </datalist>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Role (RBAC) + Reports-to hierarchy. Role drives approval
                chains + capability gates (rules §6 + §9); reports-to
                only affects org-chart displays for now, but the OM
                cascade in `resolveEmployeeScope()` and the daily digest
                also lean on it. Both fields are optional in the sense
                that the create schema gives them sensible defaults
                (`EMPLOYEE` + null), but the form always shows them
                explicitly so admins are never surprised. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {tf("role")} <span className="text-rose-500">*</span>
                    </FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) =>
                        field.onChange(v as EmployeeRoleInput)
                      }
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {field.value ? tRole(field.value) : null}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {EMPLOYEE_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {tRole(r)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {tf("roleHint")}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="reports_to_employee_id"
                render={({ field }) => {
                  const noManagers = filteredManagers.length === 0;
                  return (
                    <FormItem>
                      <FormLabel>{tf("reportsTo")}</FormLabel>
                      <Select
                        value={field.value ?? REPORTS_TO_NONE}
                        onValueChange={(v) =>
                          field.onChange(v === REPORTS_TO_NONE ? undefined : v)
                        }
                        disabled={noManagers}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue>
                              {(() => {
                                if (!field.value) return tf("reportsToNone");
                                const match = filteredManagers.find(
                                  (m) => m.id === field.value,
                                );
                                return match?.full_name ?? tf("reportsToNone");
                              })()}
                            </SelectValue>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={REPORTS_TO_NONE}>
                            {tf("reportsToNone")}
                          </SelectItem>
                          {filteredManagers.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.full_name}
                              <span className="ml-1 text-xs text-muted-foreground">
                                · {roleLabel(tRole, m.role)}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {noManagers
                          ? tf("reportsToEmptyHint")
                          : tf("reportsToHint")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  );
                }}
              />
            </div>

            {/* Join / Employment / End / Availability — max 2 columns.
                A 4-column row would always look cramped inside a right-side
                sheet (max-w-2xl ≈ 672px) — labels wrap, native date inputs
                collide with select triggers, and translated strings
                (e.g. "PERMANENT", "AVAILABLE") get truncated. Stacking 2x2
                keeps every field readable across all breakpoints. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="join_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {tf("joinDate")}{" "}
                      <span className="text-rose-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="employment_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("employment")}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) =>
                        field.onChange(v as EmploymentTypeInput)
                      }
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {field.value ? tType(field.value) : null}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {EMPLOYMENT_TYPES.map((et) => (
                          <SelectItem key={et} value={et}>
                            {tType(et)}
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
                name="contract_end_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {tf("endDate")}
                      {endDateRequired ? (
                        <span className="text-rose-500"> *</span>
                      ) : null}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        aria-describedby="employment-end-hint"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="availability"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("availability")}</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) =>
                        field.onChange(v as EmployeeAvailabilityInput)
                      }
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {field.value ? tAvail(field.value) : null}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {EMPLOYEE_AVAILABILITIES.map((a) => (
                          <SelectItem key={a} value={a}>
                            {tAvail(a)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Contextual hint for the End date field — kept out of the
                4-column grid so its wrapping text doesn't distort column
                heights on narrow viewports. */}
            <p
              id="employment-end-hint"
              className="text-xs text-muted-foreground leading-relaxed -mt-1"
            >
              {isPermanent
                ? tf("endDatePermanentHint")
                : tf("endDateContractHint")}
            </p>

            {/* DOB (permanent employees only) */}
            {isPermanent ? (
              <FormField
                control={form.control}
                name="date_of_birth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tf("dateOfBirth")}</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        aria-describedby="dob-hint"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}
            {isPermanent ? (
              <p
                id="dob-hint"
                className="text-xs text-muted-foreground leading-relaxed -mt-1"
              >
                {tf("dateOfBirthHint")}
              </p>
            ) : null}

            <SheetFooter className="mt-4 flex-row justify-end gap-2 px-0">
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
                {tCommon("save")}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
