import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Banknote } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDateOnly } from "@/lib/format/date";
import { formatIDR, parseMoneyFromDb } from "@/lib/format/money";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { resolveCapabilitiesFor } from "@/lib/rbac/capability-resolver";
import { createClient } from "@/lib/supabase/server";
import type { UpkStatus } from "@/lib/validation/upk";

export const metadata: Metadata = { title: "UPK notes" };

const STATUS_TONE: Record<UpkStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground border-border",
  PENDING_FINANCE: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30",
  PENDING_DIRECTOR: "bg-indigo-500/15 text-indigo-500 border-indigo-500/30",
  APPROVED: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  REJECTED_BY_FINANCE: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  REJECTED_BY_DIRECTOR: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  PAID: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  CANCELLED: "bg-muted text-muted-foreground border-border",
};

export default async function UpkListPage() {
  await requireCurrentEmployee();
  const capabilities = await resolveCapabilitiesFor();
  if (!capabilities.can("view_upk")) {
    redirect("/dashboard?error=forbidden");
  }

  const [t, tStatus] = await Promise.all([
    getTranslations("upk"),
    getTranslations("upk.status"),
  ]);
  const supabase = await createClient();

  const { data: rowsRaw } = await supabase
    .from("upk_notes")
    .select(
      "id, status, contract_end_date, computed_upk, submitted_at, finance_approved_at, paid_at, employee:employee_id(id, full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  type Row = {
    id: string;
    status: UpkStatus;
    contract_end_date: string;
    computed_upk: string;
    submitted_at: string | null;
    finance_approved_at: string | null;
    paid_at: string | null;
    employee: { id: string; full_name: string } | null;
  };
  const list = (rowsRaw ?? []) as unknown as Row[];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Banknote className="size-6" />
          </div>
          <div>
            <p className="label-meta">{t("kicker")}</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {t("title")}
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              {t("subtitle")}
            </p>
          </div>
        </div>
      </header>

      <Card className="glass">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <div className="text-sm text-muted-foreground border rounded-lg p-6 text-center">
              <p className="font-medium">{t("empty")}</p>
              <p>{t("emptyBody")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground uppercase tracking-wide">
                  <tr>
                    <th className="py-2 pr-3">{t("columns.employee")}</th>
                    <th className="py-2 pr-3">{t("columns.contractEnd")}</th>
                    <th className="py-2 pr-3">{t("columns.amount")}</th>
                    <th className="py-2 pr-3">{t("columns.status")}</th>
                    <th className="py-2 pr-3">{t("columns.submittedAt")}</th>
                    <th className="py-2 pr-3">{t("columns.approvedAt")}</th>
                    <th className="py-2 pr-3">{t("columns.paidAt")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="py-2 pr-3">
                        <Link
                          href={`/hr/upk/${r.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {r.employee?.full_name ?? "—"}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        {formatDateOnly(r.contract_end_date)}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">
                        {formatIDR(parseMoneyFromDb(r.computed_upk))}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge
                          variant="outline"
                          className={STATUS_TONE[r.status]}
                        >
                          {tStatus(r.status)}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {r.submitted_at ? formatDateOnly(r.submitted_at) : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {r.finance_approved_at
                          ? formatDateOnly(r.finance_approved_at)
                          : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {r.paid_at ? formatDateOnly(r.paid_at) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
