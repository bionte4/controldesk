import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
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
import { formatIDR, parseMoneyFromDb } from "@/lib/format/money";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/expenses/state";
import { EXPENSE_CATEGORIES } from "@/lib/validation/expense";
import type { ExpenseStatus } from "@/types/database";

import { NewExpenseSheet, type ProjectOption } from "./new-expense-sheet";

export const metadata: Metadata = {
  title: "Expenses",
};

type ExpenseRow = {
  id: string;
  amount_db: string | number;
  category: string;
  description: string;
  status: ExpenseStatus;
  incurred_on: string;
  created_at: string;
  project_code: string;
  project_name: string;
};

async function loadExpenses(): Promise<ExpenseRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_expenses")
    .select(
      "id, amount, category, description, status, incurred_on, created_at, projects(code, name)",
    )
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
      amount_db: row.amount,
      category: row.category,
      description: row.description,
      status: row.status as ExpenseStatus,
      incurred_on: row.incurred_on,
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

export default async function ExpensesPage() {
  const [employee, expenses, projectOptions, t, tCat] = await Promise.all([
    requireCurrentEmployee(),
    loadExpenses(),
    loadProjectOptions(),
    getTranslations("expenses"),
    getTranslations("expenses.categories"),
  ]);
  void employee;

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
        <NewExpenseSheet projects={projectOptions} />
      </header>

      {expenses.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Receipt className="size-6" />
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
                    <Th>{t("columns.date")}</Th>
                    <Th>{t("columns.project")}</Th>
                    <Th>{t("columns.description")}</Th>
                    <Th>{t("columns.category")}</Th>
                    <Th className="text-right">{t("columns.amount")}</Th>
                    <Th>{t("columns.status")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr
                      key={e.id}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {formatInTz(e.incurred_on, "dd MMM yyyy")}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {e.project_code}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/finance/expenses/${e.id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {e.description}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {(EXPENSE_CATEGORIES as readonly string[]).includes(
                          e.category,
                        )
                          ? tCat(
                              e.category as (typeof EXPENSE_CATEGORIES)[number],
                            )
                          : e.category}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatIDR(parseMoneyFromDb(e.amount_db), {
                          compact: true,
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={STATUS_TONE[e.status]}
                        >
                          {STATUS_LABEL[e.status]}
                        </Badge>
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
