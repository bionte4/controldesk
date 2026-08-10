"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  createPlatformAdminAction,
  promotePlatformAdminAction,
} from "@/app/(super-admin)/super-admin/actions";

type Mode = "promote" | "create";

type PromoteResult = {
  user_id: string;
  email: string;
  reactivated: boolean;
};

type CreateResult = {
  user_id: string;
  email: string;
  temporary_password: string;
  password_auto_generated: boolean;
};

export function NewPlatformAdminForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("promote");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [promoteResult, setPromoteResult] = useState<PromoteResult | null>(
    null,
  );
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const [copied, setCopied] = useState(false);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const handlePromote = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const res = await promotePlatformAdminAction({
        email: String(formData.get("email") ?? ""),
        full_name: String(formData.get("full_name") ?? ""),
      });
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setPromoteResult(res.data);
    });
  };

  const handleCreate = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const res = await createPlatformAdminAction({
        email: String(formData.get("email") ?? ""),
        full_name: String(formData.get("full_name") ?? ""),
        password: String(formData.get("password") ?? "").trim() || undefined,
      });
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setCreateResult(res.data);
    });
  };

  if (promoteResult) {
    return (
      <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-900 dark:bg-emerald-950/40">
        <div>
          <h2 className="text-lg font-semibold text-emerald-800 dark:text-emerald-200">
            {promoteResult.reactivated
              ? "✓ Platform admin diaktifkan kembali"
              : "✓ User berhasil di-promote"}
          </h2>
          <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
            <strong>{promoteResult.email}</strong> sekarang platform admin
            aktif. JWT claim baru akan aktif setelah user tersebut
            logout+login lagi (atau setelah token refresh berikutnya).
          </p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.push("/super-admin/admins")}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Kembali ke daftar
          </button>
          <button
            type="button"
            onClick={() => setPromoteResult(null)}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Tambah admin lagi
          </button>
        </div>
      </div>
    );
  }

  if (createResult) {
    return (
      <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-900 dark:bg-emerald-950/40">
        <div>
          <h2 className="text-lg font-semibold text-emerald-800 dark:text-emerald-200">
            ✓ Platform admin baru berhasil dibuat
          </h2>
          <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
            Salin password di bawah + kirim manual ke{" "}
            <strong>{createResult.email}</strong>. Password ini{" "}
            <strong>tidak akan ditampilkan ulang</strong>.
          </p>
        </div>
        <dl className="grid grid-cols-1 gap-3 text-sm">
          <div>
            <dt className="font-medium text-zinc-600 dark:text-zinc-400">
              Auth user ID
            </dt>
            <dd className="font-mono text-xs">{createResult.user_id}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-600 dark:text-zinc-400">
              Password{" "}
              {createResult.password_auto_generated
                ? "(auto-generated)"
                : "(dari input)"}
            </dt>
            <dd className="flex items-center gap-2">
              <code className="rounded bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                {createResult.temporary_password}
              </code>
              <button
                type="button"
                onClick={() => copy(createResult.temporary_password)}
                className="text-xs text-indigo-600 hover:underline"
              >
                {copied ? "✓ Tersalin" : "Salin"}
              </button>
            </dd>
          </div>
        </dl>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.push("/super-admin/admins")}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Kembali ke daftar
          </button>
          <button
            type="button"
            onClick={() => {
              setCreateResult(null);
              setPromoteResult(null);
            }}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Tambah admin lagi
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-700 dark:bg-zinc-800">
        <ModeTab
          active={mode === "promote"}
          onClick={() => setMode("promote")}
          label="Promote existing user"
        />
        <ModeTab
          active={mode === "create"}
          onClick={() => setMode("create")}
          label="Buat akun baru"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
        >
          {error}
        </div>
      )}

      {mode === "promote" ? (
        <form action={handlePromote} className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Menaikkan user yang sudah punya row di <code>auth.users</code>{" "}
            menjadi platform admin. Aman — tidak menciptakan credential
            baru. Kalau row <code>platform_admins</code> lama ada
            (deactivated), akan otomatis re-aktivasi.
          </p>
          <Field
            label="Email user yang sudah ada"
            name="email"
            type="email"
            placeholder="ops@controldesk.app"
            required
          />
          <Field
            label="Nama tampilan"
            name="full_name"
            placeholder="Nama Ops"
            required
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isPending ? "Memproses…" : "Promote ke platform admin"}
            </button>
          </div>
        </form>
      ) : (
        <form action={handleCreate} className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Membuat auth user baru + row <code>platform_admins</code>{" "}
            dalam satu operasi. Password akan di-generate otomatis (kalau
            tidak diisi). Kirim password ke user secara aman lewat channel
            terpisah.
          </p>
          <Field
            label="Email"
            name="email"
            type="email"
            placeholder="baru@controldesk.app"
            required
          />
          <Field
            label="Nama"
            name="full_name"
            placeholder="Nama Ops"
            required
          />
          <Field
            label="Password (opsional)"
            name="password"
            type="text"
            placeholder="Kosongkan untuk auto-generate 32-char"
            hint="Minimum 12 karakter kalau di-set manual."
          />
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {isPending ? "Memproses…" : "Buat platform admin baru"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      }`}
    >
      {label}
    </button>
  );
}

function Field(props: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
        {props.label}
        {props.required && <span className="text-rose-500"> *</span>}
      </label>
      <input
        name={props.name}
        type={props.type ?? "text"}
        placeholder={props.placeholder}
        required={props.required}
        className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900"
      />
      {props.hint && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {props.hint}
        </p>
      )}
    </div>
  );
}
