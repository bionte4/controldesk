"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { createTenantAction } from "@/app/(super-admin)/super-admin/actions";

type CreateResult = {
  tenant_id: string;
  employee_id: string;
  admin_user_id: string;
  temporary_password: string;
  password_auto_generated: boolean;
  welcome_email_subject: string;
  welcome_email_body: string;
};

export function NewTenantForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [copied, setCopied] = useState<"none" | "subject" | "body" | "password">(
    "none",
  );

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const payload = {
        slug: String(formData.get("slug") ?? ""),
        name: String(formData.get("name") ?? ""),
        admin_email: String(formData.get("admin_email") ?? ""),
        admin_name: String(formData.get("admin_name") ?? ""),
        admin_password:
          String(formData.get("admin_password") ?? "").trim() || undefined,
      };
      const res = await createTenantAction(payload);
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setResult(res.data);
    });
  };

  const copy = async (
    text: string,
    tag: "subject" | "body" | "password",
  ) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied("none"), 1500);
    } catch {
      // Clipboard blocked (insecure origin, permission denied) — fall
      // back to select + user Cmd+C.
    }
  };

  if (result) {
    return (
      <div className="space-y-6 rounded-xl border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-900 dark:bg-emerald-950/40">
        <div>
          <h2 className="text-lg font-semibold text-emerald-800 dark:text-emerald-200">
            ✓ Tenant berhasil di-provision
          </h2>
          <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
            Salin kredensial di bawah + kirim welcome email secara manual.
            Password ini <strong>tidak akan ditampilkan ulang</strong>.
          </p>
        </div>

        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium text-zinc-600 dark:text-zinc-400">
              Tenant ID
            </dt>
            <dd className="font-mono text-xs">{result.tenant_id}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-600 dark:text-zinc-400">
              Employee ID (admin)
            </dt>
            <dd className="font-mono text-xs">{result.employee_id}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-600 dark:text-zinc-400">
              Auth user ID
            </dt>
            <dd className="font-mono text-xs">{result.admin_user_id}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-600 dark:text-zinc-400">
              Password{" "}
              {result.password_auto_generated ? "(auto-generated)" : "(dari input)"}
            </dt>
            <dd className="flex items-center gap-2">
              <code className="rounded bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                {result.temporary_password}
              </code>
              <button
                type="button"
                onClick={() => copy(result.temporary_password, "password")}
                className="text-xs text-indigo-600 hover:underline"
              >
                {copied === "password" ? "✓ Tersalin" : "Salin"}
              </button>
            </dd>
          </div>
        </dl>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              Welcome email — kirim manual
            </h3>
            <button
              type="button"
              onClick={() =>
                copy(
                  `${result.welcome_email_subject}\n\n${result.welcome_email_body}`,
                  "body",
                )
              }
              className="text-xs text-indigo-600 hover:underline"
            >
              {copied === "body" ? "✓ Tersalin" : "Salin subject + body"}
            </button>
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Subject
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                readOnly
                value={result.welcome_email_subject}
                className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-1.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                type="button"
                onClick={() => copy(result.welcome_email_subject, "subject")}
                className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {copied === "subject" ? "✓" : "Salin"}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Body
            </label>
            <textarea
              readOnly
              value={result.welcome_email_body}
              rows={16}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => router.push(`/super-admin/tenants/${result.tenant_id}`)}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Lihat detail tenant →
          </button>
          <button
            type="button"
            onClick={() => setResult(null)}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Provision tenant lagi
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="space-y-5">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
        >
          {error}
        </div>
      )}

      <Field
        label="Slug (subdomain)"
        name="slug"
        placeholder="acme"
        hint="Lowercase alfanumerik + hyphen, 2–63 char. Reserved: www/app/api/admin/auth/docs."
        required
      />
      <Field
        label="Nama organisasi"
        name="name"
        placeholder="PT Acme Sejahtera Nusantara"
        required
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Email Tenant Admin"
          name="admin_email"
          type="email"
          placeholder="admin@acme.co.id"
          required
        />
        <Field
          label="Nama Tenant Admin"
          name="admin_name"
          placeholder="Budi Santoso"
          required
        />
      </div>
      <Field
        label="Password (opsional)"
        name="admin_password"
        type="text"
        placeholder="Kosongkan untuk auto-generate 32-char"
        hint="Minimum 12 karakter. Kalau kosong, sistem akan generate base64url."
      />

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
        >
          {isPending ? "Memproses…" : "Provision tenant"}
        </button>
      </div>
    </form>
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
