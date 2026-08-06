import Link from "next/link";
import { Command } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getTenantContext } from "@/lib/tenant/context";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LanguageToggle } from "@/components/i18n/language-toggle";

export default async function AuthLayout({
  children,
}: LayoutProps<"/">) {
  const { slug } = await getTenantContext();
  const t = await getTranslations("authLayout");
  const tAuth = await getTranslations("auth");

  return (
    <div className="relative min-h-svh grid lg:grid-cols-2">
      {/* Left panel — brand + subtle animated blobs, hidden on small screens */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-sidebar text-sidebar-foreground p-10">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-32 -left-24 h-96 w-96 rounded-full bg-primary/25 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-[28rem] w-[28rem] rounded-full bg-chart-2/20 blur-3xl" />
          <div className="absolute top-1/3 right-1/4 h-72 w-72 rounded-full bg-chart-3/20 blur-3xl" />
        </div>

        <Link href="/" className="inline-flex items-center gap-2 font-display text-lg font-semibold">
          <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            <Command className="size-4" />
          </div>
          ControlDesk
        </Link>

        <div className="space-y-3 max-w-md">
          <p className="label-meta text-primary/80">{t("sideKicker")}</p>
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight">
            {t("sideHeadline")}
          </h1>
          <p className="text-sm text-sidebar-foreground/70">{t("sideBody")}</p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="relative flex flex-col">
        <div className="flex items-center justify-between p-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 font-display font-semibold lg:hidden"
          >
            <div className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <Command className="size-3.5" />
            </div>
            ControlDesk
          </Link>
          <div className="ml-auto flex items-center gap-3">
            {slug ? (
              <span className="label-meta">
                {tAuth("tenantPrefix")} · {slug}
              </span>
            ) : null}
            <LanguageToggle variant="compact" />
            <ThemeToggle />
          </div>
        </div>

        <div className="flex-1 grid place-items-center px-6 pb-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
