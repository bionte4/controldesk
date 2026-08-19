import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ListTree } from "lucide-react";
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
import { loadAllLookupOptionsForAdmin } from "@/lib/data/lookups";
import type { EmployeeRole } from "@/lib/rbac/roles";

import { LookupManager } from "./lookup-manager";

export const metadata: Metadata = { title: "Reference data (Lookups)" };

/**
 * Only tenant admins + the top-level ops role may curate lookup values.
 * The `secret_rotation` page uses the same gate — we mirror the pattern
 * to keep the settings surface consistent.
 */
const WRITE_ROLES: readonly EmployeeRole[] = [
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
];

function isWriteRole(role: string): boolean {
  return (WRITE_ROLES as readonly string[]).includes(role);
}

export default async function LookupsPage() {
  const employee = await requireCurrentEmployee();
  if (!isWriteRole(employee.role as string)) {
    // Non-admins can't even see the surface — keeps the URL an unreachable
    // 404 rather than a 403 to avoid enumerating admin routes.
    notFound();
  }

  const [buckets, t] = await Promise.all([
    loadAllLookupOptionsForAdmin(),
    getTranslations("settings.lookups"),
  ]);

  // Sum across ALL 7 domains — Field Ops CA (unit_pengaju, transport_need,
  // area, rab_category) + HR/Finance master data (department, position,
  // budget_category). Previously only counted the Field Ops 4, which
  // under-reported the header badge once the HR/Finance domains got tabs.
  const allDomains = [
    "unit_pengaju",
    "transport_need",
    "area",
    "rab_category",
    "department",
    "position",
    "budget_category",
  ] as const;
  const totalOptions = allDomains.reduce(
    (n, d) => n + buckets[d].length,
    0,
  );
  const activeOptions = allDomains.reduce(
    (n, d) => n + buckets[d].filter((r) => r.is_active).length,
    0,
  );

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
            {t("activeCount", { active: activeOptions, total: totalOptions })}
          </Badge>
        </div>
      </header>

      {totalOptions === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <ListTree className="size-6" />
            </div>
            <CardTitle className="font-display text-xl">
              {t("empty")}
            </CardTitle>
            <CardDescription className="max-w-md text-center">
              {t("emptyBody")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LookupManager buckets={buckets} />
          </CardContent>
        </Card>
      ) : (
        <LookupManager buckets={buckets} />
      )}
    </div>
  );
}
