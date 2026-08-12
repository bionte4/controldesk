"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { LOCALE_COOKIE, isLocale, type Locale } from "./config";

/**
 * Server action invoked by the LanguageToggle. Persists the choice for
 * ~1 year and revalidates the entire layout tree so RSC picks up the new
 * dictionary on the same round-trip.
 */
export async function setLocaleAction(locale: Locale): Promise<void> {
  if (!isLocale(locale)) {
    throw new Error(`Invalid locale: ${String(locale)}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false,
  });

  revalidatePath("/", "layout");
}
