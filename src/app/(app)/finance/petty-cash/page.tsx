import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Coins } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatIDR, parseMoneyFromDb } from "@/lib/format/money";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { resolveCapabilitiesFor } from "@/lib/rbac/capability-resolver";
import { createClient } from "@/lib/supabase/server";

import { NewFundSheet, type CustodianOption } from "./new-fund-sheet";

export const metadata: Metadata = {
  title: "Petty Cash",
};

type FundRow = {
  id: string;
  location_name: string;
  balance: string;
  imprest: string;
  min_balance: string;
  custodian_name: string;
  below_min: boolean;
};

type RawFund = {
  id: string;
  location_name: string;
  balance: string;
  imprest_amount: string;
  min_balance: string;
  custodian: { full_name: string } | null;
};

async function loadFunds(): Promise<FundRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("petty_cash_funds")
    .select(
      "id, location_name, balance, imprest_amount, min_balance, custodian:custodian_employee_id(full_name)",
    )
    .eq("is_active", true)
    .order("location_name", { ascending: true });
  if (error || !data) return [];

  const rows = data as unknown as RawFund[];
  return rows.map((row) => {
    const balanceMoney = parseMoneyFromDb(row.balance);
    const minBalanceMoney = parseMoneyFromDb(row.min_balance);
    return {
      id: row.id,
      location_name: row.location_name,
      balance: row.balance,
      imprest: row.imprest_amount,
      min_balance: row.min_balance,
      custodian_name: row.custodian?.full_name ?? "—",
      below_min: balanceMoney < minBalanceMoney,
    };
  });
}

async function loadCustodianOptions(): Promise<CustodianOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .select("id, full_name, role")
    .in("role", ["PETTY_CASH_CUSTODIAN", "LEAD_FINANCE"])
    .eq("is_active", true)
    .order("full_name", { ascending: true });
  if (error || !data) return [];
  return data.map((e) => ({ id: e.id, label: `${e.full_name} · ${e.role}` }));
}

export default async function PettyCashPage() {
  await requireCurrentEmployee();
  const capabilities = await resolveCapabilitiesFor();
  if (!capabilities.can("view_petty_cash")) {
    redirect("/dashboard?error=forbidden");
  }

  const [funds, custodians, t] = await Promise.all([
    loadFunds(),
    loadCustodianOptions(),
    getTranslations("pettyCash"),
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
        <NewFundSheet custodians={custodians} />
      </header>

      {funds.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Coins className="size-6" />
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {funds.map((f) => {
            const balanceMoney = parseMoneyFromDb(f.balance);
            const imprestMoney = parseMoneyFromDb(f.imprest);
            const pct =
              imprestMoney > 0n
                ? Number((balanceMoney * 100n) / imprestMoney)
                : 0;
            return (
              <Link
                key={f.id}
                href={`/finance/petty-cash/${f.id}`}
                className="group"
              >
                <Card className="glass h-full transition-colors group-hover:border-primary/40">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">
                        {f.location_name}
                      </CardTitle>
                      {f.below_min ? (
                        <Badge
                          variant="outline"
                          className="border-rose-400/30 bg-rose-500/10 text-rose-300"
                        >
                          {t("belowMinBadge")}
                        </Badge>
                      ) : null}
                    </div>
                    <CardDescription>{f.custodian_name}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-muted-foreground">
                        {t("balance")}
                      </span>
                      <span className="tabular-nums font-semibold">
                        {formatIDR(balanceMoney)}
                      </span>
                    </div>
                    <Progress value={Math.min(100, pct)} />
                    <p className="text-[10px] text-muted-foreground">
                      {t("ofImprest", {
                        amount: formatIDR(imprestMoney, { compact: true }),
                      })}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
