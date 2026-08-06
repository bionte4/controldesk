import type { Metadata } from "next";
import { format } from "date-fns";
import { getTranslations } from "next-intl/server";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { KpiCard } from "@/components/kpi-card";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { formatRole } from "@/lib/rbac/roles";

import { getDashboardMetrics, getPortfolioSnapshot } from "./actions";
import { PortfolioSnapshotSection } from "./portfolio-snapshot";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage() {
  const [employee, metrics, snapshot, t, tKpis] = await Promise.all([
    requireCurrentEmployee(),
    getDashboardMetrics(),
    getPortfolioSnapshot(),
    getTranslations("dashboard"),
    getTranslations("dashboard.kpis"),
  ]);

  const kpiLabel = (id: string, fallback: string): string => {
    switch (id) {
      case "active_projects":
        return tKpis("activeProjects");
      case "approved_budget":
        return tKpis("approvedBudget");
      case "milestone_done_pct":
        return tKpis("milestoneDone");
      case "pending_approvals":
        return tKpis("pendingApprovals");
      default:
        return fallback;
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-meta">{t("overview")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("welcome", { firstName: employee.full_name.split(" ")[0] })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("signedInAs", {
              role: formatRole(employee.role),
              tenant: employee.tenant_slug,
            })}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("updatedAt", {
            time: format(new Date(metrics.updatedAt), "PPpp"),
          })}
        </p>
      </header>

      <section
        aria-label={t("kpiSection")}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {metrics.kpis.map((kpi, i) => (
          <KpiCard
            key={kpi.id}
            kpi={{ ...kpi, label: kpiLabel(kpi.id, kpi.label) }}
            index={i}
          />
        ))}
      </section>

      <PortfolioSnapshotSection snapshot={snapshot} />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="glass lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display">
              {t("deliveryPulseTitle")}
            </CardTitle>
            <CardDescription>
              {t("deliveryPulseDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid place-items-center rounded-xl border border-dashed border-border/70 py-16 text-sm text-muted-foreground">
              {t("chartsPlaceholder")}
            </div>
          </CardContent>
        </Card>

        <Card className="glass">
          <CardHeader>
            <CardTitle className="font-display">
              {t("approvalInboxTitle")}
            </CardTitle>
            <CardDescription>{t("approvalInboxDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
              {t("approvalInboxEmpty")}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
