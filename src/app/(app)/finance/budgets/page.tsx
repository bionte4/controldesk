import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BadgeDollarSign } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { FinanceStatusBadge } from "@/components/finance/finance-status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatInTz } from "@/lib/format/date";
import { formatIDR, parseMoneyFromDb } from "@/lib/format/money";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { resolveCapabilitiesFor } from "@/lib/rbac/capability-resolver";
import { createClient } from "@/lib/supabase/server";
import { BUDGET_STATUS_LABEL, BUDGET_STATUS_TONE } from "@/lib/budgets/state";
import type { BudgetStatus } from "@/types/database";

import { NewBudgetSheet, type ProjectOption } from "./new-budget-sheet";

export const metadata: Metadata = {
  title: "Budgets",
};

type BudgetRow = {
  id: string;
  title: string;
  fiscal_year: number;
  status: BudgetStatus;
  total_planned_amount_db: string | number;
  created_at: string;
  project_code: string;
  project_name: string;
};

async function loadBudgets(): Promise<BudgetRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("budgets")
    .select(
      "id, title, fiscal_year, status, total_planned_amount, created_at, projects(code, name)",
    )
    .order("fiscal_year", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];

  return data.map((row) => {
    const proj = row.projects as unknown as {
      code: string;
      name: string;
    } | null;
    return {
      id: row.id,
      title: row.title,
      fiscal_year: row.fiscal_year,
      status: row.status as BudgetStatus,
      total_planned_amount_db: row.total_planned_amount,
      created_at: row.created_at,
      project_code: proj?.code ?? "—",
      project_name: proj?.name ?? "—",
    };
  });
}

async function loadProjectOptions(): Promise<ProjectOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, code, name")
    .in("status", ["PLANNING", "ACTIVE"])
    .order("name", { ascending: true })
    .limit(200);
  if (error || !data) return [];
  return data.map((p) => ({ id: p.id, label: `${p.code} · ${p.name}` }));
}

export default async function BudgetsPage() {
  await requireCurrentEmployee();
  const capabilities = await resolveCapabilitiesFor();
  if (!capabilities.can("view_budget")) {
    redirect("/dashboard?error=forbidden");
  }

  const [budgets, projectOptions, t] = await Promise.all([
    loadBudgets(),
    loadProjectOptions(),
    getTranslations("budgets"),
  ]);

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
        <NewBudgetSheet projects={projectOptions} />
      </header>

      {budgets.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <BadgeDollarSign className="size-6" />
            </div>
            <CardTitle className="font-display text-xl">{t("empty")}</CardTitle>
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
                    <Th>{t("columns.fiscalYear")}</Th>
                    <Th>{t("columns.project")}</Th>
                    <Th>{t("columns.title")}</Th>
                    <Th className="text-right">{t("columns.totalPlanned")}</Th>
                    <Th>{t("columns.status")}</Th>
                    <Th>{t("columns.createdAt")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {budgets.map((b) => (
                    <tr
                      key={b.id}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        FY{b.fiscal_year}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {b.project_code}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/finance/budgets/${b.id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {b.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatIDR(parseMoneyFromDb(b.total_planned_amount_db), {
                          compact: true,
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <FinanceStatusBadge
                          tone={BUDGET_STATUS_TONE[b.status]}
                          label={BUDGET_STATUS_LABEL[b.status]}
                        />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {formatInTz(b.created_at, "dd MMM yyyy")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Th({
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
