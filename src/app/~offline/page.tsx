import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";

/**
 * Offline fallback shell (rules §17).
 *
 * The Service Worker (see `src/sw.ts`) rewrites failed document
 * navigations to this route. That means the user gets a branded page
 * instead of Chrome's raw "No internet" screen when they lose
 * connection mid-navigation to a page that isn't precached.
 *
 * Everything on this page MUST be static — no server actions, no DB
 * reads, no session lookup. It's the last thing the SW can render when
 * the network is dead, so any dependency on backend availability would
 * defeat the purpose.
 *
 * The `~offline` (tilde) path segment is a Serwist convention — it
 * avoids colliding with any tenant route or real content path.
 */
export const metadata: Metadata = {
  title: "Offline · ControlDesk",
  description: "Tidak ada koneksi internet — halaman offline ControlDesk.",
};

// Force static — this page must render without any server dependency.
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-br from-zinc-950 via-zinc-900 to-indigo-950 px-6 text-zinc-100">
      <section className="flex max-w-md flex-col items-center gap-6 text-center">
        <div className="grid size-16 place-items-center rounded-2xl bg-indigo-500/20 text-indigo-300 ring-1 ring-inset ring-indigo-500/30">
          <WifiOff className="size-8" aria-hidden />
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Anda sedang offline
          </h1>
          <p className="text-sm text-zinc-400">
            ControlDesk tidak bisa terhubung ke server. Cek koneksi WiFi atau
            data seluler, lalu coba lagi. Sebagian data cache mungkin masih
            bisa dilihat kalau sebelumnya sudah dibuka.
          </p>
        </div>
        <div className="flex flex-col items-stretch gap-2 self-stretch">
          <Link
            href="/"
            className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white shadow-sm ring-1 ring-inset ring-indigo-400/30 transition hover:bg-indigo-400"
          >
            Coba muat ulang
          </Link>
          <a
            href="javascript:history.back()"
            className="rounded-md border border-zinc-800 bg-zinc-900/50 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900"
          >
            Kembali ke halaman sebelumnya
          </a>
        </div>
        <p className="text-xs text-zinc-500">
          Kalau masalah tetap muncul, hubungi admin tenant Anda.
        </p>
      </section>
    </main>
  );
}
