import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Logo } from "@/components/brand/logo";
import { LanguageToggle } from "@/components/i18n/language-toggle";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { getTenantContext } from "@/lib/tenant/context";
import { getCurrentPortalSession } from "@/lib/portal/session";

import { PortalBell } from "./portal-bell";
import { PortalBellRefresh } from "./portal-bell-refresh";
import { PortalSignOutButton } from "./portal-signout-button";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ slug }, session, t] = await Promise.all([
    getTenantContext(),
    getCurrentPortalSession(),
    getTranslations("portal"),
  ]);

  return (
    <div className="relative min-h-svh flex flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border/50 bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-6 py-3">
          <Link
            href="/portal"
            className="inline-flex items-center gap-2 font-display font-semibold"
            aria-label="ControlDesk client portal home"
          >
            <Logo size={32} />
            <span>{t("brand")}</span>
          </Link>
          {slug ? (
            <span className="label-meta hidden md:inline">
              {t("workspacePrefix")} · {slug}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {session ? (
              <>
                <span className="hidden md:inline text-xs text-muted-foreground">
                  {session.client_user.full_name}
                  {" · "}
                  <span className="text-foreground/80">
                    {session.client.name}
                  </span>
                </span>
                <PortalBell session={session} />
                <PortalBellRefresh />
                <PortalSignOutButton label={t("signOut")} />
              </>
            ) : null}
            <LanguageToggle variant="compact" />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-8">
        {children}
      </main>

      <footer className="border-t border-border/40 py-6 text-center text-xs text-muted-foreground">
        {t("footer")}
      </footer>
    </div>
  );
}
