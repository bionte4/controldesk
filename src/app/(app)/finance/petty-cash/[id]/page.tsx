import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Coins } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatInTz } from "@/lib/format/date";
import { formatIDR, parseMoneyFromDb } from "@/lib/format/money";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type {
  PettyCashReplenishmentStatus,
  PettyCashVoucherStatus,
} from "@/types/database";

import { NewVoucherSheet } from "../new-voucher-sheet";
import { RequestReplenishmentDialog } from "../request-replenishment-sheet";
import { ReplenishmentActions } from "../replenishment-actions";

export const metadata: Metadata = { title: "Petty Cash Fund" };

const VOUCHER_TONE: Record<PettyCashVoucherStatus, string> = {
  RECORDED: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  VOIDED: "border-white/10 bg-white/5 text-white/50",
};

const REPL_TONE: Record<PettyCashReplenishmentStatus, string> = {
  PENDING_FINANCE: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  APPROVED: "border-sky-400/30 bg-sky-500/10 text-sky-300",
  DISBURSED: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  REJECTED: "border-rose-400/30 bg-rose-500/10 text-rose-300",
};

export default async function PettyCashFundDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const [employee, t] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("pettyCash.detail"),
  ]);

  const supabase = await createClient();

  type FundView = {
    id: string;
    location_name: string;
    imprest_amount: string;
    balance: string;
    min_balance: string;
    custodian_employee_id: string;
    custodian: { id: string; full_name: string } | null;
  };
  type VoucherView = {
    id: string;
    amount: string;
    category: string;
    description: string;
    status: PettyCashVoucherStatus;
    incurred_on: string;
    creator: { full_name: string } | null;
  };
  type ReplView = {
    id: string;
    requested_amount: string;
    status: PettyCashReplenishmentStatus;
    reason: string | null;
    created_at: string;
    disbursement_ref: string | null;
    requester: { full_name: string } | null;
  };

  const [{ data: fundRaw }, { data: vouchersRaw }, { data: replRaw }] =
    await Promise.all([
      supabase
        .from("petty_cash_funds")
        .select(
          "*, custodian:custodian_employee_id(id, full_name)",
        )
        .eq("id", id)
        .eq("tenant_id", employee.tenant_id)
        .maybeSingle(),
      supabase
        .from("petty_cash_vouchers")
        .select(
          "id, amount, category, description, status, incurred_on, creator:created_by(full_name)",
        )
        .eq("fund_id", id)
        .eq("tenant_id", employee.tenant_id)
        .order("incurred_on", { ascending: false })
        .limit(50),
      supabase
        .from("petty_cash_replenishments")
        .select(
          "id, requested_amount, status, reason, created_at, disbursement_ref, requester:requested_by(full_name)",
        )
        .eq("fund_id", id)
        .eq("tenant_id", employee.tenant_id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  if (!fundRaw) notFound();

  const fund = fundRaw as unknown as FundView;
  const vouchers = (vouchersRaw ?? []) as unknown as VoucherView[];
  const replenishments = (replRaw ?? []) as unknown as ReplView[];

  const balance = parseMoneyFromDb(fund.balance);
  const imprest = parseMoneyFromDb(fund.imprest_amount);
  const minBalance = parseMoneyFromDb(fund.min_balance);
  const pct = imprest > 0n ? Number((balance * 100n) / imprest) : 0;
  const belowMin = balance < minBalance;

  const isCustodian = fund.custodian_employee_id === employee.id;
  const isFinance =
    employee.role === "LEAD_FINANCE" || employee.role === "TENANT_ADMIN";
  const canVoucher = isCustodian || isFinance;
  const canRequestRepl = isCustodian;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Button
          size="sm"
          variant="ghost"
          render={<Link href="/finance/petty-cash" />}
        >
          <ArrowLeft className="size-4" />
          {t("back")}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          {canVoucher ? <NewVoucherSheet fundId={fund.id} /> : null}
          {canRequestRepl ? (
            <RequestReplenishmentDialog fundId={fund.id} />
          ) : null}
        </div>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Coins className="size-6" />
          </div>
          <div>
            <p className="label-meta">{t("kicker")}</p>
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {fund.location_name}
            </h1>
            <p className="text-xs text-muted-foreground">
              {fund.custodian?.full_name ?? "—"}
            </p>
          </div>
        </div>
        {belowMin ? (
          <Badge
            variant="outline"
            className="border-rose-400/30 bg-rose-500/10 text-rose-300"
          >
            {t("belowMin")}
          </Badge>
        ) : null}
      </header>

      <Card className="glass">
        <CardHeader>
          <CardTitle>{t("balanceTitle")}</CardTitle>
          <CardDescription>
            {t("ofImprest", { amount: formatIDR(imprest) })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="font-display text-3xl font-semibold tabular-nums">
            {formatIDR(balance)}
          </p>
          <Progress value={Math.min(100, pct)} />
          <p className="text-xs text-muted-foreground">
            {t("minBalanceLabel", { amount: formatIDR(minBalance) })}
          </p>
        </CardContent>
      </Card>

      <Card className="glass overflow-hidden">
        <CardHeader>
          <CardTitle>{t("vouchersTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {vouchers.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {t("vouchersEmpty")}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <Th>{t("cols.date")}</Th>
                  <Th>{t("cols.category")}</Th>
                  <Th>{t("cols.description")}</Th>
                  <Th className="text-right">{t("cols.amount")}</Th>
                  <Th>{t("cols.status")}</Th>
                </tr>
              </thead>
              <tbody>
                {vouchers.map((v) => (
                  <tr key={v.id} className="border-t border-border/50">
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {formatInTz(v.incurred_on, "dd MMM yyyy")}
                    </td>
                    <td className="px-4 py-3 uppercase tracking-wide text-xs">
                      {v.category}
                    </td>
                    <td className="px-4 py-3 max-w-md truncate">
                      {v.description}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatIDR(parseMoneyFromDb(v.amount))}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={VOUCHER_TONE[v.status]}>
                        {v.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card className="glass overflow-hidden">
        <CardHeader>
          <CardTitle>{t("replenishmentsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {replenishments.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {t("replenishmentsEmpty")}
            </p>
          ) : (
            <ol className="divide-y divide-border/50">
              {replenishments.map((r) => (
                <li
                  key={r.id}
                  className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-4 py-3"
                >
                  <Badge variant="outline" className={REPL_TONE[r.status]}>
                    {r.status.replace(/_/g, " ")}
                  </Badge>
                  <div>
                    <p className="text-sm">
                      {r.requester?.full_name ?? "—"}{" "}
                      <span className="text-xs text-muted-foreground">
                        · {formatInTz(r.created_at, "dd MMM, HH:mm")}
                      </span>
                    </p>
                    {r.reason ? (
                      <p className="text-xs text-muted-foreground">{r.reason}</p>
                    ) : null}
                    {r.disbursement_ref ? (
                      <p className="text-[10px] text-muted-foreground">
                        Ref: {r.disbursement_ref}
                      </p>
                    ) : null}
                  </div>
                  <p className="tabular-nums text-sm">
                    {formatIDR(parseMoneyFromDb(r.requested_amount))}
                  </p>
                  {isFinance &&
                  (r.status === "PENDING_FINANCE" || r.status === "APPROVED") ? (
                    <ReplenishmentActions id={r.id} status={r.status} />
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
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
