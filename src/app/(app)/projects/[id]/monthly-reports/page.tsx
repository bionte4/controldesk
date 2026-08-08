import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { formatDateOnly } from "@/lib/format/date";
import { createClient } from "@/lib/supabase/server";

import { NewMonthlyReportSheet } from "./new-monthly-report-sheet";

export const metadata: Metadata = { title: "Monthly reports" };

/**
 * List of monthly reports for a project. Entry point from the
 * project detail page (rules §26).
 */
export default async function ProjectMonthlyReportsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = await params;
  const [employee, t, tStatus] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("monthlyReport"),
    getTranslations("monthlyReport.status"),
  ]);
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, code, name")
    .eq("id", projectId)
    .eq("tenant_id", employee.tenant_id)
    .maybeSingle();
  if (!project) notFound();

  const { data: rows } = await supabase
    .from("monthly_reports")
    .select(
      "id, period_month, status, submitted_at, pm_decided_at, updated_at, submitter:submitter_employee_id(full_name)",
    )
    .eq("project_id", projectId)
    .eq("tenant_id", employee.tenant_id)
    .order("period_month", { ascending: false });

  type Row = {
    id: string;
    period_month: string;
    status: string;
    submitted_at: string | null;
    pm_decided_at: string | null;
    updated_at: string;
    submitter: { full_name: string } | null;
  };
  const reports = (rows ?? []) as unknown as Row[];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          size="sm"
          variant="ghost"
          render={<Link href={`/projects/${projectId}`} />}
        >
          <ArrowLeft className="size-4" />
          {project.code} · {project.name}
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <CalendarClock className="size-6" />
          </div>
          <div>
            <p className="label-meta">{t("kicker")}</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              {t("subtitle")}
            </p>
          </div>
        </div>
        <NewMonthlyReportSheet projectId={projectId} />
      </header>

      <Card className="glass">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <div className="text-sm text-muted-foreground border rounded-lg p-6 text-center">
              <p className="font-medium">{t("empty")}</p>
              <p>{t("emptyBody")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="py-2 pr-3">{t("columns.period")}</th>
                    <th className="py-2 pr-3">{t("columns.submitter")}</th>
                    <th className="py-2 pr-3">{t("columns.status")}</th>
                    <th className="py-2 pr-3">{t("columns.submittedAt")}</th>
                    <th className="py-2 pr-3">{t("columns.decidedAt")}</th>
                    <th className="py-2 pr-3">{t("columns.updatedAt")}</th>
                    <th className="py-2 pr-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {reports.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="py-2 pr-3 font-medium">
                        {r.period_month.slice(0, 7)}
                      </td>
                      <td className="py-2 pr-3">
                        {r.submitter?.full_name ?? "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline">
                          {tStatus(
                            r.status as Parameters<typeof tStatus>[0],
                          )}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {r.submitted_at ? formatDateOnly(r.submitted_at) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {r.pm_decided_at
                          ? formatDateOnly(r.pm_decided_at)
                          : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {formatDateOnly(r.updated_at)}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          render={
                            <Link
                              href={`/projects/${projectId}/monthly-reports/${r.id}`}
                            />
                          }
                        >
                          Open
                        </Button>
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
