import type { Metadata } from "next";
import Link from "next/link";
import { Wallet } from "lucide-react";
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
import { CA_STATUS_LABEL, CA_STATUS_TONE } from "@/lib/cash-advance/state";
import {
  CANONICAL_CA_STATUS_LABEL,
  CANONICAL_CA_STATUS_TONE,
} from "@/lib/cash-advance/state-canonical";
import type { CashAdvanceStatus, CashAdvanceType } from "@/types/database";

import {
  NewCashAdvanceSheet,
  type ProjectOption,
} from "./new-cash-advance-sheet";

export const metadata: Metadata = {
  title: "Cash Advances",
};

type Row = {
  id: string;
  amount_db: string;
  purpose: string;
  status: CashAdvanceStatus;
  ca_type: CashAdvanceType;
  needed_by: string | null;
  created_at: string;
  project_code: string;
  requester_name: string;
};

type RawRow = {
  id: string;
  amount: string;
  purpose: string;
  status: CashAdvanceStatus;
  ca_type: CashAdvanceType | null;
  needed_by: string | null;
  created_at: string;
  projects: { code: string } | null;
  requester: { full_name: string } | null;
};

async function loadRequests(): Promise<Row[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cash_advances")
    .select(
      "id, amount, purpose, status, ca_type, needed_by, created_at, projects(code), requester:requester_employee_id(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];

  const rows = data as unknown as RawRow[];
  return rows.map((row) => ({
    id: row.id,
    amount_db: row.amount,
    purpose: row.purpose,
    status: row.status,
    ca_type: row.ca_type ?? "GENERAL",
    needed_by: row.needed_by,
    created_at: row.created_at,
    project_code: row.projects?.code ?? "—",
    requester_name: row.requester?.full_name ?? "—",
  }));
}

/**
 * Prefer the canonical label/tone (GAS-aligned) where defined; fall back
 * to the legacy legend for in-flight PENDING_L* rows.
 */
function caLabel(status: CashAdvanceStatus): string {
  const canonical =
    (CANONICAL_CA_STATUS_LABEL as Partial<Record<CashAdvanceStatus, string>>)[
      status
    ];
  return canonical ?? CA_STATUS_LABEL[status];
}

function caTone(status: CashAdvanceStatus): string {
  const canonical =
    (CANONICAL_CA_STATUS_TONE as Partial<Record<CashAdvanceStatus, string>>)[
      status
    ];
  return canonical ?? CA_STATUS_TONE[status];
}

const CA_TYPE_TONE: Record<CashAdvanceType, string> = {
  GENERAL: "border-slate-400/30 bg-slate-500/10 text-slate-300",
  FIELD_OPS: "border-amber-400/30 bg-amber-500/10 text-amber-300",
};

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

export default async function CashAdvancesPage() {
  const [employee, rows, projectOptions, t, tTypes] = await Promise.all([
    requireCurrentEmployee(),
    loadRequests(),
    loadProjectOptions(),
    getTranslations("cashAdvances"),
    getTranslations("cashAdvances.types"),
  ]);
  void employee;

  const typeLabel: Record<CashAdvanceType, string> = {
    GENERAL: tTypes("general"),
    FIELD_OPS: tTypes("fieldOps"),
  };

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
        <NewCashAdvanceSheet projects={projectOptions} />
      </header>

      {rows.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Wallet className="size-6" />
            </div>
            <CardTitle className="font-display text-xl">
              {t("empty")}
            </CardTitle>
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
                    <Th>{t("columns.type")}</Th>
                    <Th>{t("columns.requester")}</Th>
                    <Th>{t("columns.purpose")}</Th>
                    <Th className="text-right">{t("columns.amount")}</Th>
                    <Th>{t("columns.neededBy")}</Th>
                    <Th>{t("columns.status")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs">
                        {r.project_code}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={CA_TYPE_TONE[r.ca_type]}
                        >
                          {typeLabel[r.ca_type]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/finance/cash-advances/${r.id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {r.requester_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 max-w-md truncate">
                        {r.purpose}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatIDR(parseMoneyFromDb(r.amount_db), {
                          compact: true,
                        })}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {r.needed_by
                          ? formatInTz(r.needed_by, "dd MMM yyyy")
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={caTone(r.status)}>
                          {caLabel(r.status)}
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
