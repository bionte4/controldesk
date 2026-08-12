import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Logo } from "@/components/brand/logo";
import { getTenantContext } from "@/lib/tenant/context";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LanguageToggle } from "@/components/i18n/language-toggle";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { slug } = await getTenantContext();
  const t = await getTranslations("authLayout");
  const tAuth = await getTranslations("auth");

  const features = [
    t("features.approvals"),
    t("features.cash"),
    t("features.hris"),
    t("features.ai"),
  ] as const;

  return (
    <div className="relative h-svh grid md:grid-cols-2 overflow-hidden">
      {/* ─────────── LEFT PANEL — tablet+ ─────────── */}
      <aside className="relative hidden md:flex flex-col overflow-hidden bg-sidebar text-sidebar-foreground p-6 lg:p-8 xl:p-10">
        {/* Animated aurora backdrop */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
        >
          <div
            className="absolute -top-32 -left-24 h-96 w-96 rounded-full bg-primary/30 blur-3xl motion-safe:animate-pulse"
            style={{ animationDuration: "8s" }}
          />
          <div
            className="absolute bottom-0 right-0 h-[28rem] w-[28rem] rounded-full bg-chart-2/25 blur-3xl motion-safe:animate-pulse"
            style={{ animationDuration: "12s", animationDelay: "2s" }}
          />
          <div
            className="absolute top-1/3 right-1/4 h-72 w-72 rounded-full bg-chart-3/20 blur-3xl motion-safe:animate-pulse"
            style={{ animationDuration: "10s", animationDelay: "1s" }}
          />
        </div>

        {/* Brand — pinned top */}
        <Link
          href="/"
          className="inline-flex items-center gap-3 font-display text-lg font-semibold shrink-0 transition-opacity hover:opacity-90"
        >
          <Logo size={36} />
          <span>ControlDesk</span>
        </Link>

        {/* Main content — centered, height-constrained */}
        <div className="flex-1 min-h-0 flex items-center py-4 lg:py-6">
          <div className="w-full max-w-md mx-auto space-y-4 lg:space-y-5">
            {/* Illustration with animated gradient glow */}
            <div className="relative mx-auto w-full max-w-[280px] lg:max-w-[340px] xl:max-w-[400px]">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-1 rounded-2xl bg-gradient-to-br from-primary/50 via-chart-2/40 to-chart-3/40 blur-md opacity-70 motion-safe:animate-pulse"
                style={{ animationDuration: "6s" }}
              />
              <div className="relative overflow-hidden rounded-xl border border-white/10 shadow-2xl ring-1 ring-white/5">
                <Image
                  src="/brand/controldesk-hero-dashboard.png"
                  alt=""
                  width={1536}
                  height={1024}
                  priority
                  sizes="(min-width: 1280px) 400px, (min-width: 1024px) 340px, (min-width: 768px) 280px, 100vw"
                  className="w-full h-auto select-none"
                />
              </div>
            </div>

            {/* Copy */}
            <div className="space-y-2 text-center lg:text-left">
              <p className="label-meta text-primary/80">{t("sideKicker")}</p>
              <h1 className="font-display text-2xl lg:text-3xl xl:text-4xl font-semibold leading-[1.15] tracking-tight">
                <span className="bg-gradient-to-br from-sidebar-foreground via-sidebar-foreground to-primary bg-clip-text text-transparent">
                  {t("sideHeadline")}
                </span>
              </h1>
              <p className="text-sm text-sidebar-foreground/70 leading-relaxed hidden lg:block">
                {t("sideBody")}
              </p>
            </div>

            {/* Feature bullets */}
            <ul className="space-y-1.5 lg:space-y-2 pt-1">
              {features.map((label) => (
                <li
                  key={label}
                  className="flex items-start gap-2.5 text-[13px] lg:text-sm"
                >
                  <CheckCircle2
                    className="size-4 mt-0.5 text-primary shrink-0"
                    aria-hidden="true"
                  />
                  <span className="text-sidebar-foreground/85">{label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Trust badge — pinned bottom */}
        <div className="shrink-0 flex items-center gap-2 text-xs text-sidebar-foreground/60">
          <ShieldCheck className="size-3.5 text-primary/80" aria-hidden="true" />
          <span>{t("trust")}</span>
        </div>
      </aside>

      {/* ─────────── RIGHT PANEL — form ─────────── */}
      <section className="relative flex flex-col overflow-hidden h-svh md:h-full">
        {/* Subtle radial spotlight — mobile-friendly, purely decorative */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 md:hidden"
        >
          <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-primary/15 blur-3xl" />
        </div>

        {/* Top bar — logo (mobile only) + toggles */}
        <div className="flex items-center justify-between p-4 md:p-6 shrink-0">
          <Link
            href="/"
            className="inline-flex items-center gap-2 font-display font-semibold md:hidden"
          >
            <Logo size={28} />
            <span>ControlDesk</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {slug ? (
              <span className="label-meta hidden sm:inline">
                {tAuth("tenantPrefix")} · {slug}
              </span>
            ) : null}
            <LanguageToggle variant="compact" />
            <ThemeToggle />
          </div>
        </div>

        {/* Form area — centered */}
        <div className="flex-1 min-h-0 grid place-items-center px-6 pb-6">
          <div className="w-full max-w-sm">{children}</div>
        </div>

        {/* Mobile trust — hidden on md+ (already in left panel) */}
        <div className="md:hidden shrink-0 flex items-center justify-center gap-2 text-xs text-muted-foreground pb-4 px-6">
          <ShieldCheck className="size-3.5 text-primary/70" aria-hidden="true" />
          <span>{t("trust")}</span>
        </div>
      </section>
    </div>
  );
}
