import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeDollarSign, ListChecks } from "lucide-react";
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
import { formatDateOnly } from "@/lib/format/date";
import { requireCurrentEmployee } from "@/lib/auth/session";
import {
  PERFORMANCE_VIEWER_ROLES,
  roleInGate,
  type EmployeeRole,
} from "@/lib/rbac/roles";
import { createClient } from "@/lib/supabase/server";
import type {
  ContractRecommendation,
  EvaluationStatus,
} from "@/lib/validation/evaluation";

import { NewEvaluationSheet } from "./new-evaluation-sheet";

export const metadata: Metadata = { title: "Performance evaluations" };

const STATUS_TONE: Record<EvaluationStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground border-border",
  SUBMITTED_BY_SPV: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30",
  REVIEWED_BY_PM: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30",
  RETURNED_TO_SPV: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  APPROVED_BY_OM: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  REJECTED_BY_OM: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  FINALIZED: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
};

export default async function PerformanceEvaluationsPage() {
  const employee = await requireCurrentEmployee();

  // RLS filters rows to HR/Mgmt OR "I am SPV/PM/OM of this row" —
  // EMPLOYEE without those relationships would land on an empty page.
  // Redirect them to the dashboard for a clearer signal.
  if (!roleInGate(employee.role, PERFORMANCE_VIEWER_ROLES)) {
    redirect("/dashboard?error=forbidden");
  }

  const [t, tStatus, tRec] = await Promise.all([
    getTranslations("performance"),
    getTranslations("performance.status"),
    getTranslations("performance.recommendation"),
  ]);
  const supabase = await createClient();

  // Fetch every visible row — RLS filters to (SPV/PM/OM I own) OR
  // HR/Mgmt broad view (see migration 0059). Left-join for context.
  const { data: rows } = await supabase
    .from("performance_evaluations")
    .select(
      "id, status, contract_end_date, total_score, spv_recommendation, submitted_at, updated_at, employee:employee_id(id, full_name), template:template_id(id, name)",
    )
    .order("updated_at", { ascending: false })
    .limit(200);

  // Fetch employees eligible for new evaluations (non-permanent + has
  // contract_end_date). Reused by the sheet. Small set — cheap.
  const { data: empRaw } = await supabase
    .from("employees")
    .select("id, full_name, employment_type, contract_end_date")
    .eq("tenant_id", employee.tenant_id)
    .neq("employment_type", "PERMANENT")
    .not("contract_end_date", "is", null)
    .eq("is_active", true)
    .order("contract_end_date", { ascending: true })
    .limit(500);

  const { data: tplRaw } = await supabase
    .from("evaluation_templates")
    .select("id, name")
    .eq("tenant_id", employee.tenant_id)
    .eq("is_active", true)
    .order("name", { ascending: true });

  type Row = {
    id: string;
    status: EvaluationStatus;
    contract_end_date: string;
    total_score: string | null;
    spv_recommendation: ContractRecommendation | null;
    submitted_at: string | null;
    updated_at: string;
    employee: { id: string; full_name: string } | null;
    template: { id: string; name: string } | null;
  };
  const list = (rows ?? []) as unknown as Row[];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <BadgeDollarSign className="size-6" />
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
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            render={<Link href="/hr/performance/templates" />}
          >
            <ListChecks className="size-4" />
            {t("templates.title")}
          </Button>
          <NewEvaluationSheet
            employees={(empRaw ?? []).map((e) => ({
              id: e.id,
              full_name: e.full_name,
              employment_type: e.employment_type,
              contract_end_date: e.contract_end_date as string,
            }))}
            templates={(tplRaw ?? []).map((t) => ({ id: t.id, name: t.name }))}
          />
        </div>
      </header>

      <Card className="glass">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <div className="text-sm text-muted-foreground border rounded-lg p-6 text-center">
              <p className="font-medium">{t("empty")}</p>
              <p>{t("emptyBody")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="py-2 pr-3">{t("columns.employee")}</th>
                    <th className="py-2 pr-3">{t("columns.contractEnd")}</th>
                    <th className="py-2 pr-3">{t("columns.template")}</th>
                    <th className="py-2 pr-3">{t("columns.status")}</th>
                    <th className="py-2 pr-3">{t("columns.recommendation")}</th>
                    <th className="py-2 pr-3">{t("columns.score")}</th>
                    <th className="py-2 pr-3">{t("columns.updatedAt")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="py-2 pr-3">
                        <Link
                          href={`/hr/performance/${r.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {r.employee?.full_name ?? "—"}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        {formatDateOnly(r.contract_end_date)}
                      </td>
                      <td className="py-2 pr-3">{r.template?.name ?? "—"}</td>
                      <td className="py-2 pr-3">
                        <Badge
                          variant="outline"
                          className={STATUS_TONE[r.status]}
                        >
                          {tStatus(r.status)}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {r.spv_recommendation
                          ? tRec(r.spv_recommendation)
                          : "—"}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {r.total_score
                          ? Number(r.total_score).toFixed(1)
                          : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {formatDateOnly(r.updated_at)}
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
