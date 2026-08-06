"use client";

import * as React from "react";
import { AlertOctagon, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/observability/client-report";

/**
 * Route-group error boundary for the authenticated app shell. Catches
 * client-side render errors inside `(app)/**` without dropping the topbar +
 * sidebar chrome above it.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    reportClientError({
      level: "error",
      msg: error.message || "App segment render failure",
      name: error.name,
      stack: error.stack,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="mx-auto grid min-h-[60vh] max-w-lg place-items-center px-6 py-16 text-center">
      <div className="grid gap-4">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-rose-500/10 text-rose-400">
          <AlertOctagon className="size-7" />
        </div>
        <p className="label-meta text-muted-foreground">Kesalahan runtime</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Halaman ini gagal dirender
        </h1>
        <p className="text-sm text-muted-foreground">
          Kami sudah menerima laporan otomatis. Coba muat ulang — jika masih
          gagal, hubungi admin tenant Anda dan sertakan kode digest di bawah.
        </p>
        {error.digest ? (
          <p className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 font-mono text-[11px] text-muted-foreground">
            {error.digest}
          </p>
        ) : null}
        <div className="mx-auto flex flex-wrap items-center gap-2">
          <Button onClick={reset} size="sm">
            <RefreshCw className="size-4" />
            Coba lagi
          </Button>
        </div>
      </div>
    </main>
  );
}
