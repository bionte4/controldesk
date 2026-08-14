import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Users2 } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateOnly } from "@/lib/format/date";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { loadLookupOptions } from "@/lib/data/lookups";
import { authorize } from "@/lib/security/pdp";
import { resolveCapabilitiesFor } from "@/lib/rbac/capability-resolver";
import { canReadSensitive } from "@/lib/security/crypto";
import { decryptEmployeePii } from "@/lib/security/employee-pii";
import type { AnyDbEmployeeRole, EmployeeRole } from "@/lib/rbac/roles";
import { resolveEmployeeScope } from "@/lib/security/project-scope";
import { createClient } from "@/lib/supabase/server";
import {
  AVAILABILITY_TONE,
  EMPLOYMENT_TYPE_TONE,
} from "@/lib/hr/directory";
import type {
  EmployeeAvailability,
  EmployeeRoleEnum,
  EmploymentType,
} from "@/types/database";

import { EmployeeRowActions } from "./employee-row-actions";
import {
  EmployeeUpsertSheet,
  type ExistingEmployee,
} from "./employee-upsert-sheet";

export const metadata: Metadata = {
  title: "Employees",
};

type EmployeeRow = {
  id: string;
  full_name: string;
  // Column is nullable in the database schema (legacy import path
  // allowed placeholder rows without a first name). In practice every
  // active row has one, but we keep the type honest and coerce when
  // handing the row to the Edit sheet.
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  // Decrypted NIK plaintext, populated ONLY for callers whose canonical
  // role passes `canReadSensitive()` (HR / Finance / Admin tiers).
  // Everyone else sees `null` and cannot even see the field in the
  // Edit sheet (which the PDP would already deny anyway; this is
  // defence-in-depth). See migration 0094 for the at-rest format.
  nik: string | null;
  division: string | null;
  department: string | null;
  position_title: string | null;
  client_display_name: string | null;
  role: EmployeeRoleEnum;
  date_of_birth: string | null;
  join_date: string;
  employment_type: EmploymentType;
  contract_end_date: string | null;
  availability: EmployeeAvailability;
  reports_to_employee_id: string | null;
};

/**
 * Narrow the RSC-side `EmployeeRow` (which carries branded DB enum
 * types) into the plain-string shape the client `EmployeeUpsertSheet`
 * expects. This is a pure projection — no runtime cost — but it keeps
 * the client component free of the `EmployeeRoleEnum | EmploymentType`
 * imports from `@/types/database`, which would otherwise leak the
 * database.ts type surface into the "use client" bundle.
 */
function toExistingEmployee(row: EmployeeRow): ExistingEmployee {
  return {
    id: row.id,
    // The upsert sheet's Zod schema rejects an empty first name — that
    // matches business intent and the DB `NOT NULL` we want to
    // migrate to. If a legacy null slips through here, the user will
    // see the "First name is required" message on submit, which is
    // the correct nudge.
    first_name: row.first_name ?? "",
    last_name: row.last_name,
    email: row.email,
    phone: row.phone,
    nik: row.nik,
    division: row.division,
    department: row.department,
    position_title: row.position_title,
    client_display_name: row.client_display_name,
    role: row.role as string,
    date_of_birth: row.date_of_birth,
    join_date: row.join_date,
    employment_type: row.employment_type as string,
    contract_end_date: row.contract_end_date,
    availability: row.availability as string,
    reports_to_employee_id: row.reports_to_employee_id,
  };
}

const MS_PER_DAY = 86_400_000;

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00Z`).getTime();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diff = Math.round((target - today.getTime()) / MS_PER_DAY);
  return diff;
}

async function loadEmployees(
  caller: { id: string; role: AnyDbEmployeeRole },
): Promise<EmployeeRow[]> {
  const supabase = await createClient();

  // Rules §3 — apply project-membership scope. Callers with an
  // "org" scope (HR / Finance / Admin / Director tiers) see every
  // employee in the tenant. Scoped callers (PM / SPV / OM) see
  // only teammates on their assigned projects. EMPLOYEE and PCC
  // never reach this loader — they're blocked by
  // `canViewEmployeeDirectory()` at the page level.
  const scope = await resolveEmployeeScope(caller);

  // NIK decryption is guarded by the caller's canonical role. HR /
  // Finance / Admin tiers get plaintext; everyone else who slipped
  // past the page guard (Supervisor / PM viewing teammates) still
  // sees the row but with `nik: null`. This keeps NIK out of Node
  // process memory whenever it isn't strictly needed. Cheap check
  // — evaluated once per loader call, not per row.
  const canDecryptPii = canReadSensitive(caller.role);

  // Include the columns the Edit sheet needs to prefill (first_name,
  // last_name, date_of_birth, reports_to_employee_id) so the row-action
  // menu can hand a fully-hydrated snapshot straight to
  // `EmployeeUpsertSheet` without a second round-trip.
  let query = supabase
    .from("employees")
    .select(
      "id, full_name, first_name, last_name, email, phone, nik_enc, division, department, position_title, client_display_name, role, date_of_birth, join_date, employment_type, contract_end_date, availability, reports_to_employee_id",
    )
    .order("full_name", { ascending: true })
    .limit(500);

  if (scope.kind === "scoped") {
    // `resolveEmployeeScope()` guarantees `ids` contains at
    // least the caller themselves, so `.in("id", ids)` never
    // hits the supabase-js empty-array-treats-as-no-filter
    // footgun documented in `resolveProjectScope`.
    query = query.in("id", scope.ids);
  }

  const { data, error } = await query;

  if (error) {
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    full_name: row.full_name,
    first_name: row.first_name,
    last_name: row.last_name,
    email: row.email,
    phone: row.phone,
    // Decrypt only when the caller's role has passed `canReadSensitive`.
    // A malformed / stale ciphertext (post-rotation) throws — we swallow
    // to `null` so the list keeps rendering; the affected row will show
    // a blank NIK, and re-saving the row through the Edit sheet re-encrypts
    // with the current master key.
    nik: canDecryptPii ? safeDecryptNik(row.nik_enc) : null,
    division: row.division,
    department: row.department,
    position_title: row.position_title,
    client_display_name: row.client_display_name,
    role: row.role as EmployeeRoleEnum,
    date_of_birth: row.date_of_birth,
    join_date: row.join_date,
    employment_type: row.employment_type as EmploymentType,
    contract_end_date: row.contract_end_date,
    availability: row.availability as EmployeeAvailability,
    reports_to_employee_id: row.reports_to_employee_id,
  }));
}

/**
 * Wrap `decryptEmployeePii()` so a bad ciphertext (e.g. post-rotation)
 * doesn't take down the whole employee list render. We can't recover
 * the plaintext but we can at least keep the rest of the page usable.
 * A future audit sweep should flag rows returning `null` here so HR
 * can re-enter the NIK.
 */
function safeDecryptNik(nikEnc: string | null): string | null {
  if (!nikEnc) return null;
  try {
    return decryptEmployeePii(nikEnc);
  } catch {
    return null;
  }
}

export default async function EmployeesPage() {
  // Fetch the employee first — page-guard must run before any of
  // the concurrent data loaders, otherwise a denied role still
  // pays for the directory query round-trip and (worse) can time
  // the tenant size via response latency.
  const employee = await requireCurrentEmployee();
  const dbRole = employee.role as AnyDbEmployeeRole;

  // Rules §3 — plain EMPLOYEE and PETTY_CASH_CUSTODIAN have no
  // reason to browse the org chart. `notFound()` (not 403) so
  // the URL stays undiscoverable — same pattern as the finance /
  // payroll / contracts guards. `view_employee_directory`
  // consults the tenant-aware capability set, so an admin can
  // legitimately grant Supervisor visibility via
  // `/settings/capabilities` without redeploying.
  const capabilities = await resolveCapabilitiesFor();
  if (!capabilities.can("view_employee_directory")) {
    notFound();
  }

  const [
    rows,
    t,
    tCols,
    tType,
    tAvail,
    departmentOptions,
    positionOptions,
  ] = await Promise.all([
    loadEmployees({ id: employee.id, role: dbRole }),
    getTranslations("employees"),
    getTranslations("employees.columns"),
    getTranslations("employees.employmentType"),
    getTranslations("employees.availability"),
    loadLookupOptions("department"),
    loadLookupOptions("position"),
  ]);

  const canCreate =
    authorize({
      actor: {
        userId: employee.user_id,
        employeeId: employee.id,
        role: employee.role as EmployeeRole,
        tenantId: employee.tenant_id,
      },
      action: "create",
      resource: "employee",
      attributes: { tenantId: employee.tenant_id },
    }).effect === "ALLOW";

  // `employee:update` PDP is per-row (owner attribute), but every row
  // in this list has the same tenant scope and the same set of roles
  // are gated, so a single guard-hit here is a safe proxy for "any of
  // these rows is editable by the caller". We still pass the actor
  // into the wrapper action, which re-decides on the exact row.
  const canEdit =
    authorize({
      actor: {
        userId: employee.user_id,
        employeeId: employee.id,
        role: employee.role as EmployeeRole,
        tenantId: employee.tenant_id,
      },
      action: "update",
      resource: "employee",
      attributes: { tenantId: employee.tenant_id },
    }).effect === "ALLOW";

  const departmentLabels = departmentOptions.map((o) => o.label);
  const positionLabels = positionOptions.map((o) => o.label);
  const managerOptions = rows.map((row) => ({
    id: row.id,
    full_name: row.full_name,
    role: row.role,
  }));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t("subtitle")}
          </p>
        </div>
        {canCreate ? (
          <EmployeeUpsertSheet
            departmentOptions={departmentLabels}
            positionOptions={positionLabels}
            /* All directory rows are viable "reports_to" candidates —
               there is intentionally NO role-level restriction here, so
               tenants can model both flat teams (everyone reports to
               Admin) and deep hierarchies (Employee → Supervisor → PM
               → OM). The Zod schema still validates the referenced UUID
               exists at commit time via the FK constraint. */
            managerOptions={managerOptions}
          />
        ) : null}
      </header>

      {rows.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Users2 className="size-6" />
            </div>
            <CardTitle className="font-display text-xl">
              {t("empty")}
            </CardTitle>
            <CardDescription className="max-w-md text-center">
              {t("emptyBody")}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card className="glass overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <ColHead>{tCols("employee")}</ColHead>
                    <ColHead>{tCols("department")}</ColHead>
                    <ColHead>{tCols("position")}</ColHead>
                    <ColHead>{tCols("employment")}</ColHead>
                    <ColHead>{tCols("joinDate")}</ColHead>
                    <ColHead>{tCols("endDate")}</ColHead>
                    <ColHead>{tCols("availability")}</ColHead>
                    {canEdit ? (
                      <ColHead className="w-16 text-right">
                        <span className="sr-only">{tCols("actions")}</span>
                      </ColHead>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const daysLeft = daysUntil(r.contract_end_date);
                    const showAlert =
                      r.employment_type !== "PERMANENT" &&
                      daysLeft !== null &&
                      daysLeft <= 30 &&
                      daysLeft >= 0;
                    const showExpired =
                      r.contract_end_date !== null &&
                      daysLeft !== null &&
                      daysLeft < 0;

                    return (
                      <tr
                        key={r.id}
                        className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="font-medium">{r.full_name}</span>
                            <span className="text-xs text-muted-foreground">
                              {r.email}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {r.department ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {r.position_title ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={EMPLOYMENT_TYPE_TONE[r.employment_type]}
                          >
                            {tType(r.employment_type)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs tabular-nums">
                          {formatDateOnly(r.join_date)}
                        </td>
                        <td className="px-4 py-3 text-xs tabular-nums">
                          {r.contract_end_date ? (
                            <div className="flex flex-col gap-0.5">
                              <span
                                className={
                                  showExpired
                                    ? "text-rose-500 font-medium"
                                    : showAlert
                                    ? "text-amber-500 font-medium"
                                    : "text-muted-foreground"
                                }
                              >
                                {formatDateOnly(r.contract_end_date)}
                              </span>
                              {showAlert ? (
                                <span className="text-[10px] text-amber-500">
                                  {t("expiresIn", { days: daysLeft ?? 0 })}
                                </span>
                              ) : showExpired ? (
                                <span className="text-[10px] text-rose-500">
                                  {t("expired")}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={AVAILABILITY_TONE[r.availability]}
                          >
                            {tAvail(r.availability)}
                          </Badge>
                        </td>
                        {canEdit ? (
                          <td className="px-4 py-3 text-right">
                            <EmployeeRowActions
                              row={toExistingEmployee(r)}
                              departmentOptions={departmentLabels}
                              positionOptions={positionLabels}
                              managerOptions={managerOptions}
                            />
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ColHead({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`label-meta px-4 py-3 text-xs font-medium text-muted-foreground ${className ?? ""}`}
    >
      {children}
    </th>
  );
}
