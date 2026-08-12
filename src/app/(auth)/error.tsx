"use client";

import * as React from "react";
import { AlertOctagon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/observability/client-report";

export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    reportClientError({
      level: "error",
      msg: error.message || "Auth segment render failure",
      name: error.name,
      stack: error.stack,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="mx-auto grid min-h-[60vh] max-w-md place-items-center px-6 py-12 text-center">
      <div className="grid gap-4">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-rose-500/10 text-rose-400">
          <AlertOctagon className="size-6" />
        </div>
        <h1 className="font-display text-xl font-semibold tracking-tight">
          Layanan autentikasi bermasalah
        </h1>
        <p className="text-sm text-muted-foreground">
          Coba lagi dalam beberapa detik. Kalau tetap gagal, hubungi admin
          tenant.
        </p>
        <Button onClick={reset} size="sm" className="mx-auto">
          Coba lagi
        </Button>
      </div>
    </main>
  );
}
