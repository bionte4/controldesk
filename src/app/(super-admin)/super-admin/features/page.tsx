import Link from "next/link";

import { requirePlatformAdmin } from "@/lib/auth/platform-admin-session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { FEATURE_REGISTRY, FEATURE_KEYS } from "@/lib/ops/feature-flags";
import { BulkFeatureToggleCard } from "@/components/super-admin/bulk-feature-toggle-card";

export const metadata = { title: "Feature flags — Super Admin" };
export const dynamic = "force-dynamic";

/**
 * Bulk feature-flag control panel (Fase 6.2, migration 0077 +
 * bulkToggleFeatureFlagAction).
 *
 * Cross-tenant view of every registered feature. For each flag we
 * compute adoption stats:
 *   • overridden_on  — rows explicitly enabled
 *   • overridden_off — rows explicitly disabled
 *   • default        — tenants without a row (uses FEATURE_REGISTRY default)
 *
 * The operator can then bulk-flip via `<BulkFeatureToggleCard>`:
 *   • Flip ALL tenants ON/OFF (nuclear).
 *   • Flip only ACTIVE tenants (skip suspended/terminated).
 *   • Flip a specific list (canary — comma-separated slugs).
 *
 * Per-tenant granular toggle stays at /super-admin/tenants/{id} — this
 * page is intentionally about *fleet* operations.
 */
export default async function BulkFeaturesPage() {
  await requirePlatformAdmin();

  const supa = createServiceRoleClient();

  const [tenantsRes, flagsRes] = await Promise.all([
    supa.from("tenants").select("id, slug, name, status"),
    supa.from("tenant_feature_flags").select("tenant_id, feature_key, enabled"),
  ]);

  const tenants = tenantsRes.data ?? [];
  const activeTenants = tenants.filter((t) => t.status === "active");
  const flags = flagsRes.data ?? [];

  // adoption[key] = { on: n, off: n, defaultCount: n }
  const adoption: Record<
    string,
    { on: number; off: number; defaultCount: number }
  > = {};
  for (const key of FEATURE_KEYS) {
    adoption[key] = { on: 0, off: 0, defaultCount: 0 };
  }
  const explicit = new Map<string, Map<string, boolean>>(); // feature_key → tenant_id → enabled
  for (const key of FEATURE_KEYS) {
    explicit.set(key, new Map());
  }
  for (const f of flags) {
    if (!FEATURE_KEYS.includes(f.feature_key as (typeof FEATURE_KEYS)[number]))
      continue;
    explicit.get(f.feature_key)!.set(f.tenant_id, f.enabled);
    if (f.enabled) adoption[f.feature_key]!.on += 1;
    else adoption[f.feature_key]!.off += 1;
  }
  for (const key of FEATURE_KEYS) {
    const explicitCount =
      adoption[key]!.on + adoption[key]!.off;
    adoption[key]!.defaultCount = tenants.length - explicitCount;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            Bulk feature flags
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
            Cross-tenant control panel. Toggle a feature untuk semua
            tenant sekaligus (nuclear), semua tenant aktif (safer), atau
            list spesifik (canary). Setiap operasi mencatat audit row
            per-tenant di <code>platform_admin_audit_logs</code> dengan{" "}
            <code>bulk_run_id</code> untuk reconciliation.
          </p>
        </div>
        <div className="text-right text-xs text-zinc-500 dark:text-zinc-500">
          <div>Total tenant: <strong>{tenants.length}</strong></div>
          <div>Aktif: <strong>{activeTenants.length}</strong></div>
          <Link
            href="/super-admin/tenants"
            className="mt-1 inline-block text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Kelola per-tenant →
          </Link>
        </div>
      </div>

      <div className="space-y-4">
        {FEATURE_KEYS.map((key) => {
          const meta = FEATURE_REGISTRY[key];
          const stats = adoption[key]!;
          return (
            <BulkFeatureToggleCard
              key={key}
              featureKey={key}
              label={meta.label}
              description={meta.description}
              defaultEnabled={meta.defaultEnabled}
              totalTenants={tenants.length}
              activeTenants={activeTenants.length}
              stats={stats}
              allTenantSlugs={tenants.map((t) => ({
                id: t.id,
                slug: t.slug,
                name: t.name,
                status: t.status,
              }))}
            />
          );
        })}
      </div>
    </div>
  );
}
