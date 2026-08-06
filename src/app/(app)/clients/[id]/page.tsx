import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Mail, Phone, Users } from "lucide-react";
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
import { createClient } from "@/lib/supabase/server";
import type { ClientStatus, ContractStatus, ProjectStatus } from "@/types/database";

export const metadata: Metadata = { title: "Client detail" };

const CLIENT_STATUS_TONE: Record<ClientStatus, string> = {
  PROSPECT: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  ACTIVE: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  ON_HOLD: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  CHURNED: "bg-rose-500/15 text-rose-500 border-rose-500/30",
};

const PROJECT_STATUS_TONE: Record<ProjectStatus, string> = {
  PLANNING: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  ACTIVE: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  ON_HOLD: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  COMPLETED: "bg-primary/15 text-primary border-primary/30",
  ARCHIVED: "bg-muted text-muted-foreground border-border",
};

const CONTRACT_STATUS_TONE: Record<ContractStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground border-border",
  ACTIVE: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  ENDED: "bg-muted text-muted-foreground border-border",
  RENEWED: "bg-primary/15 text-primary border-primary/30",
  TERMINATED: "bg-rose-500/15 text-rose-500 border-rose-500/30",
};

export default async function ClientDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;

  const [employee, t, tStatus, tContractStatus, tProjectStatus] =
    await Promise.all([
      requireCurrentEmployee(),
      getTranslations("clients.detail"),
      getTranslations("clients.status"),
      getTranslations("contracts.status"),
      getTranslations("projects.status"),
    ]);

  const supabase = await createClient();

  const [{ data: client }, { data: projects }, { data: contracts }] =
    await Promise.all([
      supabase
        .from("clients")
        .select("*")
        .eq("id", id)
        .eq("tenant_id", employee.tenant_id)
        .maybeSingle(),
      supabase
        .from("projects")
        .select(
          "id, code, name, status, start_date, project_budgets(budget_amount, spent_amount)",
        )
        .eq("client_id", id)
        .eq("tenant_id", employee.tenant_id)
        .order("start_date", { ascending: false, nullsFirst: false }),
      supabase
        .from("bpo_contracts")
        .select("id, contract_number, mrr_amount, status, start_date, end_date")
        .eq("client_id", id)
        .eq("tenant_id", employee.tenant_id)
        .order("start_date", { ascending: false }),
    ]);

  if (!client) notFound();

  const activeProjects = (projects ?? []).filter((p) => p.status === "ACTIVE");
  const totalBudget = (projects ?? []).reduce((acc, p) => {
    const b = (p.project_budgets as unknown as {
      budget_amount: string;
    }[] | null)?.[0];
    return acc + (b ? parseMoneyFromDb(b.budget_amount) : 0n);
  }, 0n);
  const totalSpent = (projects ?? []).reduce((acc, p) => {
    const b = (p.project_budgets as unknown as {
      spent_amount: string;
    }[] | null)?.[0];
    return acc + (b ? parseMoneyFromDb(b.spent_amount) : 0n);
  }, 0n);
  const activeMrr = (contracts ?? [])
    .filter((c) => c.status === "ACTIVE")
    .reduce((acc, c) => acc + parseMoneyFromDb(c.mrr_amount), 0n);

  const grossMarginPct = (() => {
    const revenueMonths = 12n;
    const annualRevenue = activeMrr * revenueMonths;
    if (annualRevenue === 0n) return null;
    const margin = annualRevenue - totalSpent;
    // Round to 1dp integer percent via 10x scaling.
    return Number((margin * 1000n) / annualRevenue) / 10;
  })();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          size="sm"
          variant="ghost"
          render={<Link href="/clients" />}
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Building2 className="size-6" />
          </div>
          <div>
            <p className="label-meta">{t("kicker")}</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {client.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge
                variant="outline"
                className={CLIENT_STATUS_TONE[client.status as ClientStatus]}
              >
                {tStatus(client.status as ClientStatus)}
              </Badge>
              {client.industry ? <span>· {client.industry}</span> : null}
              {client.onboarded_at ? (
                <span>
                  · {t("onboardedOn", { date: formatInTz(client.onboarded_at, "dd MMM yyyy") })}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {client.contact_email ? (
            <span className="inline-flex items-center gap-1.5">
              <Mail className="size-4" />
              {client.contact_email}
            </span>
          ) : null}
          {client.contact_phone ? (
            <span className="inline-flex items-center gap-1.5">
              <Phone className="size-4" />
              {client.contact_phone}
            </span>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            render={<Link href={`/clients/${id}/portal-users`} />}
          >
            <Users className="size-4" />
            {t("managePortalUsers")}
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label={t("activeProjects")}
          value={String(activeProjects.length)}
          sub={t("totalProjects", { count: projects?.length ?? 0 })}
        />
        <MetricCard
          label={t("activeMrr")}
          value={formatIDR(activeMrr, { compact: true })}
          sub={t("mrrHint")}
        />
        <MetricCard
          label={t("totalBudget")}
          value={formatIDR(totalBudget, { compact: true })}
          sub={t("totalSpent", {
            amount: formatIDR(totalSpent, { compact: true }),
          })}
        />
        <MetricCard
          label={t("grossMarginProxy")}
          value={
            grossMarginPct === null
              ? "—"
              : `${grossMarginPct.toFixed(1)}%`
          }
          sub={t("grossMarginNote")}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="glass lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("projectsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!projects || projects.length === 0 ? (
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
                      <th className="px-4 py-2 text-right text-xs uppercase tracking-wider text-muted-foreground">
                        {t("budget")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => {
                      const budget = (p.project_budgets as unknown as {
                        budget_amount: string;
                      }[] | null)?.[0];
                      return (
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
                          <td className="px-4 py-3 text-right tabular-nums">
                            {budget
                              ? formatIDR(parseMoneyFromDb(budget.budget_amount), {
                                  compact: true,
                                })
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader>
            <CardTitle>{t("contractsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!contracts || contracts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("contractsEmpty")}
              </p>
            ) : (
              contracts.map((c) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-white/10 bg-white/5 p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-sm">{c.contract_number}</div>
                    <Badge
                      variant="outline"
                      className={
                        CONTRACT_STATUS_TONE[c.status as ContractStatus]
                      }
                    >
                      {tContractStatus(c.status as ContractStatus)}
                    </Badge>
                  </div>
                  <div className="mt-1 text-sm">
                    {formatIDR(parseMoneyFromDb(c.mrr_amount), {
                      compact: true,
                    })}
                    <span className="text-xs text-muted-foreground"> / mo</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatInTz(c.start_date, "dd MMM yyyy")}
                    {c.end_date
                      ? ` – ${formatInTz(c.end_date, "dd MMM yyyy")}`
                      : ""}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {client.notes ? (
        <Card className="glass">
          <CardHeader>
            <CardTitle>{t("notesTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {client.notes}
            </p>
          </CardContent>
        </Card>
      ) : null}
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
