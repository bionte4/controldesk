import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { getTranslations } from "next-intl/server";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requirePortalSession } from "@/lib/portal/session";

import { PortalChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Portal — Change password" };

export default async function PortalChangePasswordPage() {
  // Allow PENDING_ACTIVATION visitors — this IS the escape hatch page.
  const session = await requirePortalSession({ allowPendingActivation: true });

  // Already ACTIVE users don't need to be forced through here. Send them
  // to the dashboard. (We may lift this restriction later to allow
  // voluntary rotation.)
  if (session.client_user.status === "ACTIVE") {
    redirect("/portal");
  }

  const t = await getTranslations("portal.changePassword");

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <div className="text-center">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-300">
          <KeyRound className="size-6" aria-hidden="true" />
        </div>
        <p className="label-meta">{t("kicker")}</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("subtitle", { email: session.client_user.email })}
        </p>
      </div>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display text-base">
            {t("cardTitle")}
          </CardTitle>
          <CardDescription>{t("cardSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <PortalChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
