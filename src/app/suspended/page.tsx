export const dynamic = "force-dynamic";

/**
 * Suspended tenant page (Fase 2, migration 0077).
 *
 * Rendered when the proxy detects a tenant with status='suspended'.
 * Displayed on the tenant's own subdomain (proxy uses NextResponse.rewrite
 * so the URL stays as-is — user sees `acme.controldesk.app/whatever`
 * but the content is this generic page). Kept intentionally simple
 * so it renders even if downstream RSC infra is broken.
 */
export default async function SuspendedPage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>;
}) {
  const { slug } = await searchParams;
  return (
    <div className="flex min-h-svh items-center justify-center bg-zinc-50 p-6 dark:bg-zinc-950">
      <div className="max-w-lg space-y-4 rounded-xl border border-amber-200 bg-white p-8 text-center shadow-sm dark:border-amber-900 dark:bg-zinc-900">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-2xl dark:bg-amber-950">
          ⏸
        </div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Tenant sedang di-suspend
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Akses ke workspace{" "}
          {slug && (
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
              {slug}
            </code>
          )}{" "}
          untuk sementara dihentikan oleh tim platform ControlDesk.
          Data Anda aman — hanya login yang diblokir.
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Untuk reaktivasi atau informasi lebih lanjut, hubungi{" "}
          <a
            href="mailto:support@controldesk.app"
            className="text-indigo-600 underline hover:text-indigo-500"
          >
            support@controldesk.app
          </a>
          .
        </p>
      </div>
    </div>
  );
}
