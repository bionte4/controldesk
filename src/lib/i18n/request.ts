import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";

/**
 * next-intl request config invoked once per server request. Reads the
 * caller's locale preference from the `NEXT_LOCALE` cookie, then loads the
 * matching dictionary from `messages/{locale}.json`.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const stored = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(stored) ? stored : DEFAULT_LOCALE;

  const messages = (await import(`../../../messages/${locale}.json`)).default;

  return { locale, messages };
});
