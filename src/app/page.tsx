import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Command, ArrowUpRight, Sparkles, ShieldCheck, LineChart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LanguageToggle } from "@/components/i18n/language-toggle";
import { getTenantContext } from "@/lib/tenant/context";
import { getRootDomain } from "@/lib/tenant/resolve";

export default async function Home() {
  const { slug } = await getTenantContext();
  const rootDomain = getRootDomain();
  const t = await getTranslations("marketing");

  const isApex = !slug;

  const cards = [
    {
      icon: ShieldCheck,
      title: t("cards.approvals.title"),
      body: t("cards.approvals.body"),
    },
    {
      icon: LineChart,
      title: t("cards.margins.title"),
      body: t("cards.margins.body"),
    },
    {
      icon: Sparkles,
      title: t("cards.ai.title"),
      body: t("cards.ai.body"),
    },
  ];

  return (
    <div className="relative min-h-svh overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-primary/25 blur-3xl" />
        <div className="absolute top-1/3 right-0 h-96 w-96 rounded-full bg-chart-2/20 blur-3xl" />
        <div className="absolute bottom-0 -left-24 h-[28rem] w-[28rem] rounded-full bg-chart-3/15 blur-3xl" />
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link
          href="/"
          className="flex items-center gap-2 font-display text-lg font-semibold"
        >
          <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <Command className="size-4" />
          </div>
          ControlDesk
        </Link>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />
          <Button size="sm" variant="ghost" render={<Link href="/login" />}>
            {t("signIn")}
          </Button>
          {isApex ? (
            <Button size="sm" render={<Link href="/register" />}>
              {t("ctaCreateWorkspace")}
              <ArrowUpRight className="size-3.5" />
            </Button>
          ) : (
            <Button size="sm" render={<Link href="/dashboard" />}>
              {t("ctaOpenDashboard")}
              <ArrowUpRight className="size-3.5" />
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col items-center gap-8 px-6 py-24 text-center">
        <Badge variant="secondary" className="gap-1.5">
          <Sparkles className="size-3.5 text-primary" />
          <span className="label-meta text-[10px]">{t("badge")}</span>
        </Badge>

        <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-6xl">
          {t("heroLead")}
          <span className="ml-3 bg-gradient-to-r from-primary via-chart-2 to-chart-3 bg-clip-text text-transparent">
            {t("heroAccent")}
          </span>
        </h1>

        <p className="max-w-2xl text-balance text-muted-foreground text-lg">
          {t("heroBody")}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" render={<Link href="/register" />}>
            {t("ctaPrimary")}
            <ArrowUpRight className="size-4" />
          </Button>
          <Button size="lg" variant="outline" render={<Link href="/login" />}>
            {t("ctaSecondary")}
          </Button>
        </div>

        <div className="mt-6 grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
          {cards.map(({ icon: Icon, title, body }) => (
            <div key={title} className="glass rounded-2xl p-5 text-left">
              <div className="mb-3 grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-4" />
              </div>
              <div className="font-display font-semibold">{title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>

        <footer className="mt-16 text-xs text-muted-foreground">
          {t("subdomainHint", { tenant: "{tenant}", root: rootDomain })}
        </footer>
      </main>
    </div>
  );
}
