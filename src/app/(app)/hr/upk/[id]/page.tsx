import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
import { formatIDR, parseMoneyFromDb } from "@/lib/format/money";
import { resolveCapabilitiesFor } from "@/lib/rbac/capability-resolver";
import { toCanonicalRole } from "@/lib/rbac/roles";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { UpkStatus } from "@/lib/validation/upk";

import { UpkActionsPanel } from "./actions-panel";
import { EditUpkNoteSheet } from "./edit-upk-sheet";

export const metadata: Metadata = { title: "UPK detail" };

const STATUS_TONE: Record<UpkStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground border-border",
  PENDING_FINANCE: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30",
  PENDING_DIRECTOR: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30",
  APPROVED: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  REJECTED_BY_FINANCE: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  REJECTED_BY_DIRECTOR: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  PAID: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

export default async function UpkDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const employee = await requireCurrentEmployee();
  const capabilities = await resolveCapabilitiesFor();
  if (!capabilities.can("view_upk")) {
    redirect("/dashboard?error=forbidden");
  }
  const [t, tStatus] = await Promise.all([
    getTranslations("upk"),
    getTranslations("upk.status"),
  ]);
  const supabase = await createClient();

  const { data: rowRaw } = await supabase
    .from("upk_notes")
    .select(
      "*, employee:employee_id(id, full_name), drafter:drafted_by(id, full_name), finance:finance_approved_by(id, full_name), director:director_approved_by(id, full_name), payer:paid_by(id, full_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!rowRaw) notFound();

  const row = rowRaw as unknown as {
    id: string;
    status: UpkStatus;
    employee: { id: string; full_name: string } | null;
    contract_end_date: string;
    service_months: number;
    base_salary: string;
    multiplier: string;
    computed_upk: string;
    justification: string | null;
    drafted_by: string | null;
    drafter: { id: string; full_name: string } | null;
    submitted_at: string | null;
    finance_approved_at: string | null;
    finance: { id: string; full_name: string } | null;
    director_approved_at: string | null;
    director: { id: string; full_name: string } | null;
    paid_at: string | null;
    paid_reference: string | null;
    payer: { id: string; full_name: string } | null;
  };

  const canonical = toCanonicalRole(employee.role);
  const isDrafter = row.drafted_by === employee.id;
  const isFinance = canonical === "FINANCE" || canonical === "ADMIN";
  const isDirector = canonical === "DIRECTOR" || canonical === "ADMIN";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button size="sm" variant="ghost" render={<Link href="/hr/upk" />}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {row.employee?.full_name ?? "—"}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline" className={STATUS_TONE[row.status]}>
              {tStatus(row.status)}
            </Badge>
            <span>· contract ends {formatDateOnly(row.contract_end_date)}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 text-right">
          <p className="text-xs text-muted-foreground">{t("form.computed")}</p>
          <p className="font-display text-3xl font-semibold tabular-nums">
            {formatIDR(parseMoneyFromDb(row.computed_upk))}
          </p>
          {isDrafter && row.status === "DRAFT" ? (
            <EditUpkNoteSheet
              upk={{
                id: row.id,
                contract_end_date: row.contract_end_date,
                service_months: row.service_months,
                base_salary_db: row.base_salary,
                multiplier: row.multiplier,
                justification: row.justification,
              }}
            />
          ) : null}
        </div>
      </header>

      <Card className="glass">
        <CardHeader>
          <CardTitle>Calculation</CardTitle>
          <CardDescription>
            base × multiplier × (service_months / 12)
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t("form.baseSalary")}</p>
            <p className="tabular-nums font-medium">
              {formatIDR(parseMoneyFromDb(row.base_salary))}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("form.serviceMonths")}</p>
            <p className="tabular-nums font-medium">{row.service_months} mo</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("form.multiplier")}</p>
            <p className="tabular-nums font-medium">{Number(row.multiplier).toFixed(2)}×</p>
          </div>
          <div className="md:col-span-3">
            <p className="text-xs text-muted-foreground">{t("form.justification")}</p>
            <p>{row.justification ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle>Approval trail</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="text-sm grid gap-2">
            <li>
              <span className="font-medium">Drafter</span> ·{" "}
              {row.drafter?.full_name ?? "—"}
              {row.submitted_at
                ? ` · submitted ${formatDateOnly(row.submitted_at)}`
                : ""}
            </li>
            <li>
              <span className="font-medium">Finance</span> ·{" "}
              {row.finance?.full_name ?? "—"}
              {row.finance_approved_at
                ? ` · decided ${formatDateOnly(row.finance_approved_at)}`
                : ""}
            </li>
            {row.director_approved_at || row.status === "PENDING_DIRECTOR" ? (
              <li>
                <span className="font-medium">Director</span> ·{" "}
                {row.director?.full_name ?? "—"}
                {row.director_approved_at
                  ? ` · decided ${formatDateOnly(row.director_approved_at)}`
                  : ""}
              </li>
            ) : null}
            {row.paid_at ? (
              <li>
                <span className="font-medium">Paid</span> ·{" "}
                {row.payer?.full_name ?? "—"}
                {" · "}
                {formatDateOnly(row.paid_at)}
                {row.paid_reference ? ` · ref ${row.paid_reference}` : ""}
              </li>
            ) : null}
          </ol>
        </CardContent>
      </Card>

      <UpkActionsPanel
        upkId={row.id}
        status={row.status}
        isDrafter={isDrafter}
        isFinance={isFinance}
        isDirector={isDirector}
        computedUpk={Number(parseMoneyFromDb(row.computed_upk))}
        hasJustification={Boolean(row.justification && row.justification.length > 0)}
      />
    </div>
  );
}
