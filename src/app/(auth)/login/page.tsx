import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorParam = typeof params.error === "string" ? params.error : undefined;
  const reasonParam = typeof params.reason === "string" ? params.reason : undefined;
  const t = await getTranslations("auth");

  // Priority: explicit `error` param wins over the softer `reason` info.
  // `reason=idle_timeout` renders as an informational banner (blue),
  // not an error (red) — the user did nothing wrong, we just enforced
  // the inactivity policy.
  const initialError =
    errorParam === "wrong_tenant" ? t("wrongTenant") : undefined;
  const initialInfo =
    reasonParam === "idle_timeout" ? t("idleTimeoutBanner") : undefined;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          {t("welcomeBack")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t("welcomeBackSubtitle")}
        </p>
      </div>

      <LoginForm initialError={initialError} initialInfo={initialInfo} />

      <p className="text-sm text-muted-foreground text-center">
        {t("newToControlDesk")}{" "}
        <Link
          href="/register-org"
          className="text-foreground font-medium underline underline-offset-4"
        >
          {t("createAccount")}
        </Link>
      </p>
    </div>
  );
}
