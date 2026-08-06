import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { getTenantContext } from "@/lib/tenant/context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Create workspace",
};

export default async function RegisterPage() {
  const { slug } = await getTenantContext();
  const t = await getTranslations("auth");

  if (slug) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            {t("invitationOnly")}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t("invitationOnlySubtitle", { slug })}
          </p>
        </div>

        <Alert>
          <AlertTitle>{t("needAccess")}</AlertTitle>
          <AlertDescription>{t("needAccessBody")}</AlertDescription>
        </Alert>

        <p className="text-sm text-muted-foreground text-center">
          {t("alreadyHaveInvite")}{" "}
          <Link
            href="/login"
            className="text-foreground font-medium underline underline-offset-4"
          >
            {t("signIn")}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          {t("createWorkspace")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t("createWorkspaceSubtitle")}
        </p>
      </div>

      <RegisterForm />

      <p className="text-sm text-muted-foreground text-center">
        {t("alreadyHaveWorkspace")}{" "}
        <Link
          href="/login"
          className="text-foreground font-medium underline underline-offset-4"
        >
          {t("signIn")}
        </Link>
      </p>
    </div>
  );
}
