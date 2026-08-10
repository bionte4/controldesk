import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftRight } from "lucide-react";
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
import { requireCurrentEmployee } from "@/lib/auth/session";
import { resolveCapabilitiesFor } from "@/lib/rbac/capability-resolver";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";
import { resolveProjectScope } from "@/lib/security/project-scope";
import { createClient } from "@/lib/supabase/server";
import { PMH_STATUS_LABEL, PMH_STATUS_TONE } from "@/lib/handover/state";
import type { PmHandoverStatus } from "@/types/database";

import {
  NewHandoverSheet,
  type PmOption,
  type ProjectOption,
} from "./new-handover-sheet";

export const metadata: Metadata = { title: "Handovers" };

type Row = {
  id: string;
  status: PmHandoverStatus;
  effective_at: string;
  reason: string;
  created_at: string;
  project_code: string;
  project_name: string;
  from_pm: string;
  to_pm: string;
};

type RawRow = {
  id: string;
  status: PmHandoverStatus;
  effective_at: string;
  reason: string;
  created_at: string;
  project: { code: string; name: string } | null;
  from_pm: { full_name: string } | null;
  to_pm: { full_name: string } | null;
};

async function loadHandovers(
  caller: { id: string; role: AnyDbEmployeeRole },
): Promise<Row[]> {
  const supabase = await createClient();

  // Rules §3 — org tiers (OM+/GM/Admin) see the full handover
  // register; a PM should only see handovers touching *their*
  // projects (either because they own one of the involved
  // projects, or because they are the outgoing/incoming PM).
  const scope = await resolveProjectScope(caller);

  let query = supabase
    .from("pm_handovers")
    .select(
      "id, status, effective_at, reason, created_at, project:project_id(code, name), from_pm:from_pm_employee_id(full_name), to_pm:to_pm_employee_id(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (scope.kind !== "org") {
    if (scope.empty) {
      // Nothing they own — only handovers where they are
      // personally on the from/to side.
      query = query.or(
        `from_pm_employee_id.eq.${caller.id},to_pm_employee_id.eq.${caller.id}`,
      );
    } else {
      // Union: (a) project in scope, or (b) I am from/to PM.
      query = query.or(
        `project_id.in.(${scope.projectIds.join(",")}),from_pm_employee_id.eq.${caller.id},to_pm_employee_id.eq.${caller.id}`,
      );
    }
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const rows = data as unknown as RawRow[];
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    effective_at: r.effective_at,
    reason: r.reason,
    created_at: r.created_at,
    project_code: r.project?.code ?? "—",
    project_name: r.project?.name ?? "—",
    from_pm: r.from_pm?.full_name ?? "—",
    to_pm: r.to_pm?.full_name ?? "—",
  }));
}

async function loadProjectOptions(): Promise<ProjectOption[]> {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, code, name, status")
    .in("status", ["PLANNING", "ACTIVE"])
    .order("name", { ascending: true })
    .limit(200);
  if (!projects) return [];

  const projectIds = projects.map((p) => p.id);
  const { data: assignments } = projectIds.length
    ? await supabase
        .from("project_pm_assignments")
        .select(
          "project_id, pm_employee_id, assignment_role, status, pm:pm_employee_id(full_name)",
        )
        .in("project_id", projectIds)
        .eq("status", "ACTIVE")
        .eq("assignment_role", "PRIMARY_PM")
    : { data: [] };

  const activePm = new Map<
    string,
    { id: string; name: string }
  >();
  for (const a of (assignments ?? []) as unknown as Array<{
    project_id: string;
    pm_employee_id: string;
    pm: { full_name: string } | null;
  }>) {
    activePm.set(a.project_id, {
      id: a.pm_employee_id,
      name: a.pm?.full_name ?? "—",
    });
  }

  return projects.map((p) => {
    const pm = activePm.get(p.id);
    return {
      id: p.id,
      label: `${p.code} · ${p.name}`,
      currentPmId: pm?.id ?? null,
      currentPmLabel: pm?.name ?? "—",
    };
  });
}

async function loadPmOptions(): Promise<PmOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("employees")
    .select("id, full_name, role")
    .eq("role", "PROJECT_MANAGER")
    .eq("is_active", true)
    .order("full_name", { ascending: true })
    .limit(200);
  return (data ?? []).map((e) => ({ id: e.id, label: e.full_name }));
}

export default async function HandoversPage() {
  const employee = await requireCurrentEmployee();
  const capabilities = await resolveCapabilitiesFor();
  if (!capabilities.can("view_handover")) {
    redirect("/dashboard?error=forbidden");
  }

  const [rows, projects, pms, t] = await Promise.all([
    loadHandovers({
      id: employee.id,
      role: employee.role as AnyDbEmployeeRole,
    }),
    loadProjectOptions(),
    loadPmOptions(),
    getTranslations("handovers"),
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
        <NewHandoverSheet projects={projects} pms={pms} />
      </header>

      {rows.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <ArrowLeftRight className="size-6" />
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
                    <Th>{t("columns.project")}</Th>
                    <Th>{t("columns.from")}</Th>
                    <Th>{t("columns.to")}</Th>
                    <Th>{t("columns.effectiveAt")}</Th>
                    <Th>{t("columns.status")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/handovers/${r.id}`}
                          className="hover:text-primary transition-colors"
                        >
                          <span className="font-mono text-xs text-muted-foreground">
                            {r.project_code}
                          </span>
                          <span className="ml-2">{r.project_name}</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.from_pm}
                      </td>
                      <td className="px-4 py-3 font-medium">{r.to_pm}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {formatInTz(r.effective_at, "dd MMM yyyy, HH:mm")}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={PMH_STATUS_TONE[r.status]}
                        >
                          {PMH_STATUS_LABEL[r.status]}
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
