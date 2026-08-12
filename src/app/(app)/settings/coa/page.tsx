import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { loadCoaTree } from "@/lib/data/coa";
import { roleInGate } from "@/lib/rbac/roles";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";

import { CoaManager } from "./coa-manager";

export const metadata: Metadata = { title: "Chart of Accounts" };

/**
 * Curation surface for the tenant's Chart of Accounts. Finance owns the
 * master list — TENANT_ADMIN is included so a founder-only tenant can
 * bootstrap without a dedicated finance seat. Uses `roleInGate` so canonical
 * GAS roles (`FINANCE`, `ADMIN`) fold onto their legacy equivalents (rules
 * §6 Fase 0 aliasing).
 */
const WRITE_ROLES: readonly AnyDbEmployeeRole[] = [
  "TENANT_ADMIN",
  "LEAD_FINANCE",
];

export default async function ChartOfAccountsPage() {
  const employee = await requireCurrentEmployee();
  if (!roleInGate(employee.role as AnyDbEmployeeRole, WRITE_ROLES)) {
    notFound();
  }

  const [tree, t] = await Promise.all([
    loadCoaTree(),
    getTranslations("settings.coa"),
  ]);

  // Flatten for total counters / picker in the create dialog. `depth` was
  // computed by the loader so we can keep the tree structure for display
  // while still counting cheaply.
  const flat: { id: string; is_active: boolean; is_postable: boolean }[] = [];
  const stack = [...tree];
  while (stack.length) {
    const node = stack.pop()!;
    flat.push({
      id: node.id,
      is_active: node.is_active,
      is_postable: node.is_postable,
    });
    for (const c of node.children) stack.push(c);
  }
  const activeCount = flat.filter((r) => r.is_active).length;
  const postableCount = flat.filter((r) => r.is_active && r.is_postable).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/settings"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            {t("backToSettings")}
          </Link>
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className="border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
          >
            {t("activeCount", { active: activeCount, total: flat.length })}
          </Badge>
          <Badge
            variant="outline"
            className="border-sky-400/30 bg-sky-500/10 text-sky-300"
          >
            {t("postableCount", { count: postableCount })}
          </Badge>
        </div>
      </header>

      {flat.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <BookOpen className="size-6" />
            </div>
            <CardTitle className="font-display text-xl">
              {t("empty")}
            </CardTitle>
            <CardDescription className="max-w-md text-center">
              {t("emptyBody")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CoaManager tree={tree} />
          </CardContent>
        </Card>
      ) : (
        <CoaManager tree={tree} />
      )}
    </div>
  );
}
