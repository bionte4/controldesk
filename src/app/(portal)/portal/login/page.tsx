import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

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

export default async function PortalLoginPage() {
  const session = await getCurrentPortalSession();
  if (session) redirect("/portal");
  const t = await getTranslations("portal.login");

  return (
    <div className="grid place-items-center py-10">
      <Card className="glass w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-display text-2xl">{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <PortalLoginForm />
        </CardContent>
      </Card>
    </div>
  );
}
