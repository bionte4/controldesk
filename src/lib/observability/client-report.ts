/**
 * ControlDesk — client-side observability reporter (rules §21).
 *
 * Client bundles never touch the sink directly — they POST to the
 * `/api/observability/report` endpoint which fans out to the configured
 * server sink. This keeps DSN + API tokens out of the browser bundle.
 *
 * Every payload is redacted client-side too (auth headers, tokens) as a
 * defensive measure, then re-redacted server-side.
 */

const CLIENT_REPORT_ENDPOINT = "/api/observability/report";

export type ClientErrorPayload = {
  level: "warn" | "error" | "fatal";
  msg: string;
  name?: string;
  stack?: string;
  route?: string;
  digest?: string; // Next.js server error digest, when applicable
};

function scrub(value: string | undefined): string | undefined {
  if (!value) return value;
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/g, "[REDACTED]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[REDACTED]");
}

/**
 * Fire-and-forget POST. Uses `navigator.sendBeacon` when available so
 * reports survive page unloads (e.g. after a nav-caused crash).
 */
export function reportClientError(payload: ClientErrorPayload): void {
  if (typeof window === "undefined") return;

  const body = JSON.stringify({
    level: payload.level,
    msg: scrub(payload.msg) ?? "unknown error",
    name: payload.name,
    stack: scrub(payload.stack),
    route: payload.route ?? window.location.pathname,
    digest: payload.digest,
    user_agent: navigator.userAgent,
  });

  try {
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(CLIENT_REPORT_ENDPOINT, blob);
      if (ok) return;
    }
  } catch {
    // fall through to fetch
  }

  try {
    void fetch(CLIENT_REPORT_ENDPOINT, {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body,
    }).catch(() => {
      /* swallow */
    });
  } catch {
    /* swallow */
  }
}

/**
 * Install global handlers: window.onerror + unhandledrejection.
 * Safe to call multiple times — the second invocation is a no-op.
 */
let installed = false;
export function installGlobalHandlers(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    reportClientError({
      level: "error",
      msg: event.message || event.error?.message || "window.onerror",
      name: event.error?.name,
      stack: event.error?.stack,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const errName = reason instanceof Error ? reason.name : "UnhandledRejection";
    const errMsg =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "unhandled promise rejection";
    const stack = reason instanceof Error ? reason.stack : undefined;
    reportClientError({
      level: "error",
      msg: errMsg,
      name: errName,
      stack,
    });
  });
}
