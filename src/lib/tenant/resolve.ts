/**
 * Multi-tenant host resolution (rules §3).
 *
 * Production: `{tenant_slug}.controldesk.app`
 * Local dev:  `{tenant_slug}.localhost:3000`
 *
 * The apex domain (root domain with no subdomain, or `www`) is treated as
 * the marketing / tenant picker surface.
 */

const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "auth",
  "assets",
  "static",
  "cdn",
  "mail",
  "docs",
]);

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

export type TenantResolution =
  | { kind: "tenant"; slug: string }
  | { kind: "apex" }
  | { kind: "reserved"; sub: string }
  | { kind: "invalid"; reason: string };

/**
 * Root domain the app is served under, e.g. `controldesk.app` or `localhost:3000`.
 * Port is preserved for local dev because browsers keep it on the Host header.
 */
export function getRootDomain(): string {
  return process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
}

/**
 * Extracts the tenant slug from an incoming `Host` header value.
 * Returns a discriminated union that the caller can branch on.
 */
export function resolveTenantFromHost(rawHost: string | null): TenantResolution {
  if (!rawHost) {
    return { kind: "invalid", reason: "missing host header" };
  }

  // Strip protocol if a full URL somehow slipped in.
  const host = rawHost
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .toLowerCase()
    .trim();

  const rootDomain = getRootDomain().toLowerCase();

  // Split the root into hostname + optional port so we can compare parts.
  const [rootHost] = rootDomain.split(":");
  const [reqHost] = host.split(":");

  if (!rootHost) {
    return { kind: "invalid", reason: "misconfigured NEXT_PUBLIC_ROOT_DOMAIN" };
  }

  // Exact apex match (e.g. `controldesk.app` or `localhost`).
  if (reqHost === rootHost) {
    return { kind: "apex" };
  }

  // Must be `<something>.<rootHost>`.
  const suffix = `.${rootHost}`;
  if (!reqHost.endsWith(suffix)) {
    // Preview URLs (e.g. vercel.app) or unknown domains — treat as apex so
    // the marketing page renders instead of an infinite redirect loop.
    return { kind: "apex" };
  }

  const sub = reqHost.slice(0, -suffix.length);

  if (!sub || sub === "www") {
    return { kind: "apex" };
  }

  if (RESERVED_SUBDOMAINS.has(sub)) {
    return { kind: "reserved", sub };
  }

  // Only allow single-label subdomains to avoid `a.b.tenant.controldesk.app`
  // shenanigans.
  if (sub.includes(".")) {
    return { kind: "invalid", reason: `nested subdomain not allowed: ${sub}` };
  }

  if (!SLUG_PATTERN.test(sub)) {
    return { kind: "invalid", reason: `invalid tenant slug: ${sub}` };
  }

  return { kind: "tenant", slug: sub };
}

/**
 * Builds an absolute URL for a given tenant slug + pathname. Preserves the
 * protocol/port of the current request so it works identically in dev and prod.
 */
export function buildTenantUrl(
  slug: string,
  pathname: string,
  currentUrl: URL,
): URL {
  const rootDomain = getRootDomain();
  const [rootHost, rootPort] = rootDomain.split(":");
  const url = new URL(currentUrl.toString());
  url.hostname = `${slug}.${rootHost}`;
  if (rootPort) {
    url.port = rootPort;
  }
  url.pathname = pathname;
  url.search = "";
  return url;
}
