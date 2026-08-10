import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/types/database";
import { resolveTenantFromHost } from "@/lib/tenant/resolve";
import { TENANT_HEADER, TENANT_ID_HEADER } from "@/lib/tenant/context";
import { decodeJwtPayload } from "@/lib/auth/jwt-claims";
import { log } from "@/lib/observability/log";

/**
 * Next 16 renamed `middleware.ts` → `proxy.ts` (see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`).
 * This proxy is responsible for:
 *
 *   1. Resolving the tenant slug from the request host (rules §3).
 *   2. Refreshing the Supabase auth session cookies on every request.
 *   3. Redirecting anonymous users to /login on protected paths.
 *   4. Enforcing that the authenticated JWT's `tenant_id` claim matches the
 *      tenant resolved from the URL — the core cross-tenant isolation guard.
 *   5. Passing the resolved tenant slug/id downstream via request headers.
 */

const PUBLIC_PATHS = new Set(["/login", "/register", "/forgot-password"]);
const PUBLIC_PREFIXES = ["/auth", "/api/auth"];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Client Portal (rules §28) runs on a completely separate auth surface —
 * portal users don't have `auth.users` rows so we MUST NOT redirect them to
 * `/login` when the Supabase session is empty. The proxy for `/portal/*`
 * still resolves the tenant (needed for tenant-scoped queries) but leaves
 * auth checks entirely to `src/lib/portal/session.ts`, which the (portal)
 * route group's RSC layer consults.
 */
function isPortalPath(pathname: string): boolean {
  return pathname === "/portal" || pathname.startsWith("/portal/");
}

// Ops endpoints that bypass tenant / auth logic entirely (rules §2, §21, §22).
const OPS_BYPASS_PATHS = new Set([
  "/api/health",
  "/api/ready",
  "/api/version",
  "/api/observability/report",
]);
const OPS_BYPASS_PREFIXES = ["/api/cron/"];

function ensureRequestId(request: NextRequest): string {
  const existing = request.headers.get("x-request-id");
  if (existing && existing.length <= 120) return existing;
  // 128-bit hex; matches the shape we set on Sentry event_id.
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = ensureRequestId(request);
  request.headers.set("x-request-id", requestId);

  // Docker / orchestrator probes + cron endpoints bypass EVERYTHING — no
  // host parse, no session refresh, no DB query. Rules §2 mandates a 200
  // as soon as the Node.js process is accepting requests; cron endpoints
  // authenticate via their own shared secret.
  if (
    OPS_BYPASS_PATHS.has(pathname) ||
    OPS_BYPASS_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
    const res = NextResponse.next({ request });
    res.headers.set("x-request-id", requestId);
    return res;
  }

  const host = request.headers.get("host");
  const tenant = resolveTenantFromHost(host);

  // --- Apex domain: serve marketing, /super-admin, or public auth. ---
  // Anything else on the apex is rewritten to the marketing page so
  // there's no leak of tenant-scoped surfaces. `/super-admin/*` (Fase 2,
  // migration 0077) is served here — its own layout enforces the
  // is_platform_admin JWT claim; the proxy just lets the request
  // through. `/login` is included because that's where platform admins
  // sign in from apex.
  if (tenant.kind === "apex") {
    if (
      pathname === "/" ||
      pathname.startsWith("/marketing") ||
      pathname.startsWith("/super-admin") ||
      pathname.startsWith("/register-org") ||
      pathname === "/login" ||
      pathname === "/forgot-password" ||
      pathname.startsWith("/auth") ||
      pathname.startsWith("/api/auth")
    ) {
      return NextResponse.next({ request });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.rewrite(url);
  }

  // --- Reserved subdomain (www/api/admin/...) → 404 for now. ---
  if (tenant.kind === "reserved") {
    return new NextResponse(`Reserved subdomain: ${tenant.sub}`, {
      status: 404,
    });
  }

  // --- Invalid subdomain shape → 400. ---
  if (tenant.kind === "invalid") {
    return new NextResponse(`Invalid tenant host: ${tenant.reason}`, {
      status: 400,
    });
  }

  // --- Prepare mutable request headers for downstream propagation.
  // Per Next.js 16 proxy docs (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`),
  // request-header mutations only reach RSC / Server Actions if we clone
  // the headers first and pass them to `NextResponse.next({ request: { headers } })`.
  // Mutating `request.headers` AFTER the response is created is a silent
  // no-op for downstream — which surfaces as `getTenantContext().id === null`
  // in portal Server Actions.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  // --- Tenant lifecycle guard (Fase 2, migration 0077). ---
  // Suspended/terminated tenants get a static "suspended" page instead
  // of any app content. This runs before session refresh so we don't
  // burn a DB round-trip refreshing tokens for a tenant nobody can
  // access anyway.
  try {
    const anonForStatus = createServerClient<Database>(
      process.env.SUPABASE_SERVER_URL && process.env.SUPABASE_SERVER_URL.trim() !== ""
        ? process.env.SUPABASE_SERVER_URL
        : process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => [], setAll: () => {} } },
    );
    const { data: status } = await anonForStatus.rpc(
      "resolve_tenant_status_by_slug",
      { p_slug: tenant.slug },
    );
    if (status && status !== "active") {
      // Suspended → send to /suspended (rewrite so URL stays intact).
      // Terminated → 410 Gone. Both preserved for the same reason: no
      // cookie shuffling for a dead tenant.
      if (status === "terminated") {
        return new NextResponse(`Tenant terminated: ${tenant.slug}`, {
          status: 410,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
      const url = request.nextUrl.clone();
      url.pathname = "/suspended";
      url.searchParams.set("slug", tenant.slug);
      return NextResponse.rewrite(url);
    }
    // status === null → tenant slug not in DB. Fall through so the app
    // still returns 404 for unknown tenants via its normal render path.
  } catch (err) {
    // Never let a status-check failure block the site — degrade to
    // "assume active" and rely on the app layer to catch missing rows.
    log.warn("tenant status lookup failed", {
      tenant_slug: tenant.slug,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // --- Client Portal branch (rules §28) — separate auth surface. ---
  // Portal users don't have `auth.users` rows; auth is handled by the RSC
  // helpers in `src/lib/portal/session.ts`. The proxy's only job is to
  // resolve tenant_id from the subdomain so `getTenantContext()` works
  // inside portal Server Actions BEFORE the visitor has authenticated.
  if (isPortalPath(pathname)) {
    requestHeaders.set(TENANT_HEADER, tenant.slug);
    try {
      const anon = createServerClient<Database>(
        process.env.SUPABASE_SERVER_URL &&
          process.env.SUPABASE_SERVER_URL.trim() !== ""
          ? process.env.SUPABASE_SERVER_URL
          : process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll: () => request.cookies.getAll(),
            setAll: () => {},
          },
        },
      );
      const { data: resolvedTenantId } = await anon.rpc(
        "resolve_tenant_id_by_slug",
        { p_slug: tenant.slug },
      );
      if (resolvedTenantId) {
        requestHeaders.set(TENANT_ID_HEADER, resolvedTenantId as string);
      }
    } catch (err) {
      log.warn("portal tenant lookup failed", {
        tenant_slug: tenant.slug,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    response.headers.set("x-request-id", requestId);
    response.headers.set(TENANT_HEADER, tenant.slug);
    const propagatedTenantId = requestHeaders.get(TENANT_ID_HEADER);
    if (propagatedTenantId) {
      response.headers.set(TENANT_ID_HEADER, propagatedTenantId);
    }
    return response;
  }

  // --- (app) branch — Supabase auth + tenant guard. ---
  // Follows the same header-propagation pattern as the portal branch:
  //   1. Mutate a cloned `requestHeaders` for anything RSC / Server Actions
  //      need to read via `headers()` / `getTenantContext()`.
  //   2. Buffer cookie refreshes into `pendingCookies` because the Supabase
  //      client's `setAll` callback is invoked BEFORE we build the final
  //      response.
  //   3. At the end, build ONE response with the mutated headers and flush
  //      all buffered cookies onto it (rules §3, Next.js 16 proxy docs).
  requestHeaders.set(TENANT_HEADER, tenant.slug);

  const pendingCookies: Array<{
    name: string;
    value: string;
    options: Parameters<typeof NextResponse.prototype.cookies.set>[2];
  }> = [];

  const supabase = createServerClient<Database>(
    process.env.SUPABASE_SERVER_URL && process.env.SUPABASE_SERVER_URL.trim() !== ""
      ? process.env.SUPABASE_SERVER_URL
      : process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            // Keep the incoming cookie jar in sync so subsequent Supabase
            // reads within this same request see the refreshed token.
            request.cookies.set(name, value);
            pendingCookies.push({ name, value, options });
          }
        },
      },
    },
  );

  const buildResponse = () => {
    const res = NextResponse.next({ request: { headers: requestHeaders } });
    res.headers.set("x-request-id", requestId);
    res.headers.set(TENANT_HEADER, tenant.slug);
    const propagatedTenantId = requestHeaders.get(TENANT_ID_HEADER);
    if (propagatedTenantId) {
      res.headers.set(TENANT_ID_HEADER, propagatedTenantId);
    }
    for (const c of pendingCookies) {
      res.cookies.set(c.name, c.value, c.options);
    }
    return res;
  };

  // Refresh session (this is what forces cookie rewriting). getUser() also
  // re-verifies the token against the Auth server so we can trust `user.id`.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // NOTE: The custom access-token hook (supabase/migrations/0003_*) injects
  // `tenant_slug`, `tenant_id`, `role`, `employee_id` **into the JWT only** —
  // it does NOT write them to `auth.users.raw_app_meta_data`. Therefore
  // `user.app_metadata` (which mirrors the auth row) is missing those fields.
  // We must decode the current session's access_token to read them.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const jwtClaims = session ? decodeJwtPayload(session.access_token) : null;

  // --- Public auth pages: allow through, no tenant/user checks. ---
  if (isPublicPath(pathname)) {
    // If already signed in and hitting /login, punt to /dashboard.
    if (user && (pathname === "/login" || pathname === "/register")) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
    return buildResponse();
  }

  // --- Protected surface: must be signed in. ---
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // --- Cross-tenant guard: JWT tenant_id must match the URL's tenant. ---
  // The custom access token hook (see supabase/migrations/0003_*) injects
  // `tenant_id` and `tenant_slug` into every issued JWT. We prefer the JWT
  // claims (source of truth) and fall back to `app_metadata` for older
  // sessions where the fields may have also been mirrored to the auth row.
  const claimTenantSlug =
    jwtClaims?.tenant_slug ??
    (user.app_metadata as { tenant_slug?: string } | undefined)?.tenant_slug ??
    null;
  const claimTenantId =
    jwtClaims?.tenant_id ??
    (user.app_metadata as { tenant_id?: string } | undefined)?.tenant_id ??
    null;

  if (!claimTenantSlug || claimTenantSlug !== tenant.slug) {
    // The user is signed in to a different tenant. Force sign-out on this
    // subdomain to avoid confusing state, then redirect to /login.
    log.warn("cross-tenant access blocked at proxy", {
      user_id: user.id,
      claim_tenant_slug: claimTenantSlug,
      request_tenant_slug: tenant.slug,
      pathname,
    });
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", "wrong_tenant");
    return NextResponse.redirect(url);
  }

  if (claimTenantId) {
    requestHeaders.set(TENANT_ID_HEADER, claimTenantId);
  }

  return buildResponse();
}

export const config = {
  // Skip Next.js internals + static assets; run on everything else.
  matcher: [
    "/((?!_next/static|_next/image|_next/data|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff|woff2|ttf|eot)$).*)",
  ],
};
