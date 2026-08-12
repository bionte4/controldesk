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
import { resolveProjectScope } from "@/lib/security/project-scope";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { resolveCapabilitiesFor } from "@/lib/rbac/capability-resolver";
import type { AnyDbEmployeeRole, EmployeeRole } from "@/lib/rbac/roles";
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

async function loadProjects(
  employee: { id: string; role: AnyDbEmployeeRole },
  opts: { showBudget: boolean },
): Promise<ProjectRow[]> {
  const supabase = await createClient();
  const scope = await resolveProjectScope(employee);

  // Scoped caller with no active project assignment → return empty
  // list directly. `supabase-js` interprets `.in("id", [])` as an
  // unfiltered SELECT (returns every tenant-scoped project), which
  // was the exact leak fixed on the Dashboard.
  if (scope.kind !== "org" && scope.empty) return [];

  // Rules §3 — omit the `project_budgets(budget_amount)` join for
  // callers without the `view_budget` capability. The join is a
  // relational embed, not a filter, so dropping it saves one nested
  // fetch and removes the amount from the RSC payload entirely.
  const baseSelect =
    "id, code, project_number, name, status, priority, project_type, start_date, end_date, client_id, clients(id, name, project_code)";
  const selectClause = opts.showBudget
    ? `${baseSelect}, project_budgets(budget_amount)`
    : baseSelect;

  let query = supabase
    .from("projects")
    .select(selectClause)
    .order("start_date", { ascending: false, nullsFirst: false })
    .limit(200);
  if (scope.kind !== "org") {
    query = query.in("id", scope.projectIds);
  }
  const { data, error } = await query;

  if (error) return [];

  return (data ?? []).map((row) => {
    const r = row as unknown as {
      id: string;
      code: string;
      project_number: string | null;
      name: string;
      status: ProjectStatus;
      priority: ProjectPriority | null;
      project_type: ProjectType | null;
      start_date: string | null;
      end_date: string | null;
      client_id: string;
      clients: { id: string; name: string; project_code: string | null } | null;
      project_budgets?: { budget_amount: string }[] | null;
    };
    const cli = r.clients;
    return {
      id: r.id,
      code: r.code,
      project_number: r.project_number,
      name: r.name,
      status: r.status,
      priority: r.priority ?? "MEDIUM",
      project_type: r.project_type ?? "INTERNAL",
      start_date: r.start_date,
      end_date: r.end_date,
      client_id: r.client_id,
      client_name: cli?.name ?? "—",
      client_code: cli?.project_code ?? null,
      budget_amount_db: opts.showBudget
        ? r.project_budgets?.[0]?.budget_amount ?? null
        : null,
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
  // `loadProjects` needs the caller identity to resolve their
  // project-visibility scope (rules §3 ABAC). Fetch the employee
  // first so we can parallelise the rest against that scope.
  const employee = await requireCurrentEmployee();
  const dbRole = employee.role as AnyDbEmployeeRole;
  const capabilities = await resolveCapabilitiesFor();
  const showBudget = capabilities.can("view_budget");
  const [
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
    loadProjects({ id: employee.id, role: dbRole }, { showBudget }),
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
                    {showBudget ? (
                      <ColHead className="text-right">
                        {tCols("budget")}
                      </ColHead>
                    ) : null}
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
                      {showBudget ? (
                        <td className="px-4 py-3 text-right tabular-nums">
                          {p.budget_amount_db
                            ? formatIDR(parseMoneyFromDb(p.budget_amount_db), {
                                compact: true,
                              })
                            : "—"}
                        </td>
                      ) : null}
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
