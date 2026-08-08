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
import type {
  ProjectPriority,
  ProjectStatus,
  ProjectType,
} from "@/types/database";

import {
  NewProjectSheet,
  type ClientOption,
  type PmOption,
  type SponsorOption,
} from "./new-project-sheet";

export const metadata: Metadata = {
  title: "Projects",
};

type ProjectRow = {
  id: string;
  code: string;
  project_number: string | null;
  name: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  project_type: ProjectType;
  start_date: string | null;
  end_date: string | null;
  client_id: string;
  client_name: string;
  client_code: string | null;
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

async function loadPmOptions(): Promise<PmOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .select("id, first_name, last_name, full_name, role")
    .in("role", ["PROJECT_MANAGER", "OPERATIONS_MANAGER", "HEAD_MANAGER"])
    .limit(200);
  if (error || !data) return [];
  return data.map((e) => {
    const emp = e as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      full_name: string | null;
    };
    const displayName =
      [emp.first_name, emp.last_name].filter(Boolean).join(" ") ||
      emp.full_name ||
      "—";
    return { id: emp.id, name: displayName };
  });
}

/**
 * BC sponsors are OM / HM / TENANT_ADMIN — the roles who typically
 * own the intake pitch before the project is promoted to PLANNING.
 * We surface the DB role as-is so the picker can show it as a tag.
 */
async function loadSponsorOptions(): Promise<SponsorOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .select("id, first_name, last_name, full_name, role")
    .in("role", ["OPERATIONS_MANAGER", "HEAD_MANAGER", "TENANT_ADMIN"])
    .limit(200);
  if (error || !data) return [];
  return data.map((e) => {
    const emp = e as {
      id: string;
      first_name: string | null;
      last_name: string | null;
      full_name: string | null;
      role: string;
    };
    const displayName =
      [emp.first_name, emp.last_name].filter(Boolean).join(" ") ||
      emp.full_name ||
      "—";
    return { id: emp.id, name: displayName, role: emp.role };
  });
}

async function loadProjects(): Promise<ProjectRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, code, project_number, name, status, priority, project_type, start_date, end_date, client_id, clients(id, name, project_code), project_budgets(budget_amount)",
    )
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(200);

  if (error) return [];

  return (data ?? []).map((row) => {
    const cli = row.clients as unknown as
      | { id: string; name: string; project_code: string | null }
      | null;
    return {
      id: row.id,
      code: row.code,
      project_number: row.project_number,
      name: row.name,
      status: row.status as ProjectStatus,
      priority: (row.priority ?? "MEDIUM") as ProjectPriority,
      project_type: (row.project_type ?? "INTERNAL") as ProjectType,
      start_date: row.start_date,
      end_date: row.end_date,
      client_id: row.client_id,
      client_name: cli?.name ?? "—",
      client_code: cli?.project_code ?? null,
      budget_amount_db:
        (row.project_budgets as unknown as { budget_amount: string }[] | null)?.[0]
          ?.budget_amount ?? null,
    };
  });
}

const STATUS_TONE: Record<ProjectStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground border-border",
  PLANNING: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  ACTIVE: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  ON_HOLD: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  COMPLETED: "bg-primary/15 text-primary border-primary/30",
  ARCHIVED: "bg-muted text-muted-foreground border-border",
};

const PRIORITY_TONE: Record<ProjectPriority, string> = {
  CRITICAL: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  HIGH: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  MEDIUM: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  LOW: "bg-muted text-muted-foreground border-border",
};

export default async function ProjectsPage() {
  const [
    employee,
    projects,
    clientOptions,
    pmOptions,
    sponsorOptions,
    t,
    tStatus,
    tPriority,
    tType,
    tCols,
  ] = await Promise.all([
    requireCurrentEmployee(),
    loadProjects(),
    loadClientOptions(),
    loadPmOptions(),
    loadSponsorOptions(),
    getTranslations("projects"),
    getTranslations("projects.status"),
    getTranslations("projects.priority"),
    getTranslations("projects.type"),
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
        {canCreate ? (
          <NewProjectSheet
            clients={clientOptions}
            pms={pmOptions}
            sponsors={sponsorOptions}
          />
        ) : null}
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
                    <ColHead>{tCols("type")}</ColHead>
                    <ColHead>{tCols("status")}</ColHead>
                    <ColHead>{tCols("priority")}</ColHead>
                    <ColHead className="text-right">{tCols("budget")}</ColHead>
                    <ColHead>{tCols("period")}</ColHead>
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
                          {p.project_number ?? p.code}
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
                        <Link
                          href={`/clients/${p.client_id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {p.client_name}
                        </Link>
                        {p.client_code ? (
                          <span className="ml-1 font-mono text-xs text-muted-foreground/70">
                            ({p.client_code})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {tType(p.project_type)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={STATUS_TONE[p.status]}
                        >
                          {tStatus(p.status)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={PRIORITY_TONE[p.priority]}
                        >
                          {tPriority(p.priority)}
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
                        {p.end_date ? (
                          <>
                            <span className="mx-1 text-muted-foreground/50">→</span>
                            {formatInTz(p.end_date, "dd MMM yyyy")}
                          </>
                        ) : null}
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
