"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { requestSignupAction } from "../actions";

type SubmitState =
  | { kind: "idle" }
  | { kind: "sent"; email: string; ttlHours: number };

export function SignupForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const res = await requestSignupAction({
        slug: String(formData.get("slug") ?? ""),
        name: String(formData.get("name") ?? ""),
        admin_email: String(formData.get("admin_email") ?? ""),
        admin_name: String(formData.get("admin_name") ?? ""),
      });
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setState({ kind: "sent", email: res.data.email, ttlHours: res.data.ttlHours });
    });
  };

  if (state.kind === "sent") {
    return (
      <div className="space-y-4">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-emerald-100 text-3xl dark:bg-emerald-950">
          ✉️
        </div>
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            Periksa email Anda
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Kami sudah kirim link verifikasi ke{" "}
            <strong className="text-zinc-900 dark:text-zinc-100">
              {state.email}
            </strong>
            . Klik link di email tersebut untuk menyelesaikan pendaftaran.
          </p>
          <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-500">
            Link valid selama <strong>{state.ttlHours} jam</strong>. Kalau
            tidak menerima email dalam 5 menit, cek folder spam atau daftar
            ulang.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setState({ kind: "idle" })}
          className="w-full rounded-md border border-zinc-300 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Daftar workspace lain
        </button>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          Isi data workspace
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Kami akan kirim link verifikasi ke email admin sebelum
          workspace di-provision.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
        >
          {error}
        </div>
      )}

      <Field
        label="Nama organisasi"
        name="name"
        placeholder="PT Acme Sejahtera Nusantara"
        required
      />
      <Field
        label="Slug workspace"
        name="slug"
        placeholder="acme"
        hint="Lowercase alfanumerik + hyphen, 2–63 karakter. Ini jadi subdomain workspace Anda."
        prefix="https://"
        suffix=".controldesk.app"
        required
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Email admin"
          name="admin_email"
          type="email"
          placeholder="admin@acme.co.id"
          required
        />
        <Field
          label="Nama admin"
          name="admin_name"
          placeholder="Budi Santoso"
          required
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-indigo-600 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
      >
        {isPending ? "Memproses…" : "Daftar & kirim link verifikasi"}
      </button>

      <p className="text-center text-xs text-zinc-500 dark:text-zinc-500">
        Sudah punya workspace?{" "}
        <Link
          href="/login"
          className="text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Login di sini
        </Link>
        .
      </p>
    </form>
  );
}

function Field(props: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  hint?: string;
  prefix?: string;
  suffix?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
        {props.label}
        {props.required && <span className="text-rose-500"> *</span>}
      </label>
      <div className="mt-1 flex items-center rounded-md border border-zinc-300 bg-white shadow-sm focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900">
        {props.prefix && (
          <span className="pl-3 text-xs text-zinc-500 dark:text-zinc-400">
            {props.prefix}
          </span>
        )}
        <input
          name={props.name}
          type={props.type ?? "text"}
          placeholder={props.placeholder}
          required={props.required}
          autoComplete="off"
          className="flex-1 border-0 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-0"
        />
        {props.suffix && (
          <span className="pr-3 text-xs text-zinc-500 dark:text-zinc-400">
            {props.suffix}
          </span>
        )}
      </div>
      {props.hint && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {props.hint}
        </p>
      )}
    </div>
  );
}
