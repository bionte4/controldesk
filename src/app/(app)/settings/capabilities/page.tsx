import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
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
import { resolveCapabilitiesForTenant } from "@/lib/rbac/capability-resolver";
import { CAPABILITY_CATALOG } from "@/lib/rbac/capabilities";
import type { EmployeeRole } from "@/lib/rbac/roles";
import { createClient } from "@/lib/supabase/server";

import { CapabilityMatrix, type CapabilityRowState } from "./capability-matrix";

export const metadata: Metadata = { title: "Capabilities" };

/**
 * Roles allowed to open the admin capability matrix. Mirrors the
 * approval-thresholds admin surface — RLS on
 * `tenant_capability_overrides` (migration 0081) enforces the same
 * gate at the DB layer, so this list only decides whether the page
 * renders at all.
 */
const WRITE_ROLES: readonly EmployeeRole[] = [
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
];

function isWriteRole(role: string): boolean {
  return (WRITE_ROLES as readonly string[]).includes(role);
}

/**
 * Load the raw override rows for the tenant so the admin UI can
 * badge "last changed <relative>" per capability. The resolver
 * already caches per request; we hit it here anyway because we need
 * the `updated_at` / `updated_by` metadata that the resolver folds
 * away.
 */
async function loadOverrideMetadata(tenantId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenant_capability_overrides")
    .select("capability_id, role, granted, updated_at")
    .eq("tenant_id", tenantId);
  const byCap = new Map<string, { count: number; latestUpdatedAt: string | null }>();
  for (const row of data ?? []) {
    const entry = byCap.get(row.capability_id) ?? {
      count: 0,
      latestUpdatedAt: null,
    };
    entry.count += 1;
    if (!entry.latestUpdatedAt || row.updated_at > entry.latestUpdatedAt) {
      entry.latestUpdatedAt = row.updated_at;
    }
    byCap.set(row.capability_id, entry);
  }
  return byCap;
}

export default async function CapabilitiesAdminPage() {
  const employee = await requireCurrentEmployee();
  if (!isWriteRole(employee.role as string)) {
    // notFound() (not 403) so the URL stays undiscoverable — same
    // rationale as the other admin surfaces.
    notFound();
  }

  const [caps, overrideMeta, t] = await Promise.all([
    resolveCapabilitiesForTenant(employee.tenant_id),
    loadOverrideMetadata(employee.tenant_id),
    getTranslations("settings.capabilities"),
  ]);
  const tCap = await getTranslations("capabilities");

  // Build the row-per-capability state that the client matrix
  // renders. We resolve the cell state (default vs override) here
  // on the server so the client bundle stays trivial — the
  // component only needs to render checkboxes and call actions.
  const rows: CapabilityRowState[] = CAPABILITY_CATALOG.map((cap) => {
    const matrix = caps.matrixFor(cap.id);
    return {
      id: cap.id,
      category: cap.category,
      sensitivity: cap.sensitivity,
      title: tCap(`${cap.id}.title` as never),
      description: tCap(`${cap.id}.description` as never),
      defaultRoles: [...cap.defaultRoles],
      cells: Array.from(matrix.entries()).map(([role, state]) => ({
        role,
        state,
      })),
      overrideCount: overrideMeta.get(cap.id)?.count ?? 0,
      latestOverrideAt: overrideMeta.get(cap.id)?.latestUpdatedAt ?? null,
    };
  });

  const totalOverrides = rows.reduce((s, r) => s + r.overrideCount, 0);

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
            className={
              totalOverrides > 0
                ? "border-amber-400/30 bg-amber-500/10 text-amber-300"
                : "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
            }
          >
            {totalOverrides > 0
              ? t("overrideCount", { count: totalOverrides })
              : t("noOverrides")}
          </Badge>
        </div>
      </header>

      <Card className="glass">
        <CardHeader className="flex-row items-start gap-3">
          <div className="mt-1 grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="size-4" aria-hidden />
          </div>
          <div>
            <CardTitle>{t("hint.title")}</CardTitle>
            <CardDescription>{t("hint.body")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <CapabilityMatrix rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
