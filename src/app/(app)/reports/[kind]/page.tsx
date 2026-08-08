import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

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
import type { EmployeeRole } from "@/lib/rbac/roles";
import {
  REPORT_REGISTRY,
  isValidReportKind,
} from "@/lib/reports/registry";
import { runReport } from "@/lib/reports/runner";
import { createClient } from "@/lib/supabase/server";

import { ReportFilterPanel } from "./filter-panel";
import { ReportPreview } from "../report-preview";

export const metadata: Metadata = { title: "Report" };

/**
 * `/reports/<kind>` — filter form + optional preview. The preview is
 * only rendered when `?preview=1` is in the URL so that (a) the
 * initial page load is cheap (b) exports don't accidentally run an
 * on-screen preview (c) the URL is shareable with filter state.
 */
export default async function ReportKindPage(props: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { kind } = await props.params;
  const search = await props.searchParams;

  if (!isValidReportKind(kind)) notFound();
  const meta = REPORT_REGISTRY[kind];

  const employee = await requireCurrentEmployee();
  const dbRole = employee.role as EmployeeRole;
  if (!meta.allowedRoles.includes(dbRole)) {
    redirect("/reports?error=forbidden");
  }

  const [tList, tScope] = await Promise.all([
    getTranslations("reports.list"),
    getTranslations("reports"),
  ]);

  // Compute filter defaults based on the report's declared date preset.
  const today = new Date();
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const startCurrentMonth = new Date(Date.UTC(y, m, 1));
  const endCurrentMonth = new Date(Date.UTC(y, m + 1, 0));
  const start90 = new Date(Date.UTC(y, m, today.getUTCDate() - 90));
  const startFy = new Date(Date.UTC(y, 0, 1));
  const endFy = new Date(Date.UTC(y, 11, 31));

  const defaults = {
    from: (meta.defaultDateRange === "currentMonth"
      ? startCurrentMonth
      : meta.defaultDateRange === "last90Days"
        ? start90
        : startFy
    )
      .toISOString()
      .slice(0, 10),
    to: (meta.defaultDateRange === "currentMonth"
      ? endCurrentMonth
      : meta.defaultDateRange === "currentFiscalYear"
        ? endFy
        : today
    )
      .toISOString()
      .slice(0, 10),
    fiscalYear: y,
  };

  // Load project + fund options for the filter form. Both queries are
  // tenant-scoped and cheap; keeping them out of the client bundle
  // avoids leaking the full project list to unauthorized roles.
  const supabase = await createClient();
  const { data: projectRows } = await supabase
    .from("projects")
    .select("id, name, code, project_number")
    .eq("tenant_id", employee.tenant_id)
    .order("updated_at", { ascending: false })
    .limit(200);
  const projects = (projectRows ?? []).map((p) => ({
    id: p.id,
    label: `${p.project_number ?? p.code} · ${p.name}`,
  }));

  const { data: fundRows } = meta.filters.includes("fund")
    ? await supabase
        .from("petty_cash_funds")
        .select("id, location_name")
        .eq("tenant_id", employee.tenant_id)
        .order("location_name", { ascending: true })
    : { data: [] as { id: string; location_name: string }[] };
  const funds = (fundRows ?? []).map((f) => ({
    id: f.id,
    label: f.location_name,
  }));

  // Preview is opt-in. Reading `preview=1` from the URL keeps report
  // load cheap when the user is only tweaking filters.
  const wantPreview = search?.preview === "1";
  const previewFilters = {
    from: typeof search.from === "string" ? search.from : defaults.from,
    to: typeof search.to === "string" ? search.to : defaults.to,
    projectIds:
      typeof search.projectId === "string"
        ? [search.projectId]
        : Array.isArray(search.projectId)
          ? search.projectId
          : undefined,
    fiscalYear:
      typeof search.fiscalYear === "string"
        ? Number(search.fiscalYear)
        : defaults.fiscalYear,
    fundId: typeof search.fundId === "string" ? search.fundId : null,
    expenseStatus:
      typeof search.expenseStatus === "string" ? search.expenseStatus : null,
    caStatus: typeof search.caStatus === "string" ? search.caStatus : null,
    brKind:
      search.brKind === "INCREASE" ||
      search.brKind === "DECREASE" ||
      search.brKind === "TRANSFER"
        ? (search.brKind as "INCREASE" | "DECREASE" | "TRANSFER")
        : null,
  };

  const preview = wantPreview
    ? await runReport(kind, previewFilters, "preview").catch((e) => {
        return {
          error: e instanceof Error ? e.message : String(e),
        };
      })
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button size="sm" variant="ghost" render={<Link href="/reports" />}>
          <ArrowLeft className="size-4" />
          {tScope("back")}
        </Button>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-meta">{tScope("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {/*
              next-intl types insist on literal keys, but the report
              registry stores them as free-form strings by design (one
              source of truth across UI + audit + query modules). The
              runtime translator accepts any dotted key that exists in
              `messages/*.json`, so we cast rather than duplicate the
              key union.
            */}
            {tList(meta.titleKey as never)}
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {tList(meta.descriptionKey as never)}
          </p>
        </div>
        <Badge variant="outline" className="text-xs">
          {kind}
        </Badge>
      </header>

      <Card className="glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{tScope("parametersTitle")}</CardTitle>
          <CardDescription>{tScope("parametersHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ReportFilterPanel
            kind={kind}
            filters={meta.filters}
            defaults={defaults}
            projects={projects}
            funds={funds}
          />
        </CardContent>
      </Card>

      {wantPreview ? (
        <Card className="glass">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{tScope("previewTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {preview && "error" in preview ? (
              <p className="text-sm text-rose-600">{preview.error}</p>
            ) : preview ? (
              <ReportPreview result={preview} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {tScope("previewEmpty")}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
