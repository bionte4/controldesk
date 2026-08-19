import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Scale } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { loadApprovalThresholdsForAdmin } from "@/lib/data/approval-thresholds";
import { authorizeCanonical } from "@/lib/security/pdp-canonical";
import { toCanonicalRole } from "@/lib/rbac/roles";

import { ThresholdManager } from "./threshold-manager";

export const metadata: Metadata = { title: "Approval Thresholds" };

export default async function ApprovalThresholdsPage() {
  const employee = await requireCurrentEmployee();

  // Canonical PDP `decideApprovalThreshold('update')` — ADMIN /
  // DIRECTOR (GENERAL_MANAGER folds to DIRECTOR post-Fase 0). This
  // replaces the previous hand-rolled `WRITE_ROLES` array to guarantee
  // the page gate never drifts from the server-action / RLS policy
  // that guards the actual mutations (migration 0024, rules §9).
  const gate = authorizeCanonical({
    actor: {
      userId: employee.user_id,
      employeeId: employee.id,
      role: toCanonicalRole(employee.role),
      tenantId: employee.tenant_id,
    },
    action: "update",
    resource: "approval_threshold",
    attributes: { tenantId: employee.tenant_id },
  });
  if (gate.effect !== "ALLOW") {
    // Non-admins get a 404 (not 403) so the URL doesn't advertise
    // the existence of an admin route.
    notFound();
  }

  const [overrides, t] = await Promise.all([
    loadApprovalThresholdsForAdmin(),
    getTranslations("settings.approvalThresholds"),
  ]);

  const overrideCount = Object.keys(overrides).length;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/settings"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            {t("backToSettings")}
          </Link>
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className={
              overrideCount > 0
                ? "border-amber-400/30 bg-amber-500/10 text-amber-300"
                : "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
            }
          >
            {overrideCount > 0
              ? t("overrideCount", { count: overrideCount })
              : t("noOverrides")}
          </Badge>
        </div>
      </header>

      <Card className="glass">
        <CardHeader className="flex-row items-start gap-3">
          <div className="mt-1 grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <Scale className="size-4" aria-hidden />
          </div>
          <div>
            <CardTitle>{t("hint.title")}</CardTitle>
            <CardDescription>{t("hint.body")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <ThresholdManager overrides={overrides} />
        </CardContent>
      </Card>
    </div>
  );
}
