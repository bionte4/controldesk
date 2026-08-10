import Link from "next/link";

import { verifySignupAction } from "../../actions";
import { VerifyResultView } from "./_verify-result-view";

export const metadata = { title: "Verifikasi pendaftaran — ControlDesk" };
export const dynamic = "force-dynamic";

/**
 * Verify endpoint (Fase 6). Consumes a raw signup token from the URL.
 *
 * This route is a **Server Component** so the token validation +
 * tenant provisioning happen server-side on first load. Client-side
 * this would leak the token via a URL that survives in browser
 * history + analytics — server-side lets us render the outcome and
 * scrub the token from the URL bar via a `router.replace` in a
 * companion client component.
 *
 * Flow:
 *   1. RSC calls `verifySignupAction(rawToken)`.
 *   2. On success: hand off to `<VerifyResultView>` client component
 *      to (a) replace the URL with `/register-org/confirm?slug=…`
 *      so the token doesn't remain in history, (b) render the
 *      one-shot credentials panel with copy buttons.
 *   3. On failure: static error page with a link back to signup.
 */
export default async function VerifySignupPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const res = await verifySignupAction(token);

  if (!res.ok) {
    return (
      <div className="min-h-svh bg-zinc-50 dark:bg-zinc-950">
        <div className="mx-auto max-w-xl px-6 py-16">
          <div className="rounded-2xl border border-rose-200 bg-white p-8 dark:border-rose-900 dark:bg-zinc-900">
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-rose-100 text-2xl dark:bg-rose-950">
              ✕
            </div>
            <h1 className="mt-4 text-center text-xl font-semibold text-zinc-900 dark:text-zinc-100">
              Verifikasi gagal
            </h1>
            <p className="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400">
              {res.reason}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <Link
                href="/register-org"
                className="rounded-md bg-indigo-600 py-2 text-center text-sm font-medium text-white hover:bg-indigo-500"
              >
                Daftar ulang
              </Link>
              <Link
                href="/login"
                className="rounded-md border border-zinc-300 py-2 text-center text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Kembali ke login
              </Link>
            </div>
            <p className="mt-4 text-center text-xs text-zinc-500 dark:text-zinc-500">
              Kode error: <code>{res.code}</code>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <VerifyResultView data={res.data} />;
}
