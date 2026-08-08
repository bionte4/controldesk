import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Calendar,
  FileText,
  FolderKanban,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatInTz } from "@/lib/format/date";
import { formatIDR, parseMoneyFromDb } from "@/lib/format/money";
import { requireCurrentEmployee } from "@/lib/auth/session";
import type { EmployeeRole } from "@/lib/rbac/roles";
import { authorize } from "@/lib/security/pdp";
import { createClient } from "@/lib/supabase/server";
import type { ContractStatus, ProjectStatus } from "@/types/database";

import { EditContractSheet } from "./edit-contract-sheet";

export const metadata: Metadata = { title: "Contract detail" };

const CONTRACT_STATUS_TONE: Record<ContractStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground border-border",
  ACTIVE: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  ENDED: "bg-muted text-muted-foreground border-border",
  RENEWED: "bg-primary/15 text-primary border-primary/30",
  TERMINATED: "bg-rose-500/15 text-rose-500 border-rose-500/30",
};

const PROJECT_STATUS_TONE: Record<ProjectStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground border-border",
  PLANNING: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  ACTIVE: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  ON_HOLD: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  COMPLETED: "bg-primary/15 text-primary border-primary/30",
  ARCHIVED: "bg-muted text-muted-foreground border-border",
};

export default async function ContractDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const [employee, t, tStatus, tProjectStatus] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("contracts.detail"),
    getTranslations("contracts.status"),
    getTranslations("projects.status"),
  ]);

  const supabase = await createClient();

  const { data: contract } = await supabase
    .from("bpo_contracts")
    .select(
      "id, contract_number, mrr_amount, currency, start_date, end_date, status, notes, created_at, updated_at, client:clients(id, name, status, industry)",
    )
    .eq("id", id)
    .eq("tenant_id", employee.tenant_id)
    .maybeSingle();

  if (!contract) notFound();

  // Projects linked to this contract via projects.contract_id (rules §6).
  const { data: linkedProjects } = await supabase
    .from("projects")
    .select("id, code, name, status, start_date, end_date")
    .eq("tenant_id", employee.tenant_id)
    .eq("contract_id", id)
    .order("start_date", { ascending: false, nullsFirst: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = contract.client as any as {
    id: string;
    name: string;
    status: string;
    industry: string | null;
  } | null;

  const mrr = parseMoneyFromDb(contract.mrr_amount);
  const annualRevenue = mrr * 12n;

  const canEdit =
    authorize({
      actor: {
        userId: employee.user_id,
        employeeId: employee.id,
        role: employee.role as EmployeeRole,
        tenantId: employee.tenant_id,
      },
      action: "update",
      resource: "bpo_contract",
      attributes: { tenantId: employee.tenant_id },
    }).effect === "ALLOW";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          size="sm"
          variant="ghost"
          render={
            <Link href={client ? `/clients/${client.id}` : "/clients"} />
          }
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <FileText className="size-6" />
          </div>
          <div>
            <p className="label-meta">{t("kicker")}</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight font-mono">
              {contract.contract_number}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge
                variant="outline"
                className={
                  CONTRACT_STATUS_TONE[contract.status as ContractStatus]
                }
              >
                {tStatus(contract.status as ContractStatus)}
              </Badge>
              {client ? (
                <Link
                  href={`/clients/${client.id}`}
                  className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                >
                  <Building2 className="size-3.5" />
                  {client.name}
                </Link>
              ) : null}
              <span>
                <Calendar className="mr-1 inline size-3.5" />
                {formatInTz(contract.start_date, "dd MMM yyyy")}
                {contract.end_date
                  ? ` – ${formatInTz(contract.end_date, "dd MMM yyyy")}`
                  : ` — ${t("openEnded")}`}
              </span>
            </div>
          </div>
        </div>
        {canEdit ? (
          <EditContractSheet
            contract={{
              id: contract.id,
              contract_number: contract.contract_number,
              mrr_amount_idr: Number(parseMoneyFromDb(contract.mrr_amount)),
              start_date: contract.start_date,
              end_date: contract.end_date,
              status: contract.status as
                | "DRAFT"
                | "ACTIVE"
                | "ENDED"
                | "RENEWED"
                | "TERMINATED",
              notes: contract.notes,
              client_id: client?.id ?? "",
            }}
          />
        ) : null}
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label={t("mrrLabel")}
          value={formatIDR(mrr, { compact: true })}
          sub={t("mrrHint")}
        />
        <MetricCard
          label={t("annualRevenueLabel")}
          value={formatIDR(annualRevenue, { compact: true })}
          sub={t("annualRevenueHint")}
        />
        <MetricCard
          label={t("linkedProjectsLabel")}
          value={String(linkedProjects?.length ?? 0)}
          sub={t("linkedProjectsHint")}
        />
        <MetricCard
          label={t("currencyLabel")}
          value={contract.currency}
          sub={t("currencyHint")}
        />
      </div>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderKanban className="size-4" />
            {t("projectsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!linkedProjects || linkedProjects.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {t("projectsEmpty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <th className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                      {t("code")}
                    </th>
                    <th className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                      {t("name")}
                    </th>
                    <th className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                      {t("status")}
                    </th>
                    <th className="px-4 py-2 text-xs uppercase tracking-wider text-muted-foreground">
                      {t("dates")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {linkedProjects.map((p) => (
                    <tr
                      key={p.id}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        <Link
                          href={`/projects/${p.id}`}
                          className="hover:text-primary"
                        >
                          {p.code}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        <Link
                          href={`/projects/${p.id}`}
                          className="hover:text-primary"
                        >
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={
                            PROJECT_STATUS_TONE[p.status as ProjectStatus]
                          }
                        >
                          {tProjectStatus(p.status as ProjectStatus)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {p.start_date
                          ? formatInTz(p.start_date, "dd MMM yyyy")
                          : "—"}
                        {p.end_date
                          ? ` – ${formatInTz(p.end_date, "dd MMM yyyy")}`
                          : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {contract.notes ? (
        <Card className="glass">
          <CardHeader>
            <CardTitle>{t("notesTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {contract.notes}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="text-xs text-muted-foreground">
        {t("createdAt", {
          date: formatInTz(contract.created_at, "dd MMM yyyy HH:mm"),
        })}
        {" · "}
        {t("updatedAt", {
          date: formatInTz(contract.updated_at, "dd MMM yyyy HH:mm"),
        })}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="glass">
      <CardHeader className="pb-2">
        <p className="label-meta">{label}</p>
      </CardHeader>
      <CardContent>
        <p className="font-display text-2xl font-semibold tracking-tight">
          {value}
        </p>
        {sub ? (
          <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
