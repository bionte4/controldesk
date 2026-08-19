import { spawnSync } from "node:child_process";

import { createSerwistRoute } from "@serwist/turbopack";
import type { NextRequest } from "next/server";

/**
 * Serwist Route Handler — builds `src/sw.ts` via esbuild at build time
 * and serves it at `/serwist/sw.js`.
 *
 * Why a Route Handler instead of the classic webpack plugin?
 *   Next.js 16 uses Turbopack by default (both dev and build). The
 *   older `next-pwa` package hooks into the webpack pipeline and fails
 *   silently on Turbopack. Serwist's Route Handler approach sidesteps
 *   the bundler entirely — it invokes esbuild during a normal Next.js
 *   Route Handler render, producing the SW as a regular static asset.
 *
 * Type-shim rationale (`GET` wrapper below):
 *   Next 16 introduced a strict `RouteHandlerConfig<Route>` validator
 *   that expects `GET` to have the exact signature
 *   `(request: NextRequest, context: { params: Promise<ParamMap[Route]> })
 *   => Promise<Response | void> | Response | void`.
 *
 *   `createSerwistRoute` returns a `GET` that's compatible at runtime
 *   but its declared TS type doesn't match verbatim (Serwist accepts
 *   `Request`, Next expects `NextRequest`; Serwist accepts a plain
 *   object, Next expects a typed generic). Rather than casting through
 *   `any`, we wrap it in a thin shim so the type flows naturally.
 *
 * Cache-busting revision:
 *   Precache entries carry a `revision` string. When the string
 *   changes, the SW considers those URLs stale and re-fetches. We use
 *   the current git commit hash so every deploy busts the cache
 *   correctly. Local dev without git falls back to a random UUID
 *   (freshly generated each dev server restart).
 */
const revision =
  spawnSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf-8",
  }).stdout?.trim() || crypto.randomUUID();

const serwistRoute = createSerwistRoute({
  swSrc: "src/sw.ts",
  // Precache the offline fallback + minimal shell. The rest is
  // covered by runtime caching in `src/sw.ts::runtimeCaching`.
  additionalPrecacheEntries: [
    { url: "/~offline", revision },
    { url: "/manifest.webmanifest", revision },
  ],
  // Turbopack builds always have Node available — no reason to
  // fall back to WASM esbuild.
  useNativeEsbuild: true,
});

// Segment config values MUST be static literals in Next.js 16 —
// Turbopack's route validator does static analysis and rejects
// re-exports through a variable. Match what Serwist configures
// internally: `force-static` output, no dynamic params, no revalidation
// (the file hash + git revision handle cache-busting).
export const dynamic = "force-static";
export const dynamicParams = false;
export const revalidate = false;

/**
 * Adapter: Serwist stores each precached asset as a single `path` string
 * (e.g. `"sw.js"`), but Next 16's catch-all `[[...path]]` route requires
 * `path: string[]` in the param map. Convert on both ends:
 *
 *   generateStaticParams:   { path: "sw.js" }        →  { path: ["sw.js"] }
 *   GET (before handoff):   { path: ["sw.js"] }      →  { path: "sw.js" }
 *
 * This is invisible to Serwist internals — it still sees the single
 * string it expects.
 */
type SerwistParams = { path: string };
type NextCatchAllParams = { path?: string[] };

export async function generateStaticParams(): Promise<NextCatchAllParams[]> {
  const raw = await serwistRoute.generateStaticParams();
  return (raw as SerwistParams[]).map(({ path }) => ({
    path: path.split("/").filter(Boolean),
  }));
}

/**
 * Type shim over Serwist's GET so it satisfies Next 16's strict
 * `RouteHandlerConfig` validator (see file header rationale).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<NextCatchAllParams> },
): Promise<Response> {
  const { path: pathParts } = await context.params;
  const joinedPath = (pathParts ?? []).join("/");
  return (await (serwistRoute.GET as unknown as (
    req: NextRequest,
    ctx: { params: Promise<SerwistParams> },
  ) => Promise<Response>)(request, {
    params: Promise.resolve({ path: joinedPath }),
  })) as Response;
}
