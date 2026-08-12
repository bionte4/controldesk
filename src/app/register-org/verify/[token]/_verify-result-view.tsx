"use client";

import { useEffect, useState } from "react";

import type { VerifiedSignup } from "../../actions";

export function VerifyResultView({ data }: { data: VerifiedSignup }) {
  const [copied, setCopied] = useState<"none" | "email" | "password" | "url">(
    "none",
  );

  // Scrub the token from the URL bar (and browser history) once the
  // RSC has already consumed it. `history.replaceState` avoids a
  // hard navigation so the RSC-rendered page stays visible.
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.history.replaceState(
        null,
        "",
        `/register-org/confirm?slug=${encodeURIComponent(data.slug)}`,
      );
    }
  }, [data.slug]);

  const copy = async (text: string, tag: "email" | "password" | "url") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied("none"), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <div className="min-h-svh bg-gradient-to-br from-emerald-50 via-white to-indigo-50 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-900">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <div className="rounded-2xl border border-emerald-200 bg-white p-8 shadow-lg dark:border-emerald-900 dark:bg-zinc-900">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-100 text-2xl dark:bg-emerald-950">
            ✓
          </div>
          <h1 className="mt-4 text-center text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            Workspace {data.tenant_name} siap
          </h1>
          <p className="mt-2 text-center text-sm text-zinc-600 dark:text-zinc-400">
            Uji coba 14 hari otomatis aktif. Simpan kredensial di bawah —
            <strong> password tidak akan ditampilkan ulang</strong>.
          </p>

          {data.password_email_status === "SENT" ? (
            <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-center text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              ✉ Salinan kredensial juga terkirim ke {data.admin_email}.
            </p>
          ) : (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-center text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              ⚠ Email kredensial belum terkirim (
              {data.password_email_status}). Salin manual sekarang — ini
              satu-satunya kesempatan.
            </p>
          )}

          <dl className="mt-6 space-y-4">
            <Row label="URL login">
              <a
                href={data.login_url}
                className="text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {data.login_url}
              </a>
              <CopyBtn
                onClick={() => copy(data.login_url, "url")}
                copied={copied === "url"}
              />
            </Row>
            <Row label="Email admin">
              <code className="font-mono text-sm">{data.admin_email}</code>
              <CopyBtn
                onClick={() => copy(data.admin_email, "email")}
                copied={copied === "email"}
              />
            </Row>
            <Row label="Password sementara">
              <code className="font-mono text-sm">
                {data.admin_password}
              </code>
              <CopyBtn
                onClick={() => copy(data.admin_password, "password")}
                copied={copied === "password"}
              />
            </Row>
          </dl>

          <div className="mt-6 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-xs text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">
            <div className="font-semibold">Langkah selanjutnya</div>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">
              <li>Login menggunakan URL + kredensial di atas.</li>
              <li>Ganti password default (Profile menu).</li>
              <li>Undang tim Anda (Settings → Users).</li>
              <li>Setup SMTP tenant (Settings → Integrations → Email).</li>
            </ol>
          </div>

          <a
            href={data.login_url}
            className="mt-6 block w-full rounded-md bg-indigo-600 py-2.5 text-center text-sm font-medium text-white hover:bg-indigo-500"
          >
            Login ke workspace →
          </a>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="flex-1">
        <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {label}
        </dt>
        <dd className="mt-0.5 min-w-0 break-all">{children}</dd>
      </div>
    </div>
  );
}

function CopyBtn({ onClick, copied }: { onClick: () => void; copied: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      {copied ? "✓" : "Salin"}
    </button>
  );
}
