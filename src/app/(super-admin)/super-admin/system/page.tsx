import { headers } from "next/headers";

import { requirePlatformAdmin } from "@/lib/auth/platform-admin-session";
import packageJson from "../../../../../package.json";

import { SystemHealthLive } from "./system-health-live";

/**
 * Platform ops — system health page (rules §21).
 *
 * The super-admin layout already enforces `requirePlatformAdmin()`, but
 * we re-invoke it here so the RSC has the admin identity in scope for
 * observability logging if we add it later, and so a direct
 * bookmark to `/super-admin/system` continues to redirect if the caller
 * ever loses the platform-admin claim mid-session.
 *
 * Version metadata is read at request time from `process.env` (build-time
 * bake) and `packageJson` (compile-time). We render this server-side so
 * the browser doesn't need a second round-trip to `/api/version` — it
 * only polls the LIVE data (`/api/ready`) on the client.
 *
 * The uptime figure from `process.uptime()` is intentionally rendered
 * on the SERVER (not fetched from a client-side setInterval) because
 * a browser has no way to know when THIS Node process booted; asking
 * the client to keep track would drift. Every render is a fresh RSC
 * so uptime is accurate at page-load time; the live component below
 * shows "last checked N seconds ago" for reachability freshness.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SystemHealthPage() {
  await requirePlatformAdmin();
  // Force a fresh headers read so the page opts out of static caching
  // (belt-and-suspenders alongside `dynamic = "force-dynamic"`).
  await headers();

  const now = new Date();
  const uptimeSeconds = Math.round(process.uptime());
  const uptimeText = formatUptime(uptimeSeconds);

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          System health
        </h1>
        <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Real-time readiness of the ControlDesk backend — Node.js
          process, Supabase Postgres, and Redis. The page refreshes
          itself every 10 seconds while the tab is visible.
        </p>
      </header>

      {/* Build & runtime metadata — server-rendered once. */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Meta label="Version" value={packageJson.version} />
        <Meta
          label="Commit"
          value={(process.env.BUILD_SHA ?? "dev").slice(0, 12)}
          mono
        />
        <Meta label="Environment" value={process.env.NODE_ENV ?? "development"} />
        <Meta label="Uptime" value={uptimeText} />
      </section>

      {/* Live traffic-light — client polls /api/ready. */}
      <SystemHealthLive initialFetchedAtIso={now.toISOString()} />
    </div>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div
        className={`mt-1 text-sm ${
          mono
            ? "font-mono text-zinc-900 dark:text-zinc-100"
            : "font-medium text-zinc-900 dark:text-zinc-100"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ${seconds % 60}s`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}
