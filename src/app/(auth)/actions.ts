"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
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

export async function signInWithPassword(input: LoginInput): Promise<ActionState> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { status: "error", message: error.message };
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
