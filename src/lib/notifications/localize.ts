import "server-only";

import { getTranslations } from "next-intl/server";

import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/server";

/** Loose translator signature — accepts string key with optional values map. */
export type LooseTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/**
 * Localized notification helper (rules §20 + §18).
 *
 * Notifications are written to `public.notifications` as plain text — the
 * bell component reads them verbatim. To respect the recipient's language
 * preference we need to resolve their locale at write-time.
 *
 * Resolution order:
 *   1. `employees.preferred_locale` (id | en | null)
 *   2. Tenant fallback — currently DEFAULT_LOCALE ("id"), but leaves the
 *      door open to add `tenants.default_locale` in a later migration.
 *   3. Fallback DEFAULT_LOCALE.
 */

export async function resolveEmployeeLocale(input: {
  employeeId: string | null | undefined;
  tenantId?: string;
}): Promise<Locale> {
  if (!input.employeeId) return DEFAULT_LOCALE;

  const supabase = await createClient();
  const { data } = await supabase
    .from("employees")
    .select("preferred_locale")
    .eq("id", input.employeeId)
    .maybeSingle();

  const raw = data?.preferred_locale;
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

/**
 * Convenience wrapper: get a `next-intl` translator scoped to the given
 * recipient's locale + a namespace root. Callers should pass the namespace
 * they intend to look up keys under (e.g. `notifications.expenses`).
 */
export async function translatorFor(input: {
  employeeId: string | null | undefined;
  tenantId?: string;
  namespace: string;
}): Promise<{ t: LooseTranslator; locale: Locale }> {
  const locale = await resolveEmployeeLocale(input);
  // next-intl types the namespace as a literal union of all keys — we're
  // passing dynamic strings here (safe: the keys exist in messages/*.json
  // as verified by tests). Cast around the overload.
  const raw = await getTranslations({
    locale,
    namespace: input.namespace as never,
  });
  const t: LooseTranslator = (key, values) =>
    (raw as unknown as LooseTranslator)(key, values);
  return { t, locale };
}
