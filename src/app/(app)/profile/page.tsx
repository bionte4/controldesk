import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ArrowRight,
  Briefcase,
  Building2,
  CalendarDays,
  ClipboardList,
  Clock,
  KeyRound,
  Mail,
  Phone,
  Sparkles,
  UserCircle,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateOnly, formatInTz } from "@/lib/format/date";
import { formatRole } from "@/lib/rbac/roles";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";
import type { Locale } from "@/lib/i18n/config";

import { ChangePasswordCard } from "./change-password-card";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "My profile" };

type AssignmentRow = {
  id: string;
  allocation_percentage: number;
  status: string;
  started_at: string;
  role: string | null;
  project: {
    id: string;
    name: string;
    code: string | null;
    project_number: string | null;
    status: string | null;
  } | null;
};

type TimesheetSummaryRow = {
  hours_worked: number;
  hours_overtime: number;
  status: string;
};

function initialsOf(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Return the first day of the current month in Asia/Jakarta as an ISO date
 * string (yyyy-MM-01). Timesheet `work_date` is a `date` column so we compare
 * on the tenant-local calendar, not UTC.
 */
function monthStartIsoJakarta(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}-01`;
}

export default async function ProfilePage() {
  const [employee, t] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("profile"),
  ]);
  const supabase = await createClient();

  const monthStart = monthStartIsoJakarta();

  const [
    { data: assignmentsRaw },
    { data: timesheetsRaw },
    { data: reportsToRaw },
  ] = await Promise.all([
    supabase
      .from("project_employee_assignments")
      .select(
        "id, allocation_percentage, status, started_at, role, project:projects(id, name, code, project_number, status)",
      )
      .eq("employee_id", employee.id)
      .eq("tenant_id", employee.tenant_id)
      .eq("status", "ACTIVE")
      .order("allocation_percentage", { ascending: false }),
    supabase
      .from("timesheets")
      .select("hours_worked, hours_overtime, status")
      .eq("employee_id", employee.id)
      .eq("tenant_id", employee.tenant_id)
      .gte("work_date", monthStart),
    employee.reports_to_employee_id
      ? supabase
          .from("employees")
          .select("id, full_name, role")
          .eq("id", employee.reports_to_employee_id)
          .eq("tenant_id", employee.tenant_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const assignments = (assignmentsRaw ?? []) as unknown as AssignmentRow[];
  const timesheets = (timesheetsRaw ?? []) as unknown as TimesheetSummaryRow[];
  const reportsTo = reportsToRaw as unknown as {
    id: string;
    full_name: string;
    role: string;
  } | null;

  const totalAllocation = assignments.reduce(
    (sum, a) => sum + (a.allocation_percentage ?? 0),
    0,
  );

  const monthHoursWorked = timesheets.reduce(
    (sum, ts) => sum + Number(ts.hours_worked ?? 0),
    0,
  );
  const monthHoursOvertime = timesheets.reduce(
    (sum, ts) => sum + Number(ts.hours_overtime ?? 0),
    0,
  );
  const monthApproved = timesheets.filter((t) => t.status === "APPROVED").length;
  const monthEntries = timesheets.length;

  const fullName = employee.full_name;
  const initials = initialsOf(fullName);
  const roleLabel = formatRole(employee.role as AnyDbEmployeeRole);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Avatar className="size-16">
            <AvatarFallback className="bg-primary/15 text-primary text-lg font-semibold">
              {initials || "?"}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="label-meta">{t("kicker")}</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {fullName}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">{roleLabel}</Badge>
              {employee.department ? (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="size-3.5" />
                  {employee.department}
                </span>
              ) : null}
              {employee.position_title ? (
                <>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1">
                    <Briefcase className="size-3.5" />
                    {employee.position_title}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left column: editable form + password */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCircle className="size-4" /> {t("form.title")}
              </CardTitle>
              <CardDescription>{t("form.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileForm
                initial={{
                  first_name: employee.first_name ?? fullName.split(" ")[0] ?? "",
                  last_name: employee.last_name ?? undefined,
                  phone: employee.phone ?? undefined,
                  date_of_birth: employee.date_of_birth ?? undefined,
                  preferred_locale:
                    (employee.preferred_locale as Locale | null) ?? undefined,
                }}
              />
            </CardContent>
          </Card>

          <Card className="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-4" /> {t("password.title")}
              </CardTitle>
              <CardDescription>{t("password.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <ChangePasswordCard />
            </CardContent>
          </Card>
        </div>

        {/* Right column: HR-managed read-only + project + timesheet summary */}
        <div className="flex flex-col gap-4">
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">{t("directory.title")}</CardTitle>
              <CardDescription>{t("directory.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ReadOnlyField
                icon={<Mail className="size-3.5" />}
                label={t("directory.email")}
                value={employee.email}
              />
              <ReadOnlyField
                icon={<Phone className="size-3.5" />}
                label={t("directory.phone")}
                value={employee.phone ?? "—"}
              />
              <Separator />
              <ReadOnlyField
                label={t("directory.role")}
                value={roleLabel}
              />
              <ReadOnlyField
                label={t("directory.department")}
                value={employee.department ?? "—"}
              />
              <ReadOnlyField
                label={t("directory.positionTitle")}
                value={employee.position_title ?? "—"}
              />
              <ReadOnlyField
                label={t("directory.employmentType")}
                value={employee.employment_type ?? "—"}
              />
              <Separator />
              <ReadOnlyField
                icon={<CalendarDays className="size-3.5" />}
                label={t("directory.joinDate")}
                value={formatDateOnly(employee.join_date)}
              />
              {employee.contract_end_date ? (
                <ReadOnlyField
                  icon={<CalendarDays className="size-3.5" />}
                  label={t("directory.contractEnd")}
                  value={formatDateOnly(employee.contract_end_date)}
                />
              ) : null}
              {reportsTo ? (
                <ReadOnlyField
                  label={t("directory.reportsTo")}
                  value={`${reportsTo.full_name} · ${formatRole(reportsTo.role as AnyDbEmployeeRole)}`}
                />
              ) : null}
              <p className="pt-2 text-xs text-muted-foreground">
                {t("directory.hrOnly")}
              </p>
            </CardContent>
          </Card>

          <Card className="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="size-4" />
                {t("assignments.title")}
              </CardTitle>
              <CardDescription>
                {t("assignments.total", { pct: totalAllocation })}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {assignments.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  {t("assignments.empty")}
                </p>
              ) : (
                <ul className="divide-y divide-border/50">
                  {assignments.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        {a.project ? (
                          <Link
                            href={`/projects/${a.project.id}`}
                            className="font-medium hover:underline"
                          >
                            {a.project.project_number ?? a.project.code ?? "—"}
                            {" — "}
                            <span className="text-foreground">
                              {a.project.name}
                            </span>
                          </Link>
                        ) : (
                          <p className="font-medium text-muted-foreground">—</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {a.role ?? "MEMBER"} ·{" "}
                          {t("assignments.since", {
                            date: formatDateOnly(a.started_at),
                          })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-20">
                          <Progress
                            value={Math.min(100, a.allocation_percentage)}
                          />
                        </div>
                        <span className="w-10 text-right tabular-nums text-xs">
                          {a.allocation_percentage}%
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="size-4" />
                {t("timesheet.title")}
              </CardTitle>
              <CardDescription>
                {t("timesheet.subtitle", {
                  month: formatInTz(new Date(), "MMMM yyyy"),
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <SummaryStat
                label={t("timesheet.hoursWorked")}
                value={monthHoursWorked.toFixed(2)}
              />
              <SummaryStat
                label={t("timesheet.hoursOvertime")}
                value={monthHoursOvertime.toFixed(2)}
              />
              <SummaryStat
                label={t("timesheet.entries")}
                value={String(monthEntries)}
              />
              <SummaryStat
                label={t("timesheet.approved")}
                value={String(monthApproved)}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      {/*
       * CTA linking to /settings/preferences (personal preferences hub).
       * Kept as a thin card here so users who navigate to /profile still
       * discover where notification / telegram / whatsapp / appearance
       * toggles moved. The actual state lives at `/settings/preferences`.
       */}
      <Link
        href="/settings/preferences"
        className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        <Card className="glass transition-shadow group-hover:shadow-md">
          <CardContent className="flex items-start gap-4 p-5">
            <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-5" aria-hidden />
            </div>
            <div className="flex-1">
              <div className="font-medium">{t("preferencesCta.title")}</div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("preferencesCta.description")}
              </p>
            </div>
            <ArrowRight
              className="mt-2 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}

function ReadOnlyField({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-right text-sm">{value}</span>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/40 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-lg font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}
