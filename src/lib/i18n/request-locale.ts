/**
 * Resolve the effective UI locale for a server-side request.
 *
 * Precedence (highest → lowest):
 *
 *   1. `NEXT_LOCALE` cookie — set by `LanguageToggle` in the topbar
 *      (`src/lib/i18n/actions.ts`). This is the user's explicit
 *      preference and MUST win over any header hint.
 *   2. `Accept-Language` header — the browser default. Useful for the
 *      very first request before the toggle has been used.
 *   3. `DEFAULT_LOCALE` from `./config` — `id` today.
 *
 * Used by AI-facing HTTP endpoints (`/api/help/ask`,
 * `/api/ai/copilot`) that need to build LLM prompts in the caller's
 * chosen language. `next-intl` covers RSC/server-action paths via its
 * `getRequestConfig`, but route handlers are opted out of that
 * middleware, so we re-implement the cookie → header waterfall here
 * to keep the two surfaces consistent.
 */
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";

/**
 * Minimal cookie interface — covers both `Request.cookies` (Next.js
 * `NextRequest`) and any equivalent that exposes a `get(name)` that
 * returns `{ value: string } | undefined`.
 */
type CookieReader = {
  get(name: string): { value: string } | undefined;
};

export function resolveRequestLocale(input: {
  cookies?: CookieReader | null;
  acceptLanguage?: string | null;
}): Locale {
  const stored = input.cookies?.get(LOCALE_COOKIE)?.value;
  if (isLocale(stored)) return stored;

  return parseAcceptLanguage(input.acceptLanguage);
}

/**
 * Parse the first tag from an `Accept-Language` header and match it
 * against the supported locales. Falls back to `DEFAULT_LOCALE` when
 * nothing matches. Kept small on purpose — full quality-value parsing
 * is overkill for our two-locale menu.
 */
export function parseAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;

  const first = header.split(",")[0]?.trim().toLowerCase() ?? "";
  if (first.startsWith("en")) return "en";
  if (first.startsWith("id")) return "id";
  return DEFAULT_LOCALE;
}
