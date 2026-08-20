"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Idle-timeout hook — fires a warning at `timeoutMs - warningMs` and a final
 * timeout at `timeoutMs` unless the user is active in the interim.
 *
 * ### Design decisions
 *
 * 1. **Callback refs, not deps.** The activity listeners are registered once
 *    per `enabled` toggle. `onWarn`/`onTimeout`/`onActivity` are captured via
 *    ref so parent re-renders don't tear down + re-register listeners on every
 *    frame. Cost: callers can rely on always-fresh callbacks without needing
 *    `useCallback` for correctness.
 *
 * 2. **Throttled activity handler.** DOM emits `mousemove` at ~60 Hz and
 *    `scroll` at ~120 Hz. Resetting `setTimeout` on every event would (a) hit
 *    setTimeout overhead unnecessarily and (b) fire a BroadcastChannel
 *    message per event, saturating cross-tab sync. We coalesce activity to
 *    max 1 reset per `ACTIVITY_THROTTLE_MS`.
 *
 * 3. **Cross-tab sync via BroadcastChannel.** If a user is actively working
 *    in Tab A, Tab B should not idle-logout. On every reset in Tab A, we
 *    postMessage `{ type: "activity", at: <ms> }` to a well-known channel.
 *    Other tabs listen and reset their own timers with the SAME `at`
 *    timestamp — so all tabs converge to identical idle deadlines.
 *
 * 4. **Explicit `extend()` handle.** The provider component uses this to
 *    let the user click "Lanjutkan sesi" in the warning modal. That's a
 *    manual reset — same code path as an activity event, but dispatched
 *    from application logic instead of DOM event.
 *
 * 5. **`page` visibility bypass.** If the tab is hidden (`document.hidden`
 *    is true), we DON'T count that as activity. The user might have moved
 *    the mouse in a different app; their tab is still idle. `visibilitychange`
 *    → visible transitions ARE counted (returning to the tab counts as
 *    activity, which resets the timer).
 *
 * ### Non-goals
 *
 * - Server-side idle enforcement. This hook is best-effort UX. Actual JWT
 *   expiry is enforced server-side by Supabase (`GOTRUE_JWT_EXP=3600` in
 *   docker-compose.prod.yml).
 * - Per-role or per-tenant timeout. Callers pass fixed `timeoutMs`. If we
 *   need role-based timeout, resolve it in the parent RSC and pass it here.
 */
type IdleTimeoutOptions = {
  timeoutMs: number;
  warningMs: number;
  onWarn: () => void;
  onTimeout: () => void;
  onActivity?: () => void;
  enabled: boolean;
};

type BroadcastMessage = { type: "activity" | "extend"; at: number };

const ACTIVITY_EVENTS = [
  "mousemove",
  "keydown",
  "click",
  "scroll",
  "touchstart",
] as const;

const ACTIVITY_THROTTLE_MS = 1000;
const BROADCAST_CHANNEL_NAME = "controldesk-idle-timeout";

export function useIdleTimeout(options: IdleTimeoutOptions): {
  extend: () => void;
} {
  const { timeoutMs, warningMs, enabled } = options;

  const callbacksRef = useRef({
    onWarn: options.onWarn,
    onTimeout: options.onTimeout,
    onActivity: options.onActivity,
  });
  callbacksRef.current = {
    onWarn: options.onWarn,
    onTimeout: options.onTimeout,
    onActivity: options.onActivity,
  };

  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityAtRef = useRef<number>(Date.now());
  const broadcastRef = useRef<BroadcastChannel | null>(null);

  const clearTimers = useCallback(() => {
    if (warnTimerRef.current) {
      clearTimeout(warnTimerRef.current);
      warnTimerRef.current = null;
    }
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, []);

  const startTimers = useCallback(() => {
    clearTimers();
    if (!enabled) return;
    const warnAfter = Math.max(0, timeoutMs - warningMs);
    warnTimerRef.current = setTimeout(() => {
      callbacksRef.current.onWarn();
    }, warnAfter);
    timeoutTimerRef.current = setTimeout(() => {
      callbacksRef.current.onTimeout();
    }, timeoutMs);
  }, [clearTimers, enabled, timeoutMs, warningMs]);

  const resetFromLocal = useCallback(() => {
    const now = Date.now();
    if (now - lastActivityAtRef.current < ACTIVITY_THROTTLE_MS) return;
    lastActivityAtRef.current = now;
    callbacksRef.current.onActivity?.();
    startTimers();
    broadcastRef.current?.postMessage({
      type: "activity",
      at: now,
    } satisfies BroadcastMessage);
  }, [startTimers]);

  const extend = useCallback(() => {
    const now = Date.now();
    lastActivityAtRef.current = now;
    callbacksRef.current.onActivity?.();
    startTimers();
    broadcastRef.current?.postMessage({
      type: "extend",
      at: now,
    } satisfies BroadcastMessage);
  }, [startTimers]);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      return;
    }

    if (typeof window === "undefined") return;

    if (typeof BroadcastChannel !== "undefined") {
      broadcastRef.current = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      broadcastRef.current.onmessage = (
        evt: MessageEvent<BroadcastMessage>,
      ) => {
        if (evt.data?.type === "activity" || evt.data?.type === "extend") {
          lastActivityAtRef.current = evt.data.at;
          callbacksRef.current.onActivity?.();
          startTimers();
        }
      };
    }

    const onActivityDom = () => {
      if (document.hidden) return;
      resetFromLocal();
    };
    const onVisibility = () => {
      if (!document.hidden) resetFromLocal();
    };

    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, onActivityDom, { passive: true }),
    );
    document.addEventListener("visibilitychange", onVisibility);

    startTimers();

    return () => {
      clearTimers();
      ACTIVITY_EVENTS.forEach((e) =>
        window.removeEventListener(e, onActivityDom),
      );
      document.removeEventListener("visibilitychange", onVisibility);
      broadcastRef.current?.close();
      broadcastRef.current = null;
    };
  }, [enabled, clearTimers, startTimers, resetFromLocal]);

  return { extend };
}
