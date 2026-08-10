import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info, Sparkles } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  FEATURE_KEYS,
  FEATURE_REGISTRY,
  defaultFor,
  type FeatureKey,
} from "@/lib/ops/feature-flags";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";

/**
 * Read-only view of feature flags enabled for the current tenant
 * (Fase 5, migration 0077 + `src/lib/ops/feature-flags.ts`).
 *
 * Purpose: tenant admins want to know **which** features their tenant
 * is entitled to without asking the platform team. Toggling still
 * remains platform-admin only (RLS enforced at
 * `tenant_feature_flags_platform_write`).
 *
 * Gate: `TENANT_ADMIN` + `GENERAL_MANAGER` for consistency with the
 * rest of the settings admin surface (rules §17). Any other role
 * gets `notFound()` — deliberately not `/dashboard?error=forbidden`
 * so we don't leak the existence of the page to non-admins.
 */

export const metadata: Metadata = { title: "Fitur aktif" };

const ALLOWED_ROLES: readonly AnyDbEmployeeRole[] = [
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
];

export default async function TenantFeatureFlagsPage() {
  const employee = await requireCurrentEmployee();
  if (!ALLOWED_ROLES.includes(employee.role as AnyDbEmployeeRole)) {
    notFound();
  }

  const t = await getTranslations("settings.features");
  const tCommon = await getTranslations("settings.approvalThresholds");

  const supabase = await createClient();
  const { data: flagRows } = await supabase
    .from("tenant_feature_flags")
    .select("feature_key, enabled, notes, updated_at")
    .eq("tenant_id", employee.tenant_id);

  const rowsByKey = new Map(
    (flagRows ?? []).map((r) => [r.feature_key as FeatureKey, r]),
  );

  const resolved = FEATURE_KEYS.map((key) => {
    const row = rowsByKey.get(key);
    return {
      key,
      meta: FEATURE_REGISTRY[key],
      enabled: row?.enabled ?? defaultFor(key),
      isOverridden: row !== undefined,
      notes: row?.notes ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  });

  const enabledCount = resolved.filter((r) => r.enabled).length;
  const overriddenCount = resolved.filter((r) => r.isOverridden).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/settings"
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {tCommon("backToSettings")}
        </Link>
        <header>
          <p className="label-meta">{t("kicker")}</p>
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary">
              <Sparkles className="size-5" aria-hidden />
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              {t("title")}
            </h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </header>
      </div>

      <Card className="glass border-primary/20 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-4">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <div className="flex-1 text-sm">
            <p className="font-medium">{t("infoBanner.title")}</p>
            <p className="mt-0.5 text-muted-foreground">
              {t("infoBanner.description")}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={t("stats.total")}
          value={String(FEATURE_KEYS.length)}
        />
        <StatCard
          label={t("stats.enabled")}
          value={`${enabledCount} / ${FEATURE_KEYS.length}`}
          emphasis="positive"
        />
        <StatCard
          label={t("stats.overridden")}
          value={String(overriddenCount)}
          hint={t("stats.overriddenHint")}
        />
      </div>

      <div className="flex flex-col gap-3">
        {resolved.map((row) => (
          <FeatureRow key={row.key} row={row} />
        ))}
      </div>
    </div>
  );
}

function StatCard(props: {
  label: string;
  value: string;
  emphasis?: "positive";
  hint?: string;
}) {
  return (
    <Card className="glass">
      <CardContent className="p-4">
        <div className="label-meta">{props.label}</div>
        <div
          className={`mt-1 font-display text-2xl font-semibold tabular-nums ${
            props.emphasis === "positive" ? "text-emerald-600 dark:text-emerald-400" : ""
          }`}
        >
          {props.value}
        </div>
        {props.hint && (
          <p className="mt-1 text-xs text-muted-foreground">{props.hint}</p>
        )}
      </CardContent>
    </Card>
  );
}

function FeatureRow({
  row,
}: {
  row: {
    key: FeatureKey;
    meta: (typeof FEATURE_REGISTRY)[FeatureKey];
    enabled: boolean;
    isOverridden: boolean;
    notes: string | null;
    updatedAt: string | null;
  };
}) {
  return (
    <Card className="glass">
      <CardContent className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-medium">{row.meta.label}</div>
            <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {row.key}
            </code>
            {!row.isOverridden && (
              <Badge variant="outline" className="text-[10px]">
                default
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {row.meta.description}
          </p>
          {row.notes && (
            <p className="mt-1 text-xs italic text-muted-foreground">
              &ldquo;{row.notes}&rdquo;
            </p>
          )}
          {row.updatedAt && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              Terakhir diubah{" "}
              {new Date(row.updatedAt).toLocaleDateString("id-ID", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </p>
          )}
        </div>
        <StatusPill enabled={row.enabled} />
      </CardContent>
    </Card>
  );
}

function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      role="status"
      aria-label={enabled ? "Aktif" : "Nonaktif"}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        enabled
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${
          enabled ? "bg-emerald-500" : "bg-zinc-400"
        }`}
      />
      {enabled ? "Aktif" : "Nonaktif"}
    </span>
  );
}
