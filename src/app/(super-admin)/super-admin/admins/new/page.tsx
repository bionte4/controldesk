import { NewPlatformAdminForm } from "@/components/super-admin/new-platform-admin-form";

export default function NewPlatformAdminPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          Tambah platform admin
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Ada dua cara: <strong>promote</strong> user yang sudah punya
          akun di <code>auth.users</code> (aman — tidak menciptakan
          credential baru), atau <strong>buat akun baru</strong> beserta
          password otomatis.
        </p>
      </div>
      <NewPlatformAdminForm />
    </div>
  );
}
