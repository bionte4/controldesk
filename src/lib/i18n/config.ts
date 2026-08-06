/**
 * ControlDesk — i18n configuration (rules §18).
 *
 * Locale strategy:
 *   - Cookie-based (`NEXT_LOCALE`) — no URL prefix, because subdomains are
 *     already reserved for tenant routing (rules §5).
 *   - Default `id` (Bahasa Indonesia) with fallback to `en` (English).
 *   - User preference eventually mirrors to `employees.preferred_locale`
 *     for cross-device sync (follow-up migration).
 */

export const LOCALES = ["id", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "id";
export const LOCALE_COOKIE = "NEXT_LOCALE";

export const LOCALE_LABELS: Record<Locale, string> = {
  id: "Bahasa Indonesia",
  en: "English",
};

/** Short ISO-style codes used as the visible toggle badge. */
export const LOCALE_SHORT: Record<Locale, string> = {
  id: "ID",
  en: "EN",
};

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}
