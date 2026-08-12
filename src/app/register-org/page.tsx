import Link from "next/link";

import { SignupForm } from "./_components/signup-form";

export const metadata = {
  title: "Daftar workspace baru — ControlDesk",
  description:
    "Buat workspace ControlDesk baru untuk organisasi Anda. Uji coba 14 hari, tanpa kartu kredit.",
};

export const dynamic = "force-dynamic";

/**
 * Public self-signup page (Fase 6). Served on the apex domain — the
 * proxy allow-lists /register-org so no auth is required.
 *
 * Two-column: marketing copy on the left, form on the right. Form
 * hits `requestSignupAction` which:
 *   1. Rate-limits per IP + globally.
 *   2. Validates + reserves-slug + persists a `tenant_signup_requests`
 *      row.
 *   3. Emails a verification link.
 * After submit, the client-side form flips to a confirmation screen
 * ("periksa email Anda") — no redirect so the user can screenshot.
 */
export default function RegisterOrgPage() {
  return (
    <div className="min-h-svh bg-gradient-to-br from-indigo-50 via-white to-emerald-50 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-900">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-2 lg:gap-16 lg:py-24">
        <div className="flex flex-col justify-center space-y-6">
          <div>
            <Link
              href="/"
              className="text-xs font-medium uppercase tracking-wider text-indigo-600 hover:underline dark:text-indigo-400"
            >
              ← Kembali ke ControlDesk
            </Link>
            <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 lg:text-5xl">
              Daftar workspace baru
            </h1>
            <p className="mt-3 max-w-lg text-lg text-zinc-600 dark:text-zinc-400">
              Buat workspace ControlDesk untuk organisasi Anda dalam 2
              menit. Uji coba{" "}
              <strong className="text-emerald-700 dark:text-emerald-400">
                14 hari
              </strong>
              , semua fitur terbuka, tanpa kartu kredit.
            </p>
          </div>

          <ul className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
            {[
              "Subdomain khusus (misal acme.controldesk.app).",
              "Chart of Accounts default siap pakai — bisa disesuaikan.",
              "Multi-role built-in: Admin, Finance, PM, Supervisor, Employee, Director.",
              "Approval otomatis dengan ambang IDR yang bisa Anda tuning.",
              "Audit log 7-tahun sesuai kompliance keuangan Indonesia.",
              "Isolasi tenant per baris (Row Level Security PostgreSQL).",
            ].map((line) => (
              <li key={line} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                >
                  ✓
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="font-semibold">Yang perlu Anda siapkan</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>Email valid untuk admin (verifikasi via link 24 jam).</li>
              <li>Slug workspace unik (huruf kecil + angka + tanda hubung).</li>
              <li>
                Setelah verifikasi, kredensial admin dikirim via email +
                ditampilkan sekali di layar.
              </li>
            </ul>
          </div>
        </div>

        <div className="flex items-center">
          <div className="w-full rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-900 lg:p-8">
            <SignupForm />
          </div>
        </div>
      </div>

      <footer className="border-t border-zinc-200 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
        Dengan mendaftar, Anda menyetujui{" "}
        <a
          href="https://www.controldesk.app/terms"
          className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
          target="_blank"
          rel="noreferrer"
        >
          Terms
        </a>{" "}
        dan{" "}
        <a
          href="https://www.controldesk.app/privacy"
          className="underline hover:text-zinc-700 dark:hover:text-zinc-300"
          target="_blank"
          rel="noreferrer"
        >
          Privacy Policy
        </a>{" "}
        ControlDesk.
      </footer>
    </div>
  );
}
