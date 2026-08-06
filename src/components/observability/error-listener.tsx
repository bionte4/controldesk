"use client";

import * as React from "react";

import { installGlobalHandlers } from "@/lib/observability/client-report";

/**
 * Mount once at the root of the client tree. Installs global window.onerror
 * and unhandledrejection listeners that ship crash reports to the
 * observability sink via `/api/observability/report`.
 */
export function ErrorListener(): null {
  React.useEffect(() => {
    installGlobalHandlers();
  }, []);
  return null;
}
