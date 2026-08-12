import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";

// Static imports — Turbopack tracks these for HMR properly, so editing
// messages/*.json triggers an automatic dev-server refresh. The former
// `await import(\`../../../messages/\${locale}.json\`)` dynamic-import form
// worked at build time but its module cache was NOT invalidated when the
// JSON file changed, producing stale-translation bugs during development.
//
// Cache-busting note: If you edit a JSON file and next-intl reports
// MISSING_MESSAGE for keys that clearly exist, bump the `CACHE_BUST_TAG`
// comment below by one character. That's enough to invalidate the
// Turbopack module graph without needing a full dev-server restart.
// CACHE_BUST_TAG=v11
import messagesEn from "../../../messages/en.json";
import messagesId from "../../../messages/id.json";

const DICTIONARIES: Record<Locale, typeof messagesEn> = {
  en: messagesEn,
  id: messagesId,
};

/**
 * next-intl request config invoked once per server request. Reads the
 * caller's locale preference from the `NEXT_LOCALE` cookie, then hands
 * next-intl the matching dictionary.
 */
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const stored = cookieStore.get(LOCALE_COOKIE)?.value;
  const locale: Locale = isLocale(stored) ? stored : DEFAULT_LOCALE;

  return { locale, messages: DICTIONARIES[locale] };
});
