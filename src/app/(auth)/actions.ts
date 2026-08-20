"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { decodeJwtPayload } from "@/lib/auth/jwt-claims";
import {
  getRootDomain,
  resolveTenantFromHost,
} from "@/lib/tenant/resolve";
import {
  loginSchema,
  magicLinkSchema,
  type LoginInput,
  type MagicLinkInput,
} from "@/lib/validation/auth";

export type ActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success"; message?: string; redirectTo?: string };

/**
 * Whitelist a `next=` query param — must be a same-origin absolute path
 * that starts with a single `/` and doesn't try to escape into a
 * protocol-relative URL (`//evil.com`) or a full URL. Anything else
 * silently falls back to the tenant-vs-platform-admin default below.
 */
function sanitizeNext(next: string | undefined): string | null {
  if (!next) return null;
  if (typeof next !== "string") return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//")) return null;
  if (next.startsWith("/api")) return null; // never bounce into an API route
  return next;
}

/**
 * Sign in with email + password, then compute the destination.
 *
 * We deliberately do NOT call Next.js `redirect(...)` anywhere in this
 * action.
 *
 * In Next.js 16 (App Router + Turbopack), `redirect()` from inside a
 * Server Action inlines the RSC payload of the CURRENT surface (the
 * `/login` route) in the response body while the `x-action-redirect`
 * header points at the destination. On a tenant subdomain the client
 * then commits the inlined marketing-shell RSC ("Ruang operasional
 * untuk Managed Services") under the destination URL, producing
 * exactly the "cannot log in after login" loop we already fixed once
 * (dashboard URL, marketing content — one refresh fixes it).
 *
 * Returning `{ status: "success", redirectTo }` lets the client login
 * form perform its own navigation (`router.replace` for same-origin,
 * `window.location.href` for absolute cross-subdomain), which triggers
 * a fresh RSC fetch scoped to the destination route and honors the
 * just-issued auth cookies correctly.
 */
export async function signInWithPassword(
  input: LoginInput,
  options?: { next?: string },
): Promise<ActionState> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { status: "error", message: error.message };
  }

  // Resolve the redirect destination.
  //
  // We always decode the fresh JWT first — the sign-in above has just
  // set new session cookies, so `getSession()` returns an access_token
  // with the custom claims injected by `custom_access_token_hook`
  // (migration 0077). Those claims are the source of truth for WHERE
  // this user is allowed to land, regardless of which host they typed.
  //
  // Priority order:
  //
  //   1. `next=` param — the URL the user was trying to reach before
  //      being bounced to /login. Only honored when it doesn't cross
  //      a tenant boundary (see cross-tenant guard below).
  //   2. Platform admin → `/super-admin/tenants` (apex) or their user
  //      real tenant subdomain (tenant hosts don't have super-admin).
  //   3. User's `tenant_slug` claim matches current host → /dashboard.
  //   4. User's `tenant_slug` claim ≠ current host → absolute redirect
  //      to `{their_slug}.{root}/dashboard`. This is the case that
  //      hit the reported "splash keeps spinning" bug — the user's
  //      account belongs to `itps` but they logged in on
  //      `demo.localhost`; without this branch they'd land on
  //      /dashboard, get blocked at the proxy for cross-tenant
  //      access, and end up back on /login in an animation loop.
  //   5. Orphaned auth user (no claims) → sign out + error message.
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const tenant = resolveTenantFromHost(host);

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const claims = decodeJwtPayload(session?.access_token);

  const jwtTenantSlug =
    typeof claims?.tenant_slug === "string" ? claims.tenant_slug : null;
  const isPlatformAdmin = claims?.is_platform_admin === true;

  const rootDomain = getRootDomain();
  const [rootHost, rootPort] = rootDomain.split(":");
  const portSuffix = rootPort ? `:${rootPort}` : "";

  // Helper: build an absolute cross-subdomain URL to the given slug.
  // The login form's `handleSplashComplete` detects `http(s)://`
  // targets and does a `window.location.href` full-page nav so the
  // browser attaches the fresh auth cookies (scoped to the root
  // domain, so they survive the hop).
  const buildTenantUrl = (slug: string, path: string) =>
    `${proto}://${slug}.${rootHost}${portSuffix}${path}`;

  // Step 1: `next=` param — honor it, but only if it doesn't force us
  // onto a subdomain that contradicts the user's tenant claim. Since
  // `sanitizeNext` already rejects absolute URLs, the `next` value is
  // always a same-origin path — the cross-tenant risk only matters if
  // the current host itself is the wrong tenant, which the fall-through
  // logic below handles anyway. So `next` is safe to honor at face
  // value when the host tenant matches the claim.
  const nextParam = sanitizeNext(options?.next);
  if (nextParam && tenant.kind === "tenant" && tenant.slug === jwtTenantSlug) {
    return { status: "success", redirectTo: nextParam };
  }
  if (nextParam && tenant.kind === "apex" && isPlatformAdmin) {
    return { status: "success", redirectTo: nextParam };
  }

  // Step 2: Platform admin path.
  if (isPlatformAdmin) {
    if (tenant.kind === "apex") {
      return { status: "success", redirectTo: "/super-admin/tenants" };
    }
    // Platform admin on a tenant subdomain — send them to the
    // super-admin console on apex so we don't confuse them with a
    // tenant workspace shell (which doesn't route `/super-admin`).
    return {
      status: "success",
      redirectTo: `${proto}://${rootHost}${portSuffix}/super-admin/tenants`,
    };
  }

  // Step 3: Tenant user whose claim matches the current host.
  if (
    tenant.kind === "tenant" &&
    jwtTenantSlug &&
    tenant.slug === jwtTenantSlug
  ) {
    return { status: "success", redirectTo: "/dashboard" };
  }

  // Step 4: Tenant user on the WRONG host — bounce them to their
  // rightful tenant subdomain. This covers both:
  //   • Apex login by a tenant user (was already handled — this now
  //     unifies the code path).
  //   • Tenant-subdomain login on a subdomain that isn't the user's.
  //     Before this fix, we returned `/dashboard` and the proxy
  //     bounced them back to /login → infinite splash loop.
  if (jwtTenantSlug) {
    return {
      status: "success",
      redirectTo: buildTenantUrl(jwtTenantSlug, "/dashboard"),
    };
  }

  // Step 5: Orphaned auth user — valid credentials but no
  // `platform_admins` row and no `employees` row on any tenant.
  // Sign them out so we don't leave a dangling session cookie
  // and return a message the form can render.
  await supabase.auth.signOut();
  return {
    status: "error",
    message:
      "Akun ini belum ditautkan ke tenant manapun. Hubungi administrator untuk mendapatkan akses.",
  };
}

export async function sendMagicLink(input: MagicLinkInput): Promise<ActionState> {
  const parsed = magicLinkSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid email." };
  }

  const supabase = await createClient();
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const redirectTo = `${proto}://${host}/api/auth/callback?next=/dashboard`;

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: redirectTo },
  });

  if (error) {
    return { status: "error", message: error.message };
  }

  return {
    status: "success",
    message: "Check your email for the sign-in link.",
  };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/**
 * Sign out with a reason — clears the Supabase Auth session and redirects
 * to `/login?reason=<reason>`.
 *
 * Split from `signOut()` because that one is bound to a `<form action={...}>`
 * in `AppTopbar` and must keep the `(formData: FormData) => void` shape
 * that React expects. This variant is invoked programmatically from client
 * code (idle-timeout provider) via `startTransition`.
 *
 * @param reason Machine-readable slug rendered as a banner on `/login`.
 * Currently only `"idle_timeout"` is used; add cases to the login page
 * translation map as new reasons appear.
 */
export async function signOutWithReason(reason: string): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect(`/login?reason=${encodeURIComponent(reason)}`);
}
