import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertCircle, CheckCircle2, Mail, Wrench } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { loadTenantSmtpConfig } from "@/lib/integrations/smtp";
import type { EmployeeRole } from "@/lib/rbac/roles";

import { SmtpConfigForm } from "./smtp-config-form";

export const metadata: Metadata = { title: "SMTP" };

/**
 * Runbook + status page for the tenant SMTP transport (rules §17).
 * Mirrors the Telegram / WhatsApp admin pages so ops has one mental
 * model for all outbound-messaging integrations.
 *
 * Access: TENANT_ADMIN + GENERAL_MANAGER only.
 */
const ACCESS_ROLES: readonly EmployeeRole[] = [
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
];

export default async function SmtpAdminPage() {
  const employee = await requireCurrentEmployee();
  if (!ACCESS_ROLES.includes(employee.role as EmployeeRole)) notFound();

  const [t, cfg] = await Promise.all([
    getTranslations("smtpAdmin"),
    loadTenantSmtpConfig(employee.tenant_id),
  ]);

  const state = !cfg
    ? ({ status: "no_config" as const })
    : !cfg.isActive
      ? ({
          status: "inactive" as const,
          host: cfg.host,
          port: cfg.port,
          fromAddress: cfg.fromAddress,
          lastError: cfg.lastError,
        })
      : ({
          status: "connected" as const,
          host: cfg.host,
          port: cfg.port,
          fromAddress: cfg.fromAddress,
          lastError: cfg.lastError,
        });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start gap-3">
        <div className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary">
          <Mail className="size-5" aria-hidden />
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
                  {state.host}:{state.port}
                </Badge>
                <Badge variant="outline">{state.fromAddress}</Badge>
              </>
            ) : state.status === "inactive" ? (
              <>
                <AlertCircle
                  className="size-4 text-amber-500"
                  aria-hidden
                />
                <span className="font-medium">{t("status.inactive")}</span>
                <Badge variant="outline" className="ml-1">
                  {state.host}:{state.port}
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

        <SmtpConfigForm
          current={
            cfg
              ? {
                  host: cfg.host,
                  port: cfg.port,
                  secure: cfg.secure,
                  fromAddress: cfg.fromAddress,
                  fromName: cfg.fromName,
                  replyTo: cfg.replyTo,
                  hasUsername: cfg.username != null && cfg.username.length > 0,
                  isActive: cfg.isActive,
                }
              : null
          }
        />
      </div>
    </div>
  );
}
