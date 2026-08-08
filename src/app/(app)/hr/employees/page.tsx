import type { Metadata } from "next";
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
import type { EmployeeRole } from "@/lib/rbac/roles";
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

import { NewEmployeeSheet } from "./new-employee-sheet";

export const metadata: Metadata = {
  title: "Employees",
};

type EmployeeRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  department: string | null;
  position_title: string | null;
  role: EmployeeRoleEnum;
  join_date: string;
  employment_type: EmploymentType;
  contract_end_date: string | null;
  availability: EmployeeAvailability;
};

const MS_PER_DAY = 86_400_000;

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00Z`).getTime();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diff = Math.round((target - today.getTime()) / MS_PER_DAY);
  return diff;
}

async function loadEmployees(): Promise<EmployeeRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("employees")
    .select(
      "id, full_name, email, phone, department, position_title, role, join_date, employment_type, contract_end_date, availability",
    )
    .order("full_name", { ascending: true })
    .limit(500);

  if (error) {
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    department: row.department,
    position_title: row.position_title,
    role: row.role as EmployeeRoleEnum,
    join_date: row.join_date,
    employment_type: row.employment_type as EmploymentType,
    contract_end_date: row.contract_end_date,
    availability: row.availability as EmployeeAvailability,
  }));
}

export default async function EmployeesPage() {
  const [
    employee,
    rows,
    t,
    tCols,
    tType,
    tAvail,
    departmentOptions,
    positionOptions,
  ] = await Promise.all([
    requireCurrentEmployee(),
    loadEmployees(),
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
          <NewEmployeeSheet
            departmentOptions={departmentOptions.map((o) => o.label)}
            positionOptions={positionOptions.map((o) => o.label)}
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
