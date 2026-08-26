import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentPortalSession } from "@/lib/portal/session";

import { PortalLoginForm } from "./portal-login-form";

export const metadata: Metadata = {
  title: "Portal — Sign in",
};

export default async function PortalLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getCurrentPortalSession();
  if (session) redirect("/portal");
  const params = await searchParams;
  const reasonParam = typeof params.reason === "string" ? params.reason : undefined;
  const [t, tSession] = await Promise.all([
    getTranslations("portal.login"),
    getTranslations("session"),
  ]);
  const idleTimeoutMessage = reasonParam === "idle_timeout"
    ? tSession("bannerIdleTimeout")
    : reasonParam === "absolute_timeout"
      ? tSession("bannerAbsoluteTimeout")
      : undefined;

  return (
    <div className="grid place-items-center py-10">
      <Card className="glass w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-display text-2xl">{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {idleTimeoutMessage ? (
            <Alert>
              <AlertDescription>{idleTimeoutMessage}</AlertDescription>
            </Alert>
          ) : null}
          <PortalLoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
