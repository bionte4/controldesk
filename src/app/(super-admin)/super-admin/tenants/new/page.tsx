import { NewTenantForm } from "@/components/super-admin/new-tenant-form";

export default function NewTenantPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Provision tenant baru
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Wraps <code>pnpm tenant:create</code> as a form. Sama-sama panggil{" "}
          <code>provision_tenant()</code> RPC (atomic tx) — kalau gagal
          auth user auto-rollback. Setelah sukses, salin welcome email +
          setup DNS wildcard/CNAME untuk subdomain.
        </p>
      </div>
      <NewTenantForm />
    </div>
  );
}
