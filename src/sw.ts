/// <reference lib="webworker" />
/**
 * ControlDesk — Progressive Web App Service Worker (Serwist / Turbopack).
 *
 * Build-time bundling via Route Handler:
 *   Serwist compiles this file via esbuild at `next build` when the
 *   Route Handler at `src/app/serwist/[path]/route.ts` runs
 *   (`generateStaticParams` prerenders `/serwist/sw.js`). No webpack
 *   plugin, works with Next.js 16 Turbopack out of the box.
 *
 * Scope semantics — CRITICAL for multi-tenant:
 *   Browser scoping rule: a SW registered from `itps.controldesk.site/`
 *   only intercepts requests inside that origin. Different subdomains
 *   (demo.controldesk.site, itps.controldesk.site, apex) each get their
 *   own SW + cache silo. This is exactly what we want — no risk of
 *   cross-tenant data leak through cached responses.
 *
 * Caching strategy:
 *   - Precache the offline fallback shell only (small, no PII).
 *   - Runtime cache static assets (`_next/static`) with StaleWhileRevalidate.
 *   - Runtime cache images/fonts with CacheFirst + expiration.
 *   - NEVER cache API responses, HTML pages, or auth endpoints (rules §5,
 *     §15) — PII risk + auth cookie freshness.
 */

import { defaultCache } from "@serwist/turbopack/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Injected by Serwist at build time (list of files precached).
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

// The webworker lib reference at the top of this file provides
// `ServiceWorkerGlobalScope`, `WindowClient`, etc. We still need to
// tell TS that `self` in this module is that scope specifically
// (default is `WorkerGlobalScope`).
declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Skip waiting so a fresh SW takes over immediately on next navigation.
  // For an ERP where deploys happen frequently, this avoids the "stuck
  // on old version" pitfall. If we ever need coordinated cutover
  // (e.g. breaking API change), flip this to false + add a manual
  // update prompt.
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          // Only fall back to /~offline for top-level document
          // navigations — leave API / image / asset failures alone
          // so the app can surface a proper error UI instead of
          // masking them.
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();

// -----------------------------------------------------------------------
// Push notification handling (Day 2 wiring — kept behind a data check
// so this SW works standalone on Day 1 without a live push subscription).
//
// Payload contract from `notifications.dispatchPush()` (Day 2):
//   { title: string, body: string, url?: string, tag?: string,
//     icon?: string, badge?: string }
// -----------------------------------------------------------------------
self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) return;
  let payload: {
    title?: string;
    body?: string;
    url?: string;
    tag?: string;
    icon?: string;
    badge?: string;
  } = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "ControlDesk", body: event.data.text() };
  }

  const title = payload.title ?? "ControlDesk";
  const options: NotificationOptions = {
    body: payload.body ?? "",
    icon: payload.icon ?? "/icons/icon-192.png",
    badge: payload.badge ?? "/icons/icon-192.png",
    tag: payload.tag,
    data: { url: payload.url ?? "/" },
    // Vibrate is a hint — some browsers ignore.
    // @ts-expect-error: NotificationOptions.vibrate exists on Android Chrome
    // but is not in the TS lib definition.
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | null)?.url ?? "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // If a ControlDesk tab is already open, focus + navigate it.
      for (const client of allClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            await (client as WindowClient).navigate(target);
          }
          return;
        }
      }
      // Otherwise open a new tab.
      await self.clients.openWindow(target);
    })(),
  );
});
