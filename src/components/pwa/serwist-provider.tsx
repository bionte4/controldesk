"use client";

import { SerwistProvider as UpstreamSerwistProvider } from "@serwist/turbopack/react";

/**
 * ControlDesk — Serwist client wrapper.
 *
 * The upstream `SerwistProvider` is a client-only component. Because
 * `src/app/layout.tsx` is a Server Component (needs `getLocale` +
 * `getMessages` from next-intl), we can't import the upstream provider
 * there directly. This tiny wrapper adds `"use client"` and re-exports
 * it so the RSC layout can compose it into the tree.
 *
 * `swUrl` is fixed to `/serwist/sw.js` — the path served by the Route
 * Handler at `src/app/serwist/[[...path]]/route.ts`. Do NOT hardcode
 * `/sw.js` (legacy `next-pwa` convention) — that path doesn't exist in
 * the Serwist / Turbopack setup.
 */
export function SerwistProvider({ children }: { children: React.ReactNode }) {
  return (
    <UpstreamSerwistProvider swUrl="/serwist/sw.js">
      {children}
    </UpstreamSerwistProvider>
  );
}
