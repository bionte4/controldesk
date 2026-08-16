"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { resolveTenantFromHost } from "@/lib/tenant/resolve";
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

  // Resolve the redirect destination in priority order:
  //
  //   1. Explicit `next=` query param the caller was trying to reach
  //      before being bounced to `/login` (must survive the sanitizer).
  //   2. Platform admin signing in on the apex domain → the platform
  //      console. `/dashboard` is a tenant-only route; on apex the proxy
  //      would rewrite it to the marketing shell, which manifests as the
  //      "login succeeds but lands on marketing page" bug (§9 issue that
  //      brought us here).
  //   3. Everyone else → `/dashboard` (existing behavior, works on
  //      tenant subdomains).
  //
  // We deliberately do NOT call `redirect()` from here — see the long
  // comment on the return value shape at the bottom of this function
  // for the Next.js 16 Turbopack RSC-inlining rationale.
  const nextParam = sanitizeNext(options?.next);
  if (nextParam) {
    return { status: "success", redirectTo: nextParam };
  }

  const h = await headers();
  const host = h.get("host");
  const tenant = resolveTenantFromHost(host);
  if (tenant.kind === "apex") {
    // Only platform admins have a reason to be on apex `/login`. If a
    // regular tenant user typed apex by mistake we'd still want them on
    // their tenant workspace — but we can't cheaply know their tenant
    // slug without a fresh JWT decode here, and the proxy already
    // guides them via the tenant-picker on `/`. So on apex we default
    // to the super-admin console; non-admins hitting it get a clean
    // "not_platform_admin" bounce from the layout instead of the
    // silent marketing-page rewrite.
    return { status: "success", redirectTo: "/super-admin/tenants" };
  }

  // NOTE: We deliberately do NOT call `redirect("/dashboard")` here.
  //
  // In Next.js 16 (App Router + Turbopack), `redirect()` from inside a
  // Server Action inlines the RSC payload of the CURRENT surface (the
  // `/login` route) in the response body while the `x-action-redirect`
  // header points at `/dashboard`. On a tenant subdomain the client
  // then commits the inlined marketing-shell RSC ("Ruang operasional
  // untuk Managed Services") under the `/dashboard` URL, producing
  // exactly the "cannot log in after login" loop the user reports
  // (dashboard URL, marketing content — one refresh fixes it).
  //
  // Returning `status: "success"` with a `redirectTo` lets the client
  // component perform a `router.push("/dashboard")`, which triggers a
  // fresh RSC fetch scoped to the destination route and honors the
  // just-issued auth cookies correctly.
  return { status: "success", redirectTo: "/dashboard" };
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
