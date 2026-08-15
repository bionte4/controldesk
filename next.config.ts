import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { withSerwist } from "@serwist/turbopack";

const withNextIntl = createNextIntlPlugin("./src/lib/i18n/request.ts");

/**
 * Origins that are allowed to invoke Server Actions on this server. Next.js
 * rejects Server Action POSTs from unknown origins with a 403 (silent from
 * the client's perspective — the action never runs and no toast fires) as a
 * CSRF defence. Every host+port combination that will host the app in any
 * environment MUST appear here, otherwise its login and other Server Actions
 * die quietly.
 *
 * Defaults cover local development:
 *   :3000 → `pnpm dev` (Turbopack)
 *   :3001 → Docker prod container (see `docker-compose.override.yml`)
 *
 * For staging / production, extend the list at deploy time with the env var
 * `NEXT_SERVER_ACTIONS_EXTRA_ORIGINS` (comma-separated), e.g.
 *   NEXT_SERVER_ACTIONS_EXTRA_ORIGINS="staging.controldesk.app,*.staging.controldesk.app,controldesk.app,*.controldesk.app"
 */
const extraOrigins = (process.env.NEXT_SERVER_ACTIONS_EXTRA_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // Standalone bundle required by our production Dockerfile (rules §1/§2).
  // Emits `.next/standalone/server.js` with a minimal, self-contained runtime.
  output: "standalone",
  // Escape hatch for the Docker prod build.
  //
  // Next.js 16 Turbopack runs a separate `tsc --noEmit` pass at the end
  // of `next build` for a belt-and-suspenders check. Inside our Docker VM
  // (4 GB memory, sharing headroom with the Supabase stack) that pass
  // regularly hangs in the "Running TypeScript ..." step and never
  // returns. `pnpm typecheck` is already wired into the CI pipeline
  // (see `.github/workflows/ci.yml`) AND runs locally before every
  // commit, so this check is redundant during Docker image builds.
  //
  // Setting `NEXT_SKIP_TYPECHECK=1` in the Dockerfile short-circuits it.
  // Leaving the env var unset (i.e. every non-Docker build) still runs
  // the in-Next TS pass, so this doesn't relax our baseline safety net.
  //
  // NOTE: `eslint` used to sit next to this block, but Next.js 16
  // removed ESLint integration from `next build` entirely ("`eslint`
  // configuration in next.config.ts is no longer supported.") — the
  // key is now REJECTED by `NextConfig` type, breaking `tsc --noEmit`.
  // Lint enforcement moved to the `pnpm lint` CI gate.
  typescript: {
    ignoreBuildErrors: process.env.NEXT_SKIP_TYPECHECK === "1",
  },
  experimental: {
    serverActions: {
      allowedOrigins: [
        "localhost:3000",
        "*.localhost:3000",
        "localhost:3001",
        "*.localhost:3001",
        ...extraOrigins,
      ],
    },
  },
};

// Wrapping order:
//   withNextIntl handles the intl middleware plumbing (routing +
//   request-scoped locale). withSerwist adds `esbuild` to
//   `serverExternalPackages` so the Route Handler at
//   `src/app/serwist/[[...path]]/route.ts` can compile `src/sw.ts` at
//   build time. Their responsibilities don't overlap so order is
//   irrelevant — we wrap intl innermost by habit (matches every other
//   Next.js example in the intl docs).
export default withSerwist(withNextIntl(nextConfig));
