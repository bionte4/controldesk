import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CalendarClock,
  Mail,
  MessageCircle,
  Plug,
  Send,
  type LucideIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { getCalendarConnectionStatus } from "@/lib/data/calendar-sync";
import { loadTenantSmtpConfig } from "@/lib/integrations/smtp";
import { loadTenantBotConfig } from "@/lib/integrations/telegram";
import { loadTenantWhatsAppConfig } from "@/lib/integrations/whatsapp";
import type { EmployeeRole } from "@/lib/rbac/roles";

export const metadata: Metadata = { title: "Integrations" };

/**
 * Tenant-level integrations hub (rules §17).
 *
 * Access mirrors `secret_rotation` + `calendar_sync` PDP policies:
 * TENANT_ADMIN + GENERAL_MANAGER. Non-admin employees hit
 * `notFound()` — the tile in `/settings` will not be visible to
 * them anyway, so this branch only catches direct-URL access.
 *
 * Personal integrations (Telegram / WhatsApp linking) intentionally
 * live under `/settings/preferences` because they are per-user.
 * This page shows the TENANT-level side: OAuth credentials, bot
 * tokens, business-phone-id, and their live health signal.
 */
const ACCESS_ROLES: readonly EmployeeRole[] = [
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
];

type IntegrationStatus = "connected" | "disconnected" | "not_available";

type IntegrationCard = {
  key: "calendar" | "telegram_bot" | "whatsapp_business" | "smtp";
  href: string | null;
  icon: LucideIcon;
  status: IntegrationStatus;
};

export default async function IntegrationsHubPage() {
  const employee = await requireCurrentEmployee();
  if (!ACCESS_ROLES.includes(employee.role as EmployeeRole)) notFound();

  const [t, calendarStatus, telegramBot, whatsappCfg, smtpCfg] =
    await Promise.all([
      getTranslations("integrationsHub"),
      getCalendarConnectionStatus(employee.tenant_id),
      loadTenantBotConfig(employee.tenant_id),
      loadTenantWhatsAppConfig(employee.tenant_id),
      loadTenantSmtpConfig(employee.tenant_id),
    ]);

  // Derive status per integration. Order of decision for the
  // Telegram + WhatsApp tiles:
  //   1. No row for this tenant   → "disconnected"
  //   2. Row exists but !isActive → "disconnected" (surface `lastError`
  //      on the drill-down page)
  //   3. Row exists and active    → "connected"
  //
  // Note: admin CRUD form for Telegram / WhatsApp is not built yet —
  // the drill-down runbook page explains how to register via
  // one-off SQL until the form lands. Cards stay clickable regardless
  // because the drill-down also shows the LIVE status prominently.
  const telegramStatus: IntegrationStatus = telegramBot?.isActive
    ? "connected"
    : "disconnected";
  const whatsappStatus: IntegrationStatus = whatsappCfg?.isActive
    ? "connected"
    : "disconnected";
  const smtpStatus: IntegrationStatus = smtpCfg?.isActive
    ? "connected"
    : "disconnected";

  const cards: IntegrationCard[] = [
    {
      key: "calendar",
      href: "/settings/integrations/calendar",
      icon: CalendarClock,
      status: calendarStatus.connected ? "connected" : "disconnected",
    },
    {
      key: "smtp",
      href: "/settings/integrations/smtp",
      icon: Mail,
      status: smtpStatus,
    },
    {
      key: "telegram_bot",
      href: "/settings/integrations/telegram-bot",
      icon: Send,
      status: telegramStatus,
    },
    {
      key: "whatsapp_business",
      href: "/settings/integrations/whatsapp-business",
      icon: MessageCircle,
      status: whatsappStatus,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="label-meta">{t("kicker")}</p>
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary">
            <Plug className="size-5" aria-hidden />
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {t("subtitle")}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          const isInteractive = card.href !== null;
          const label = t(`cards.${card.key}.title`);
          const description = t(`cards.${card.key}.description`);
          const badgeCopy =
            card.status === "connected"
              ? t("status.connected")
              : card.status === "disconnected"
                ? t("status.disconnected")
                : t("status.notAvailable");
          const badgeVariant =
            card.status === "connected"
              ? "default"
              : card.status === "disconnected"
                ? "outline"
                : "secondary";

          const content = (
            <Card
              className={`glass h-full transition-shadow ${
                isInteractive ? "group-hover:shadow-md" : "opacity-70"
              }`}
            >
              <CardContent className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
                    <Icon className="size-4" aria-hidden />
                  </div>
                  <Badge variant={badgeVariant} className="shrink-0">
                    {badgeCopy}
                  </Badge>
                </div>
                <div className="flex-1">
                  <div className="font-medium">{label}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {description}
                  </p>
                </div>
                {isInteractive ? (
                  <div className="flex items-center justify-end pt-1">
                    <ArrowRight
                      className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );

          return isInteractive ? (
            <Link
              key={card.key}
              href={card.href!}
              className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {content}
            </Link>
          ) : (
            <div key={card.key} className="cursor-not-allowed">
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
