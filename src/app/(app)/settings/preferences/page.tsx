import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Sparkles } from "lucide-react";

import { PreferencesSection } from "@/app/(app)/profile/preferences-section";
import { requireCurrentEmployee } from "@/lib/auth/session";
import {
  loadTenantBotConfig,
  loadUserLink,
} from "@/lib/integrations/telegram";
import {
  loadTenantWhatsAppConfig,
  loadUserWhatsAppLink,
} from "@/lib/integrations/whatsapp";
import { loadPreferencesForUser } from "@/lib/notifications/preferences";

export const metadata: Metadata = { title: "Preferences" };

/**
 * Personal preferences page (rules §17).
 *
 * Every authenticated user can access this page — the underlying
 * `user_notification_preferences`, `user_telegram_links`, and
 * `user_whatsapp_links` tables are all scoped to `auth.uid()` via
 * RLS, so there is no role gate at the route level. HR data on
 * `/profile` is separate and handled by that page.
 *
 * This route is a thin composition:
 *   1. Load current preferences grid + link states in parallel.
 *   2. Discriminate Telegram + WhatsApp states into the shape the
 *      `PreferencesSection` client component understands.
 *   3. Render the shared `PreferencesSection` component.
 *
 * The heavy lifting (grid rendering, toggle handlers, telegram
 * linking flow, whatsapp card, appearance picker) lives in the
 * client component under `/profile/preferences-section.tsx` — kept
 * there because that file was the original home; we import it to
 * avoid a duplicate.
 */
export default async function PreferencesPage() {
  const [employee, t] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("profile.preferences"),
  ]);

  const [
    preferencesGrid,
    tenantBot,
    telegramLink,
    whatsappCfg,
    whatsappLink,
  ] = await Promise.all([
    loadPreferencesForUser({
      tenantId: employee.tenant_id,
      userId: employee.user_id,
    }),
    loadTenantBotConfig(employee.tenant_id),
    loadUserLink({
      tenantId: employee.tenant_id,
      userId: employee.user_id,
    }),
    loadTenantWhatsAppConfig(employee.tenant_id),
    loadUserWhatsAppLink({
      tenantId: employee.tenant_id,
      userId: employee.user_id,
    }),
  ]);

  // Same discriminator pattern as `/profile/page.tsx` before the move.
  const telegramInitial =
    !tenantBot || !tenantBot.isActive || !tenantBot.botUsername
      ? ({ status: "no_bot" as const })
      : telegramLink
        ? ({
            status: "linked" as const,
            botUsername: tenantBot.botUsername,
            displayName: telegramLink.displayName,
            telegramUsername: telegramLink.telegramUsername,
          })
        : ({
            status: "unlinked" as const,
            botUsername: tenantBot.botUsername,
          });

  const waBusinessPhone = whatsappCfg
    ? whatsappCfg.phoneNumberId.replace(/^whatsapp:/, "").replace(/^\+/, "")
    : "";
  const whatsappInitial =
    !whatsappCfg || !whatsappCfg.isActive || !whatsappCfg.phoneNumberId
      ? ({ status: "no_config" as const })
      : whatsappLink
        ? ({
            status: "linked" as const,
            businessPhone: waBusinessPhone,
            provider: whatsappCfg.provider,
            displayName: whatsappLink.displayName,
            profileName: whatsappLink.profileName,
          })
        : ({
            status: "unlinked" as const,
            businessPhone: waBusinessPhone,
            provider: whatsappCfg.provider,
          });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="size-5" aria-hidden />
        </div>
        <div>
          <p className="label-meta">Settings</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
      </header>

      <PreferencesSection
        initialGrid={preferencesGrid}
        telegram={telegramInitial}
        whatsapp={whatsappInitial}
      />
    </div>
  );
}
