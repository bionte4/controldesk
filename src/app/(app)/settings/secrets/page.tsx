import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, KeyRound, ShieldCheck, TriangleAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatInTz } from "@/lib/format/date";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  computeAll,
  summarize,
  type SecretRotationRow,
} from "@/lib/security/rotation";
import type {
  SecretPriority,
  SecretRotationSeverity,
} from "@/types/database";
import type { EmployeeRole } from "@/lib/rbac/roles";

import { MarkRotatedButton } from "./mark-rotated-button";

export const metadata: Metadata = { title: "Secret Rotation" };

const READ_ROLES: readonly EmployeeRole[] = ["TENANT_ADMIN", "GENERAL_MANAGER"];

function isReadRole(role: string): boolean {
  return (READ_ROLES as readonly string[]).includes(role);
}

const SEVERITY_TONE: Record<SecretRotationSeverity, string> = {
  OK: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  WARN: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  OVERDUE: "border-rose-400/30 bg-rose-500/10 text-rose-300",
};

const PRIORITY_TONE: Record<SecretPriority, string> = {
  P0: "border-rose-400/30 bg-rose-500/10 text-rose-200",
  P1: "border-amber-400/30 bg-amber-500/10 text-amber-200",
  P2: "border-slate-400/30 bg-slate-500/10 text-slate-200",
};

async function loadSecrets(): Promise<SecretRotationRow[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("secret_rotations")
    .select(
      "name, priority, purpose, last_rotated_at, rotation_interval_days, last_rotated_by, notes",
    );
  if (error || !data) return [];
  return data as SecretRotationRow[];
}

export default async function SecretRotationPage() {
  const employee = await requireCurrentEmployee();
  if (!isReadRole(employee.role)) notFound();

  const [rows, t] = await Promise.all([
    loadSecrets(),
    getTranslations("settings.secrets"),
  ]);

  const canMark = employee.role === "TENANT_ADMIN";
  const computed = computeAll(rows);
  const summary = summarize(computed);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href="/dashboard"
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> {t("back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="label-meta">{t("kicker")}</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {t("description")}
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          label={t("summary.overdue")}
          value={summary.overdue}
          tone="border-rose-400/30 bg-rose-500/10 text-rose-300"
          icon={<TriangleAlert className="size-4" />}
        />
        <SummaryCard
          label={t("summary.warn")}
          value={summary.warn}
          tone="border-amber-400/30 bg-amber-500/10 text-amber-300"
          icon={<KeyRound className="size-4" />}
        />
        <SummaryCard
          label={t("summary.ok")}
          value={summary.ok}
          tone="border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
          icon={<ShieldCheck className="size-4" />}
        />
      </div>

      <Card className="glass">
        <CardHeader>
          <CardTitle>{t("registryTitle")}</CardTitle>
          <CardDescription>
            {t("registryDescription", { count: computed.length })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {computed.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
              {t("empty")}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/50">
              <table
                aria-label={t("tableAriaLabel")}
                className="w-full text-left text-sm"
              >
                <caption className="sr-only">{t("tableAriaLabel")}</caption>
                <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="p-3">{t("colName")}</th>
                    <th scope="col" className="p-3">{t("colPriority")}</th>
                    <th scope="col" className="p-3">{t("colSeverity")}</th>
                    <th scope="col" className="p-3">{t("colDaysUntil")}</th>
                    <th scope="col" className="p-3">{t("colRotatedAt")}</th>
                    <th scope="col" className="p-3 text-right">
                      {t("colActions")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {computed.map((r) => (
                    <tr
                      key={r.name}
                      className="border-t border-border/40 align-top"
                    >
                      <td className="p-3">
                        <div className="font-mono text-xs font-semibold">
                          {r.name}
                        </div>
                        <p className="mt-1 max-w-md text-xs text-muted-foreground">
                          {r.purpose}
                        </p>
                        {r.notes ? (
                          <p className="mt-1 max-w-md text-[11px] text-muted-foreground/80 italic">
                            {r.notes}
                          </p>
                        ) : null}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={PRIORITY_TONE[r.priority]}
                        >
                          {r.priority}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={SEVERITY_TONE[r.severity]}
                        >
                          {r.severity}
                        </Badge>
                      </td>
                      <td className="p-3 tabular-nums">
                        {r.severity === "OVERDUE" ? (
                          <span className="text-rose-300">
                            {t("daysOverdue", {
                              count: Math.abs(r.days_until_due),
                            })}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {t("daysLeft", { count: r.days_until_due })}
                          </span>
                        )}
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {t("interval", {
                            days: r.rotation_interval_days,
                          })}
                        </p>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {formatInTz(r.last_rotated_at, "dd MMM yyyy HH:mm")}
                        <p className="mt-0.5 text-[11px]">
                          {t("agoDays", { count: r.days_since_rotation })}
                        </p>
                      </td>
                      <td className="p-3 text-right">
                        {canMark ? <MarkRotatedButton name={r.name} /> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className={`glass ${tone}`}>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="label-meta">{label}</p>
          <p className="font-display text-3xl font-semibold tabular-nums">
            {value}
          </p>
        </div>
        <div className="rounded-full bg-black/20 p-2">{icon}</div>
      </CardContent>
    </Card>
  );
}
