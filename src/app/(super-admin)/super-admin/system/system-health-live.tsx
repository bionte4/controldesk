"use client";

/**
 * Live system-health monitor (Opsi A of platform-ops dashboard).
 *
 * Client-side polls `/api/ready` every REFRESH_INTERVAL_MS to render a
 * traffic-light UI over the three checks the readiness endpoint runs:
 *
 *   • Supabase — service-role query round-trip to `public.tenants`
 *   • Redis    — PING with 1.5s timeout
 *   • Overall  — combined status (all green ⇒ ready, any red ⇒ not_ready)
 *
 * Design notes:
 *
 * 1. **Poll — not stream.** `/api/ready` is a plain fetch. We chose polling
 *    (rather than SSE or Realtime channel) because the freshness budget for
 *    "is Postgres/Redis reachable?" is measured in seconds, not milliseconds
 *    — a 10-second cadence is cheap (~2 requests/minute) and matches how
 *    Kubernetes readiness probes would poll the same endpoint.
 *
 * 2. **Pause when tab is hidden.** `document.visibilityState === "hidden"`
 *    stops the poll loop so a background super-admin tab doesn't sit
 *    hammering the endpoint. On becoming visible again we fire ONE fetch
 *    immediately (not wait for the next tick) so the UI reflects reality
 *    within a heartbeat of the tab regaining focus.
 *
 * 3. **Graceful degradation.** If `/api/ready` itself fails (network,
 *    proxy 502, timeout), we still render the CARD — but with a
 *    "Unreachable" status, showing the raw error text so ops can eyeball
 *    what's happening without opening DevTools. Every subsequent poll
 *    replaces this state; no exponential backoff (readiness endpoints are
 *    cheap, and we WANT to know the second they come back).
 *
 * 4. **Abort in-flight fetch on unmount.** `AbortController` in the effect
 *    cleanup prevents setState on unmounted component when the user
 *    navigates away mid-request.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const REFRESH_INTERVAL_MS = 10_000;
const FETCH_TIMEOUT_MS = 5_000;

type CheckResult =
  | { ok: true; latency_ms: number }
  | { ok: false; latency_ms: number; error: string };

type ReadyPayload = {
  status: "ready" | "not_ready";
  timestamp: string;
  checks: {
    supabase: CheckResult;
    redis: CheckResult;
  };
};

type PollState =
  | { kind: "loading" }
  | { kind: "ready"; payload: ReadyPayload; fetchedAt: Date }
  | { kind: "unreachable"; error: string; fetchedAt: Date };

function statusTone(ok: boolean): {
  label: string;
  className: string;
} {
  return ok
    ? {
        label: "Healthy",
        className:
          "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
      }
    : {
        label: "Down",
        className:
          "bg-rose-500/10 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
      };
}

function formatRelative(from: Date, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m === 1 ? "1 min ago" : `${m} min ago`;
}

/**
 * Fetch `/api/ready` with a hard timeout. The endpoint returns 200 when
 * all checks pass and 503 when any check fails — BOTH are valid payloads
 * we want to render, so we parse the body regardless of HTTP status. A
 * true network / timeout error surfaces via the caller's `.catch`.
 */
async function fetchReady(signal: AbortSignal): Promise<ReadyPayload> {
  const timeout = setTimeout(() => {
    // The AbortController the caller passed IS the parent's — we only add
    // our own timeout on top of it. If the parent already aborted (unmount
    // or manual refresh) we skip our timeout to avoid double-aborting.
    if (!signal.aborted) {
      (signal as unknown as { throwIfAborted?: () => void }).throwIfAborted?.();
    }
  }, FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("/api/ready", {
      cache: "no-store",
      signal,
    });
    // Both 200 and 503 return JSON; anything else is a proxy misconfig.
    if (res.status !== 200 && res.status !== 503) {
      throw new Error(`unexpected HTTP ${res.status}`);
    }
    return (await res.json()) as ReadyPayload;
  } finally {
    clearTimeout(timeout);
  }
}

export function SystemHealthLive({
  initialFetchedAtIso,
}: {
  initialFetchedAtIso: string;
}) {
  const [state, setState] = useState<PollState>({ kind: "loading" });
  const [now, setNow] = useState<Date>(() => new Date(initialFetchedAtIso));
  const inFlightAbortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(async () => {
    inFlightAbortRef.current?.abort();
    const ctrl = new AbortController();
    inFlightAbortRef.current = ctrl;
    try {
      const payload = await fetchReady(ctrl.signal);
      if (!ctrl.signal.aborted) {
        setState({ kind: "ready", payload, fetchedAt: new Date() });
      }
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setState({
        kind: "unreachable",
        error: err instanceof Error ? err.message : String(err),
        fetchedAt: new Date(),
      });
    }
  }, []);

  // Initial fetch + poll loop. Pauses when tab is backgrounded.
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      void doFetch();
    };
    const start = () => {
      if (interval) return;
      tick(); // one shot immediately, then repeat
      interval = setInterval(tick, REFRESH_INTERVAL_MS);
    };
    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
      inFlightAbortRef.current?.abort();
    };
  }, [doFetch]);

  // Local clock ticker so "3s ago" refreshes without a re-poll.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const overallOk =
    state.kind === "ready" && state.payload.status === "ready";

  return (
    <div className="space-y-6">
      {/* Overall banner */}
      <Card
        className={
          state.kind === "loading"
            ? "border-zinc-200 dark:border-zinc-800"
            : overallOk
              ? "border-emerald-200 dark:border-emerald-900/40"
              : "border-rose-200 dark:border-rose-900/40"
        }
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-3 text-base">
              {state.kind === "loading" ? (
                <>
                  <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-zinc-400" />
                  <span>Checking system…</span>
                </>
              ) : overallOk ? (
                <>
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  <span>All systems operational</span>
                </>
              ) : (
                <>
                  <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />
                  <span>
                    {state.kind === "unreachable"
                      ? "Readiness endpoint unreachable"
                      : "One or more services down"}
                  </span>
                </>
              )}
            </CardTitle>
            <CardDescription>
              {state.kind === "loading"
                ? "Fetching initial state…"
                : `Last checked ${formatRelative(state.fetchedAt, now)} · auto-refresh every ${REFRESH_INTERVAL_MS / 1000}s`}
            </CardDescription>
          </div>
          <button
            type="button"
            onClick={() => void doFetch()}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Refresh now
          </button>
        </CardHeader>
      </Card>

      {/* Per-check grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <CheckCard
          name="Supabase Postgres"
          description="Service-role query round-trip to `public.tenants`"
          check={
            state.kind === "ready" ? state.payload.checks.supabase : null
          }
          loading={state.kind === "loading"}
          unreachable={state.kind === "unreachable"}
        />
        <CheckCard
          name="Redis"
          description="PING via ioredis (1.5s connect timeout)"
          check={
            state.kind === "ready" ? state.payload.checks.redis : null
          }
          loading={state.kind === "loading"}
          unreachable={state.kind === "unreachable"}
        />
      </div>

      {/* Unreachable diagnostic */}
      {state.kind === "unreachable" && (
        <Card className="border-rose-200 dark:border-rose-900/40">
          <CardHeader>
            <CardTitle className="text-base">Fetch error</CardTitle>
            <CardDescription>
              The browser could not reach <code>/api/ready</code>. This
              usually means the container is restarting or the reverse
              proxy is misconfigured.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-rose-500/5 p-3 text-xs text-rose-800 dark:text-rose-200">
              {state.error}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CheckCard({
  name,
  description,
  check,
  loading,
  unreachable,
}: {
  name: string;
  description: string;
  check: CheckResult | null;
  loading: boolean;
  unreachable: boolean;
}) {
  const ok = check?.ok ?? false;
  const tone = statusTone(ok);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{name}</CardTitle>
          {loading ? (
            <Badge variant="secondary">Checking…</Badge>
          ) : unreachable ? (
            <Badge variant="secondary">Unknown</Badge>
          ) : (
            <span
              className={`inline-flex h-5 items-center rounded-4xl px-2 py-0.5 text-xs font-medium ${tone.className}`}
            >
              {tone.label}
            </span>
          )}
        </div>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {loading || unreachable || !check ? (
          <div className="text-zinc-400 dark:text-zinc-600">—</div>
        ) : (
          <dl className="space-y-1">
            <div className="flex justify-between">
              <dt className="text-zinc-500 dark:text-zinc-400">Latency</dt>
              <dd className="font-mono tabular-nums">
                {check.latency_ms} ms
              </dd>
            </div>
            {!check.ok && (
              <div>
                <dt className="mb-1 text-zinc-500 dark:text-zinc-400">
                  Error
                </dt>
                <dd>
                  <pre className="overflow-x-auto rounded-md bg-rose-500/5 p-2 text-xs text-rose-800 dark:text-rose-200">
                    {check.error}
                  </pre>
                </dd>
              </div>
            )}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
