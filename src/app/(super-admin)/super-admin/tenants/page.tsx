import Link from "next/link";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Cross-tenant listing page (Fase 2, migration 0077).
 *
 * The layout above has already enforced platform admin membership, so
 * this component can use service-role directly without an additional
 * gate. Rows are ordered by created_at desc so recent tenants land at
 * the top — the operational hot spot when onboarding a new customer.
 */
export default async function TenantsListPage() {
  const supabase = createServiceRoleClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commercialDb = supabase as any;

  const { data: tenants, error } = await supabase
    .from("tenants")
    .select("id, slug, name, status, plan, trial_ends_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
        <div className="font-semibold">Gagal memuat daftar tenants.</div>
        <div className="mt-1 text-xs">{error.message}</div>
      </div>
    );
  }

  const rows = tenants ?? [];

  // Enrich with per-tenant counts. One round-trip each — acceptable at
  // the small tenant counts this surface handles. Move to a single
  // aggregate view if the list grows above ~200 rows.
  const enriched = await Promise.all(
    rows.map(async (t) => {
      const [emp, projects, subscription, onboarding, health] = await Promise.all([
        supabase
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", t.id),
        supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", t.id),
        commercialDb.from("tenant_subscriptions").select("plan_code,status,renewal_date,grace_ends_at,read_only_at,suspend_at").eq("tenant_id", t.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        commercialDb.from("tenant_onboarding").select("status,pilot_end_date,decision_date").eq("tenant_id", t.id).maybeSingle(),
        commercialDb.from("tenant_health_snapshots").select("status,score").eq("tenant_id", t.id).order("calculated_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      return {
        ...t,
        employee_count: emp.count ?? 0,
        project_count: projects.count ?? 0,
        subscription: subscription.data,
        onboarding: onboarding.data,
        health: health.data,
      };
    }),
  );

  const active = enriched.filter((t) => t.status === "active").length;
  const suspended = enriched.filter((t) => t.status === "suspended").length;
  const terminated = enriched.filter((t) => t.status === "terminated").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            Tenants
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {enriched.length} total · {active} active · {suspended} suspended ·{" "}
            {terminated} terminated
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Commercial, onboarding, health, renewal, dan access lifecycle dalam satu control plane.
          </p>
        </div>
        <Link
          href="/super-admin/tenants/new"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500"
        >
          + Provision tenant baru
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">Nama</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Subscription</th>
              <th className="px-4 py-3">Onboarding</th>
              <th className="px-4 py-3">Health</th>
              <th className="px-4 py-3 text-right">Employees</th>
              <th className="px-4 py-3 text-right">Projects</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 sr-only">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {enriched.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-400"
                >
                  Belum ada tenant. Klik{" "}
                  <Link
                    href="/super-admin/tenants/new"
                    className="text-indigo-600 hover:underline"
                  >
                    Provision tenant baru
                  </Link>{" "}
                  untuk mulai.
                </td>
              </tr>
            )}
            {enriched.map((t) => (
              <tr
                key={t.id}
                className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <td className="px-4 py-3 font-mono text-xs">
                  <Link
                    href={`/super-admin/tenants/${t.id}`}
                    className="text-indigo-600 hover:underline"
                  >
                    {t.slug}
                  </Link>
                </td>
                <td className="px-4 py-3 font-medium">{t.name}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={t.status} />
                </td>
                <td className="px-4 py-3 text-xs">
                  <div className="font-medium">{t.subscription?.plan_code ?? t.plan}</div>
                  <div className="text-zinc-500">{t.subscription?.status ?? (t.plan === "trial" ? "trialing" : "active")}</div>
                </td>
                <td className="px-4 py-3 text-xs">{t.onboarding?.status ?? "new"}</td>
                <td className="px-4 py-3 text-xs">
                  {t.health ? `${t.health.status} · ${t.health.score}` : "not calculated"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {t.employee_count}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {t.project_count}
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                  {new Date(t.created_at).toLocaleDateString("id-ID", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/super-admin/tenants/${t.id}`}
                    className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                  >
                    Manage →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    suspended:
      "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    terminated:
      "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
        styles[status] ?? "bg-zinc-100 text-zinc-800"
      }`}
    >
      {status}
    </span>
  );
}
