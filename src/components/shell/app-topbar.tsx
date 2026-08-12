"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight, LogOut, User } from "lucide-react";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { LanguageToggle } from "@/components/i18n/language-toggle";
import { CommandPaletteTrigger } from "@/components/shell/command-palette-trigger";
import {
  NotificationsBell,
  type NotificationItem,
} from "@/components/shell/notifications-bell";
import {
  AiInsightsBadge,
  type InsightPreview,
} from "@/components/shell/ai-insights-badge";
import {
  formatRole,
  type AnyDbEmployeeRole,
} from "@/lib/rbac/roles";
import { signOut } from "@/app/(auth)/actions";

const AI_INSIGHT_ROLES: readonly AnyDbEmployeeRole[] = [
  "TENANT_ADMIN",
  "GENERAL_MANAGER",
  "HEAD_MANAGER",
  "OPERATIONS_MANAGER",
  "PROJECT_MANAGER",
  "LEAD_FINANCE",
];

// Detail-page routes end with a raw UUID (e.g. /finance/budgets/{id}).
// Rendering that verbatim in the breadcrumb produces the notorious
// "Finance > Budgets > 99999999 1111 4111 8111 222222222222" — we
// intercept UUID-shaped segments and swap them for a translated
// "Detail" label so the trail stays readable across every detail page.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toTitle(segment: string): string {
  return segment
    .replace(/-/g, " ")
    .replace(/^\p{L}/u, (c) => c.toUpperCase());
}

export function AppTopbar({
  fullName,
  email,
  role,
  tenantSlug,
  userId,
  tenantId,
  notifications,
  aiInsights,
  locale,
}: {
  fullName: string;
  email: string;
  role: AnyDbEmployeeRole;
  tenantSlug: string;
  userId: string;
  tenantId: string;
  notifications: NotificationItem[];
  aiInsights: InsightPreview[];
  locale: "id" | "en";
}) {
  const showAiInsights = AI_INSIGHT_ROLES.includes(role);
  const pathname = usePathname();
  const t = useTranslations();
  const segments = pathname.split("/").filter(Boolean);
  const initials = fullName
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border/60 bg-background/70 px-4 backdrop-blur-md">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="h-5" />

      <nav aria-label="Breadcrumb" className="hidden md:flex items-center gap-1 text-sm">
        {segments.length === 0 ? (
          <span className="font-medium">{t("topbar.breadcrumbDashboard")}</span>
        ) : (
          segments.map((segment, i) => {
            const href = "/" + segments.slice(0, i + 1).join("/");
            const isLast = i === segments.length - 1;
            const label = UUID_RE.test(segment)
              ? t("topbar.breadcrumbDetail")
              : toTitle(segment);
            return (
              <React.Fragment key={href}>
                {i > 0 ? (
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                ) : null}
                {isLast ? (
                  <span className="font-medium text-foreground">{label}</span>
                ) : (
                  <Link
                    href={href}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {label}
                  </Link>
                )}
              </React.Fragment>
            );
          })
        )}
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <CommandPaletteTrigger />

        <Badge variant="secondary" className="hidden sm:inline-flex">
          {tenantSlug}
        </Badge>

        {showAiInsights ? (
          <AiInsightsBadge
            tenantId={tenantId}
            userId={userId}
            initial={aiInsights}
          />
        ) : null}
        <NotificationsBell
          userId={userId}
          tenantId={tenantId}
          initial={notifications}
          locale={locale}
        />
        <LanguageToggle />
        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                aria-label={t("nav.openUserMenu")}
              />
            }
          >
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
                {initials || "?"}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="font-medium">{fullName}</span>
              <span className="text-xs text-muted-foreground font-normal">
                {email}
              </span>
              <span className="mt-1 label-meta text-[10px]">
                {formatRole(role)}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/profile" />}>
              <User className="size-4" /> {t("common.profile")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <form action={signOut}>
              <DropdownMenuItem
                nativeButton
                render={
                  <button type="submit" className="w-full text-left" />
                }
                className="text-destructive focus:text-destructive"
              >
                <LogOut className="size-4" /> {t("common.signOut")}
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
