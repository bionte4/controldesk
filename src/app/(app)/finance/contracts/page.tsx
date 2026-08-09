import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
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
import { authorize } from "@/lib/security/pdp";
import { requireCurrentEmployee } from "@/lib/auth/session";
import type { EmployeeRole } from "@/lib/rbac/roles";
import { createClient } from "@/lib/supabase/server";
import type { ContractStatus } from "@/types/database";

import { NewContractSheet } from "./new-contract-sheet";

export const metadata: Metadata = { title: "BPO Contracts" };

const STATUS_TONE: Record<ContractStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground border-border",
  ACTIVE: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  ENDED: "bg-muted text-muted-foreground border-border",
  RENEWED: "bg-primary/15 text-primary border-primary/30",
  TERMINATED: "bg-rose-500/15 text-rose-500 border-rose-500/30",
};

type ContractRow = {
  id: string;
  contract_number: string;
  mrr_amount: string;
  currency: string;
  start_date: string;
  end_date: string | null;
  status: ContractStatus;
  updated_at: string;
  client: { id: string; name: string } | null;
};

export default async function ContractsPage() {
  const [employee, t, tCols, tStatus] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("contracts"),
    getTranslations("contracts.columns"),
    getTranslations("contracts.status"),
  ]);

  const supabase = await createClient();

  const [{ data: contracts }, { data: clients }] = await Promise.all([
    supabase
      .from("bpo_contracts")
      .select(
        "id, contract_number, mrr_amount, currency, start_date, end_date, status, updated_at, client:clients(id, name)",
      )
      .eq("tenant_id", employee.tenant_id)
      .order("updated_at", { ascending: false })
      .limit(300),
    supabase
      .from("clients")
      .select("id, name")
      .eq("tenant_id", employee.tenant_id)
      .order("name"),
  ]);

  const rows = (contracts ?? []) as unknown as ContractRow[];

  const canCreate =
    authorize({
      actor: {
        userId: employee.user_id,
        employeeId: employee.id,
        role: employee.role as EmployeeRole,
        tenantId: employee.tenant_id,
      },
      action: "create",
      resource: "bpo_contract",
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
        {canCreate && clients && clients.length > 0 ? (
          <NewContractSheet clients={clients} />
        ) : null}
      </header>

      {rows.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <FileText className="size-6" />
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
                    <ColHead>{tCols("number")}</ColHead>
                    <ColHead>{tCols("client")}</ColHead>
                    <ColHead>{tCols("status")}</ColHead>
                    <ColHead className="text-right tabular-nums">
                      {tCols("mrr")}
                    </ColHead>
                    <ColHead>{tCols("period")}</ColHead>
                    <ColHead>{tCols("updated")}</ColHead>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr
                      key={c.id}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        <Link
                          href={`/finance/contracts/${c.id}`}
                          className="text-primary hover:underline underline-offset-2"
                        >
                          {c.contract_number}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {c.client ? (
                          <Link
                            href={`/clients/${c.client.id}`}
                            className="hover:text-primary"
                          >
                            {c.client.name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <FinanceStatusBadge
                          tone={STATUS_TONE[c.status]}
                          label={tStatus(c.status)}
                        />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatIDR(parseMoneyFromDb(c.mrr_amount), {
                          compact: true,
                        })}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatInTz(c.start_date, "dd MMM yyyy")}
                        {c.end_date
                          ? ` – ${formatInTz(c.end_date, "dd MMM yyyy")}`
                          : ` – ${t("openEnded")}`}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatInTz(c.updated_at, "dd MMM yyyy")}
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
