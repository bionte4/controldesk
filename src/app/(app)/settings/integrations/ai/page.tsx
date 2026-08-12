import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertCircle, CheckCircle2, Sparkles, Wrench } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { loadTenantAiConfig } from "@/lib/integrations/ai";
import type { EmployeeRole } from "@/lib/rbac/roles";

import { AiConfigForm } from "./ai-config-form";

export const metadata: Metadata = { title: "AI Provider" };

/**
 * Runbook + status page for the tenant AI provider (rules §17).
 * Mirrors SMTP / WhatsApp / Telegram admin pages so ops has one
 * mental model for all integrations.
 *
 * Access: TENANT_ADMIN + GENERAL_MANAGER only.
 */
const ACCESS_ROLES: readonly EmployeeRole[] = [
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
];

export default async function AiAdminPage() {
  const employee = await requireCurrentEmployee();
  if (!ACCESS_ROLES.includes(employee.role as EmployeeRole)) notFound();

  const [t, cfg] = await Promise.all([
    getTranslations("aiAdmin"),
    loadTenantAiConfig(employee.tenant_id),
  ]);

  const state = !cfg
    ? ({ status: "no_config" as const })
    : cfg.provider === "DISABLED"
      ? ({
          status: "disabled" as const,
          provider: cfg.provider,
          lastError: cfg.lastError,
        })
      : !cfg.isActive
        ? ({
            status: "inactive" as const,
            provider: cfg.provider,
            modelId: cfg.modelId,
            lastError: cfg.lastError,
          })
        : ({
            status: "connected" as const,
            provider: cfg.provider,
            modelId: cfg.modelId,
            baseUrl: cfg.baseUrl,
            lastError: cfg.lastError,
          });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-3">
        <div className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary">
          <Sparkles className="size-5" aria-hidden />
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

      {/* Status card */}
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
                  {state.provider}
                </Badge>
                <Badge variant="outline">{state.modelId}</Badge>
              </>
            ) : state.status === "disabled" ? (
              <>
                <AlertCircle
                  className="size-4 text-muted-foreground"
                  aria-hidden
                />
                <span className="font-medium">{t("status.disabled")}</span>
              </>
            ) : state.status === "inactive" ? (
              <>
                <AlertCircle
                  className="size-4 text-amber-500"
                  aria-hidden
                />
                <span className="font-medium">{t("status.inactive")}</span>
                <Badge variant="outline" className="ml-1">
                  {state.provider}
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
              <li>{t("runbook.step5")}</li>
            </ol>
            <p className="text-xs text-amber-500">{t("runbook.warning")}</p>
          </CardContent>
        </Card>

        <AiConfigForm
          current={
            cfg
              ? {
                  provider: cfg.provider,
                  modelId: cfg.modelId,
                  baseUrl: cfg.baseUrl,
                  dailyTokenCap: cfg.dailyTokenCap,
                  piiRedactionEnabled: cfg.piiRedactionEnabled,
                  hasApiKey: cfg.apiKey != null && cfg.apiKey.length > 0,
                  isActive: cfg.isActive,
                }
              : null
          }
        />
      </div>
    </div>
  );
}
