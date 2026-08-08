import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertCircle, CheckCircle2, Send, Wrench } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { loadTenantBotConfig } from "@/lib/integrations/telegram";
import type { EmployeeRole } from "@/lib/rbac/roles";

import { TelegramBotForm } from "./telegram-bot-form";

export const metadata: Metadata = { title: "Telegram bot" };

/**
 * Admin surface for the tenant Telegram bot (rules §17). Ships three
 * panels:
 *   1. Live status pill — reflects `tenant_telegram_bots.is_active`
 *      plus `last_error` for connected-but-broken cases.
 *   2. BotFather runbook — the Telegram-side steps that stay
 *      outside our system (create bot, copy token).
 *   3. Save/deactivate form — the ERP-side write. Server action
 *      verifies the token against `getMe` BEFORE persisting so a
 *      typo never lands in the encrypted store.
 *
 * The loader never leaks the plaintext token to the client: only the
 * bot username / active flag / last error travel to `TelegramBotForm`.
 *
 * Access: TENANT_ADMIN + GENERAL_MANAGER. Non-admin employees never
 * see the sidebar entry (nav config gate) and hit 404 on direct URL.
 */
const ACCESS_ROLES: readonly EmployeeRole[] = [
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
];

export default async function TelegramBotPage() {
  const employee = await requireCurrentEmployee();
  if (!ACCESS_ROLES.includes(employee.role as EmployeeRole)) notFound();

  const [t, bot] = await Promise.all([
    getTranslations("telegramBotAdmin"),
    loadTenantBotConfig(employee.tenant_id),
  ]);

  // Discriminate the connection state. We deliberately DO NOT expose
  // `bot.botToken` to the render tree — it stays inside the loader
  // return so nothing sensitive lands in the HTML payload.
  const state = !bot
    ? ({ status: "no_config" as const })
    : !bot.isActive
      ? ({
          status: "inactive" as const,
          botUsername: bot.botUsername,
          lastError: bot.lastError,
        })
      : ({
          status: "connected" as const,
          botUsername: bot.botUsername,
          lastError: bot.lastError,
        });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-3">
        <div className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary">
          <Send className="size-5" aria-hidden />
        </div>
        <div>
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
      </header>

      {/* Status card — always visible */}
      <Card className="glass">
        <CardContent className="flex flex-col gap-2 p-5">
          <div className="flex items-center gap-2">
            {state.status === "connected" ? (
              <>
                <CheckCircle2
                  className="size-4 text-emerald-500"
                  aria-hidden
                />
                <span className="font-medium">{t("status.connected")}</span>
                <Badge variant="default" className="ml-1">
                  @{state.botUsername}
                </Badge>
              </>
            ) : state.status === "inactive" ? (
              <>
                <AlertCircle
                  className="size-4 text-amber-500"
                  aria-hidden
                />
                <span className="font-medium">{t("status.inactive")}</span>
                <Badge variant="outline" className="ml-1">
                  @{state.botUsername}
                </Badge>
              </>
            ) : (
              <>
                <AlertCircle
                  className="size-4 text-amber-500"
                  aria-hidden
                />
                <span className="font-medium">{t("status.noConfig")}</span>
              </>
            )}
          </div>
          {state.status !== "no_config" && state.lastError ? (
            <p className="pl-6 text-xs text-rose-500">
              {t("status.lastError")}: {state.lastError}
            </p>
          ) : null}
          {state.status === "connected" ? (
            <p className="pl-6 text-xs text-muted-foreground">
              {t("status.hintConnected")}
            </p>
          ) : (
            <p className="pl-6 text-xs text-muted-foreground">
              {t("status.hintNotConfigured")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Runbook (left) + admin form (right).
          The runbook covers the BotFather side — everything that happens
          inside Telegram — while the form handles the ERP-side write. */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="glass">
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
              <Wrench className="size-4 text-primary" aria-hidden />
              <h2 className="font-semibold">{t("runbook.title")}</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("runbook.description")}
            </p>
            <ol className="ml-4 flex list-decimal flex-col gap-1.5 text-sm text-muted-foreground">
              <li>{t("runbook.step1")}</li>
              <li>{t("runbook.step2")}</li>
              <li>{t("runbook.step3")}</li>
              <li>{t("runbook.step4")}</li>
            </ol>
          </CardContent>
        </Card>

        <TelegramBotForm
          current={
            bot
              ? {
                  botUsername: bot.botUsername,
                  isActive: bot.isActive,
                  lastError: bot.lastError,
                }
              : null
          }
        />
      </div>
    </div>
  );
}
