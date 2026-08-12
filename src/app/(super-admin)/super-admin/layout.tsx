import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin-session";

/**
 * Layout for /super-admin/* (Fase 2, migration 0077).
 *
 * Served on the apex domain only — the proxy explicitly allows this
 * path through without a tenant claim check.
 *
 * `requirePlatformAdmin()` short-circuits any unauthenticated visitor
 * to `/login?next=/super-admin`, and any signed-in tenant user (no
 * platform admin claim) to `/?error=not_platform_admin`. So by the
 * time this layout renders its children, we KNOW the caller is a
 * legitimate platform admin.
 */
export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requirePlatformAdmin();

  return (
    <div className="flex min-h-svh flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link
              href="/super-admin/tenants"
              className="flex items-center gap-2 text-lg font-semibold text-indigo-600 dark:text-indigo-400"
            >
              <span className="rounded-md bg-indigo-600 px-2 py-0.5 text-xs font-bold text-white">
                SUPER
              </span>
              ControlDesk Admin
            </Link>
            <nav className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
              <Link
                href="/super-admin/tenants"
                className="hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Tenants
              </Link>
              <Link
                href="/super-admin/tenants/new"
                className="hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                + New tenant
              </Link>
              <Link
                href="/super-admin/features"
                className="hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Bulk features
              </Link>
              <Link
                href="/super-admin/admins"
                className="hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Admins
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="text-right">
              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                {admin.full_name}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {admin.email}
              </div>
            </div>
            <span
              aria-label="Platform admin"
              title="Platform admin"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
            >
              PA
            </span>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        {children}
      </main>
      <footer className="border-t border-zinc-200 px-6 py-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
        <div className="mx-auto max-w-7xl">
          Platform-admin surface — cross-tenant. Actions are audit-logged in{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-800">
            platform_admin_audit_logs
          </code>
          . See{" "}
          <a
            href="https://github.com/bontiharyanto/controldesk/blob/main/docs/ops/tenant-provisioning.md"
            className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
            target="_blank"
            rel="noreferrer"
          >
            runbook
          </a>
          .
        </div>
      </footer>
    </div>
  );
}
