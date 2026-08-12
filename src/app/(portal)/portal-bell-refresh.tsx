"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Near-realtime refresh loop for the Client Portal topbar bell (rules §20,
 * §28). Portal users don't hold a Supabase JWT, so subscribing to
 * `postgres_changes` on `portal_notifications` (RLS = service_role only)
 * would deliver nothing to the browser. Rather than open a broadcast channel
 * with the anon key (extra surface area) or run an SSE endpoint, we do a
 * lightweight polling refresh:
 *
 *   • `router.refresh()` re-runs the parent RSC (layout), which re-reads
 *     `getPortalUnreadCount()` and re-renders the badge without a full
 *     navigation. Existing scroll/form state is preserved.
 *   • Poll cadence: `intervalMs` (default 45s). Configurable per-mount so
 *     high-traffic surfaces (e.g. the notifications feed itself) can bump
 *     the cadence up.
 *   • Visibility-aware: paused while the tab is hidden (Page Visibility
 *     API), resumed on focus. Avoids battery/data-plan waste on background
 *     tabs.
 *   • Coalesced against `document.visibilitychange` — one refresh right
 *     when the tab becomes visible again, then the normal cadence resumes.
 *
 * Accessibility: renders `null`; the parent bell owns the visible surface
 * and its aria-label reflects the (now fresh) unread count.
 */
export function PortalBellRefresh({
  intervalMs = 45_000,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();
  const routerRef = React.useRef(router);
  React.useEffect(() => {
    routerRef.current = router;
  }, [router]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      routerRef.current.refresh();
    };
    const start = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(tick, intervalMs);
    };
    const stop = () => {
      if (intervalId === null) return;
      clearInterval(intervalId);
      intervalId = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        // Immediate refresh on focus, then resume the cadence.
        tick();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);

  return null;
}
