import type { Metadata } from "next";
import Link from "next/link";
import { Users2 } from "lucide-react";
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
import { authorize } from "@/lib/security/pdp";
import { requireCurrentEmployee } from "@/lib/auth/session";
import type { EmployeeRole } from "@/lib/rbac/roles";
import { createClient } from "@/lib/supabase/server";
import type { ClientStatus } from "@/types/database";

import { NewClientSheet } from "./new-client-sheet";

export const metadata: Metadata = {
  title: "Clients",
};

type ClientRow = {
  id: string;
  name: string;
  industry: string | null;
  status: ClientStatus;
  contact_name: string | null;
  contact_email: string | null;
  onboarded_at: string | null;
  project_count: number;
};

async function loadClients(): Promise<ClientRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("clients")
    .select(
      "id, name, industry, status, contact_name, contact_email, onboarded_at, projects(count)",
    )
    .order("name", { ascending: true })
    .limit(200);

  if (error) {
    // Migration 0008 may not have been applied yet — degrade to empty list.
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    industry: row.industry,
    status: row.status as ClientStatus,
    contact_name: row.contact_name,
    contact_email: row.contact_email,
    onboarded_at: row.onboarded_at,
    // Supabase returns `projects: [{ count: N }]` for count aggregation.
    project_count:
      (row.projects as unknown as { count: number }[] | null)?.[0]?.count ?? 0,
  }));
}

const STATUS_TONE: Record<ClientStatus, string> = {
  PROSPECT: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  ACTIVE: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  ON_HOLD: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  CHURNED: "bg-rose-500/15 text-rose-500 border-rose-500/30",
};

export default async function ClientsPage() {
  const [employee, clients, t, tStatus, tCols] = await Promise.all([
    requireCurrentEmployee(),
    loadClients(),
    getTranslations("clients"),
    getTranslations("clients.status"),
    getTranslations("clients.columns"),
  ]);

  // PDP check for "may I add a new client here?" — used to gate the CTA.
  const canCreate =
    authorize({
      actor: {
        userId: employee.user_id,
        employeeId: employee.id,
        role: employee.role as EmployeeRole,
        tenantId: employee.tenant_id,
      },
      action: "create",
      resource: "client",
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
        {canCreate ? <NewClientSheet /> : null}
      </header>

      {clients.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Users2 className="size-6" />
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
                    <ColHead>{tCols("name")}</ColHead>
                    <ColHead>{tCols("industry")}</ColHead>
                    <ColHead>{tCols("status")}</ColHead>
                    <ColHead className="text-right tabular-nums">
                      {tCols("projects")}
                    </ColHead>
                    <ColHead>{tCols("contact")}</ColHead>
                    <ColHead>{tCols("onboardedAt")}</ColHead>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr
                      key={c.id}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium">
                        <Link
                          href={`/clients/${c.id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {c.industry ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={STATUS_TONE[c.status]}
                        >
                          {tStatus(c.status)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {c.project_count}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {c.contact_name ?? c.contact_email ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {c.onboarded_at
                          ? formatInTz(c.onboarded_at, "dd MMM yyyy")
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
