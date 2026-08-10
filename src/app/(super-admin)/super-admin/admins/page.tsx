import Link from "next/link";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentPlatformAdmin } from "@/lib/auth/platform-admin-session";
import { AdminActiveToggle } from "@/components/super-admin/admin-active-toggle";

export const dynamic = "force-dynamic";

/**
 * Platform admin management (Fase 5).
 *
 * Layout has already enforced platform admin membership. This page
 * lists all rows in `public.platform_admins` (active + inactive) so
 * an operator can:
 *   • Add a new platform admin (either promote existing or create
 *     brand-new auth user + row).
 *   • Deactivate a peer (soft — sets is_active=false; auth user
 *     preserved so they can still be a tenant user).
 *   • Reactivate a previously-deactivated admin.
 *
 * Safety: an operator can't deactivate themselves — the button is
 * disabled client-side AND the server action blocks the case. To
 * hard-remove, run SQL directly.
 */
export default async function PlatformAdminsPage() {
  const supabase = createServiceRoleClient();
  const [me, { data: admins, error }] = await Promise.all([
    getCurrentPlatformAdmin(),
    supabase
      .from("platform_admins")
      .select("user_id, email, full_name, is_active, created_at, created_by")
      .order("created_at", { ascending: false }),
  ]);

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
        <div className="font-semibold">Gagal memuat daftar platform admin.</div>
        <div className="mt-1 text-xs">{error.message}</div>
      </div>
    );
  }

  const rows = admins ?? [];
  const activeCount = rows.filter((r) => r.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            Platform admins
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {rows.length} total · {activeCount} aktif · {rows.length - activeCount}{" "}
            nonaktif. Aksi diaudit ke{" "}
            <code>platform_admin_audit_logs</code>.
          </p>
        </div>
        <Link
          href="/super-admin/admins/new"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500"
        >
          + Tambah platform admin
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Nama</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Ditambahkan</th>
              <th className="px-4 py-3 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-400"
                >
                  Belum ada platform admin. Klik{" "}
                  <Link
                    href="/super-admin/admins/new"
                    className="text-indigo-600 hover:underline"
                  >
                    Tambah platform admin
                  </Link>{" "}
                  untuk mulai.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const isSelf = me?.user_id === r.user_id;
              return (
                <tr
                  key={r.user_id}
                  className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    {r.email}
                    {isSelf && (
                      <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                        anda
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{r.full_name}</td>
                  <td className="px-4 py-3">
                    <StatusBadge active={r.is_active} />
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                    {new Date(r.created_at).toLocaleDateString("id-ID", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <AdminActiveToggle
                      userId={r.user_id}
                      email={r.email}
                      isActive={r.is_active}
                      isSelf={isSelf}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <div className="font-semibold">Catatan keamanan</div>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            <strong>Non-aktifkan diri sendiri</strong> di-block baik di UI
            maupun di server action. Minta platform admin lain kalau
            perlu.
          </li>
          <li>
            Deaktivasi hanya menyembunyikan JWT claim{" "}
            <code>is_platform_admin</code>. Auth user tetap ada dan bisa
            login sebagai tenant user (kalau punya row di{" "}
            <code>employees</code>).
          </li>
          <li>
            Untuk hard-delete, jalankan SQL langsung — audit log tetap
            immutable per rules §3.
          </li>
        </ul>
      </div>
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
        active
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      }`}
    >
      {active ? "aktif" : "nonaktif"}
    </span>
  );
}
