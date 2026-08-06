import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
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
import { authorize } from "@/lib/security/pdp";
import { requireCurrentEmployee } from "@/lib/auth/session";
import type { EmployeeRole } from "@/lib/rbac/roles";
import { createClient } from "@/lib/supabase/server";
import type { ProjectStatus } from "@/types/database";

import { NewProjectSheet, type ClientOption } from "./new-project-sheet";

export const metadata: Metadata = {
  title: "Projects",
};

type ProjectRow = {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  start_date: string | null;
  client_name: string;
  budget_amount_db: string | null;
};

async function loadClientOptions(): Promise<ClientOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name")
    .order("name", { ascending: true })
    .limit(200);
  if (error || !data) return [];
  return data.map((c) => ({ id: c.id, name: c.name }));
}

async function loadProjects(): Promise<ProjectRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, code, name, status, start_date, clients(name), project_budgets(budget_amount)",
    )
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(200);

  if (error) return [];

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status as ProjectStatus,
    start_date: row.start_date,
    client_name:
      (row.clients as unknown as { name: string } | null)?.name ?? "—",
    budget_amount_db:
      (row.project_budgets as unknown as { budget_amount: string }[] | null)?.[0]
        ?.budget_amount ?? null,
  }));
}

const STATUS_TONE: Record<ProjectStatus, string> = {
  PLANNING: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  ACTIVE: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  ON_HOLD: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  COMPLETED: "bg-primary/15 text-primary border-primary/30",
  ARCHIVED: "bg-muted text-muted-foreground border-border",
};

export default async function ProjectsPage() {
  const [employee, projects, clientOptions, t, tStatus, tCols] = await Promise.all([
    requireCurrentEmployee(),
    loadProjects(),
    loadClientOptions(),
    getTranslations("projects"),
    getTranslations("projects.status"),
    getTranslations("projects.columns"),
  ]);

  const canCreate =
    authorize({
      actor: {
        userId: employee.user_id,
        employeeId: employee.id,
        role: employee.role as EmployeeRole,
        tenantId: employee.tenant_id,
      },
      action: "create",
      resource: "project",
      attributes: { tenantId: employee.tenant_id },
    }).effect === "ALLOW";

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
        {canCreate ? <NewProjectSheet clients={clientOptions} /> : null}
      </header>

      {projects.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <ClipboardList className="size-6" />
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
                    <ColHead>{tCols("code")}</ColHead>
                    <ColHead>{tCols("name")}</ColHead>
                    <ColHead>{tCols("client")}</ColHead>
                    <ColHead>{tCols("status")}</ColHead>
                    <ColHead className="text-right">{tCols("budget")}</ColHead>
                    <ColHead>{tCols("startDate")}</ColHead>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr
                      key={p.id}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        <Link
                          href={`/projects/${p.id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {p.code}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium">
                        <Link
                          href={`/projects/${p.id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {p.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.client_name}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={STATUS_TONE[p.status]}
                        >
                          {tStatus(p.status)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {p.budget_amount_db
                          ? formatIDR(parseMoneyFromDb(p.budget_amount_db), {
                              compact: true,
                            })
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {p.start_date
                          ? formatInTz(p.start_date, "dd MMM yyyy")
                          : "—"}
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

function ColHead({
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
