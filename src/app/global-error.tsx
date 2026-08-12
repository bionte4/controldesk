"use client";

import * as React from "react";

import { reportClientError } from "@/lib/observability/client-report";

/**
 * Root-level error boundary (Next.js App Router convention).
 *
 * `global-error.tsx` catches errors thrown from the root layout down. It
 * MUST render its own <html>/<body> because the failing render likely
 * escaped the root layout.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    reportClientError({
      level: "fatal",
      msg: error.message || "Uncaught render error",
      name: error.name,
      stack: error.stack,
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "2rem",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
          background: "#0a0a0a",
          color: "#fafafa",
        }}
      >
        <main
          style={{
            maxWidth: 480,
            display: "grid",
            gap: 12,
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 12, opacity: 0.6, letterSpacing: 1 }}>
            ERROR · 500
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>
            Terjadi masalah tak terduga
          </h1>
          <p style={{ opacity: 0.75, lineHeight: 1.5 }}>
            Tim ControlDesk sudah dihubungi otomatis. Coba muat ulang halaman —
            bila masih gagal, silakan hubungi admin tenant Anda.
          </p>
          {error.digest ? (
            <p style={{ fontSize: 11, opacity: 0.5, fontFamily: "monospace" }}>
              digest: {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: 8,
              padding: "10px 18px",
              borderRadius: 10,
              background: "#6366f1",
              color: "white",
              border: "none",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Muat ulang
          </button>
        </main>
      </body>
    </html>
  );
}
