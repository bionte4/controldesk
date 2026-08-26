import Link from "next/link";
import { notFound } from "next/navigation";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  FEATURE_KEYS,
  FEATURE_REGISTRY,
  defaultFor,
} from "@/lib/ops/feature-flags";
import { TenantStatusPanel } from "@/components/super-admin/tenant-status-panel";
import { FeatureFlagToggle } from "@/components/super-admin/feature-flag-toggle";
import { CommercialControlPanel } from "@/components/super-admin/commercial-control-panel";

export const dynamic = "force-dynamic";

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServiceRoleClient();
  // Migration-forward client for the commercial control-plane tables added
  // in 0104. Generated Supabase types can be refreshed after DB migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commercialDb = supabase as any;

  const [{ data: tenant }, { data: flagsRaw }] = await Promise.all([
    supabase
      .from("tenants")
      .select("id, slug, name, status, plan, trial_ends_at, idle_timeout_minutes, idle_warning_minutes, absolute_session_minutes, created_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("tenant_feature_flags")
      .select("feature_key, enabled, notes, updated_at")
      .eq("tenant_id", id),
  ]);

  if (!tenant) notFound();

  const [
    { count: empCount },
    { count: projectCount },
    { count: clientCount },
    { count: caCount },
    { data: recentAudit },
    { data: commercialProfile },
    { data: onboarding },
    { data: subscription },
    { data: usage },
    { data: overrides },
    { data: invoices },
    { data: storedHealth },
  ] = await Promise.all([
    supabase
      .from("employees")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id),
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id),
    supabase
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id),
    supabase
      .from("cash_advances")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id),
    supabase
      .from("platform_admin_audit_logs")
      .select(
        "id, actor_email, action_type, resource_name, new_values, metadata, created_at",
      )
      .eq("target_tenant_id", tenant.id)
      .order("created_at", { ascending: false })
      .limit(10),
    commercialDb.from("tenant_commercial_profiles").select("*").eq("tenant_id", id).maybeSingle(),
    commercialDb.from("tenant_onboarding").select("*").eq("tenant_id", id).maybeSingle(),
    commercialDb.from("tenant_subscriptions").select("*").eq("tenant_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    commercialDb.from("tenant_current_usage").select("*").eq("tenant_id", id).maybeSingle(),
    commercialDb.from("tenant_entitlement_overrides").select("*").eq("tenant_id", id).order("capability_key"),
    commercialDb.from("tenant_invoices").select("*").eq("tenant_id", id).order("created_at", { ascending: false }).limit(20),
    commercialDb.from("tenant_health_snapshots").select("*").eq("tenant_id", id).order("calculated_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const effectivePlan = subscription?.plan_code ??
    (tenant.plan === "starter" ? "field_control" : tenant.plan === "pro" ? "project_margin" : tenant.plan === "enterprise" ? "service_governance" : "trial");
  const { data: planEntitlements } = await commercialDb
    .from("saas_plan_entitlements")
    .select("*")
    .eq("plan_code", effectivePlan)
    .order("capability_key");

  const activeUsers = Number(usage?.active_users ?? 0);
  const onboardingStatus = onboarding?.status ?? "new";
  const liveReasons: string[] = [];
  let liveScore = 100;
  if (activeUsers < 5) { liveScore -= 25; liveReasons.push("Kurang dari 5 pengguna aktif"); }
  if (Number(usage?.cash_advances_total ?? 0) === 0) { liveScore -= 20; liveReasons.push("Belum ada cash advance diproses"); }
  if (onboardingStatus === "stalled") { liveScore -= 30; liveReasons.push("Onboarding stalled"); }
  if (onboardingStatus !== "activated") { liveScore -= 10; liveReasons.push("Business activation belum selesai"); }
  if (subscription?.status === "past_due") { liveScore -= 25; liveReasons.push("Subscription past due"); }
  const liveHealth = storedHealth ?? {
    score: Math.max(0, liveScore),
    status: liveScore >= 75 ? "healthy" : liveScore >= 45 ? "attention" : "at_risk",
    reasons: liveReasons.length ? liveReasons : ["Seluruh rule dasar terpenuhi"],
  };

  const flagsByKey = new Map(
    (flagsRaw ?? []).map((r) => [r.feature_key, r]),
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/super-admin/tenants"
          className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← Back to tenants
        </Link>
        <div className="mt-2 flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            {tenant.name}
          </h1>
          <code className="rounded bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
            {tenant.slug}
          </code>
        </div>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Created{" "}
          {new Date(tenant.created_at).toLocaleString("id-ID", {
            dateStyle: "long",
            timeStyle: "short",
          })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Employees" value={empCount ?? 0} />
        <StatCard label="Clients" value={clientCount ?? 0} />
        <StatCard label="Projects" value={projectCount ?? 0} />
        <StatCard label="Cash Advances" value={caCount ?? 0} />
      </div>

      <TenantStatusPanel
        tenantId={tenant.id}
        tenantSlug={tenant.slug}
        status={tenant.status}
      />

      <CommercialControlPanel
        data={{
          tenantId: tenant.id,
          profile: commercialProfile,
          onboarding,
          subscription,
          usage,
          entitlements: planEntitlements ?? [],
          overrides: overrides ?? [],
          invoices: invoices ?? [],
          health: liveHealth,
          sessionPolicy: {
            idle_timeout_minutes: tenant.idle_timeout_minutes,
            idle_warning_minutes: tenant.idle_warning_minutes,
            absolute_session_minutes: tenant.absolute_session_minutes,
          },
        }}
      />

      <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Feature flags</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Per-tenant feature gating (Fase 3, migration 0077). Missing
            row = default from registry. Toggle logs to{" "}
            <code>platform_admin_audit_logs</code>.
          </p>
        </div>
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {FEATURE_KEYS.map((key) => {
            const row = flagsByKey.get(key);
            const currentEnabled = row?.enabled ?? defaultFor(key);
            const meta = FEATURE_REGISTRY[key];
            return (
              <li key={key} className="flex items-start justify-between py-4">
                <div className="min-w-0 flex-1 pr-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                      {meta.label}
                    </span>
                    <code className="text-xs text-zinc-500">{key}</code>
                    {!row && (
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase text-zinc-500 dark:bg-zinc-800">
                        default
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {meta.description}
                  </p>
                  {row?.notes && (
                    <p className="mt-1 text-xs italic text-zinc-400">
                      {row.notes}
                    </p>
                  )}
                </div>
                <FeatureFlagToggle
                  tenantId={tenant.id}
                  featureKey={key}
                  enabled={currentEnabled}
                />
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-lg font-semibold">
          Recent platform-admin actions
        </h2>
        {!recentAudit || recentAudit.length === 0 ? (
          <p className="text-sm text-zinc-500">Belum ada aksi ter-log.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {recentAudit.map((a) => (
              <li
                key={a.id}
                className="rounded border border-zinc-100 px-3 py-2 dark:border-zinc-800"
              >
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>
                    <strong>{a.actor_email ?? "unknown"}</strong> ·{" "}
                    {a.action_type} · {a.resource_name}
                  </span>
                  <time dateTime={a.created_at}>
                    {new Date(a.created_at).toLocaleString("id-ID", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </time>
                </div>
                {a.new_values && (
                  <pre className="mt-1 whitespace-pre-wrap text-xs">
                    {JSON.stringify(a.new_values, null, 2)}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatCard(props: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {props.label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {props.value}
      </div>
    </div>
  );
}
