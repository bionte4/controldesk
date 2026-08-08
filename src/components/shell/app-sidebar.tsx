"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Command, Sparkles } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { filterNavForRole, type NavItem } from "@/lib/nav/config";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";

export function AppSidebar({
  role,
  tenantName,
  tenantSlug,
}: {
  role: AnyDbEmployeeRole;
  tenantName: string;
  tenantSlug: string;
}) {
  const pathname = usePathname();
  const locale = useLocale();
  const tSections = useTranslations("nav.sections");
  const tItems = useTranslations("nav.items");
  const tNav = useTranslations("nav");
  const sections = React.useMemo(() => filterNavForRole(role), [role]);

  /**
   * Per-section sort: `pinned` items first (preserving their
   * config-file order), then everything else alphabetized against
   * the resolved translated label. `Intl.Collator` respects the
   * active locale — Indonesian and English both sort correctly
   * without extra config.
   *
   * Section order itself is NOT sorted; the config's section order
   * reflects intentional business grouping (Overview → Delivery →
   * Finance → People → Analytics → Settings).
   */
  const collator = React.useMemo(
    () => new Intl.Collator(locale, { sensitivity: "base" }),
    [locale],
  );

  const sortedSections = React.useMemo(
    () =>
      sections.map((section) => {
        const pinned = section.items.filter((i) => i.pinned);
        const rest = section.items
          .filter((i) => !i.pinned)
          .slice()
          .sort((a, b) =>
            collator.compare(tItems(a.titleKey), tItems(b.titleKey)),
          );
        return { ...section, items: [...pinned, ...rest] as NavItem[] };
      }),
    // `tItems` and `collator` change together with locale; including
    // both keeps ESLint's exhaustive-deps rule happy.
    [sections, tItems, collator],
  );

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader>
        <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <Command className="size-4" />
          </div>
          <div className="flex flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
            <span className="truncate font-display text-sm font-semibold">
              {tenantName}
            </span>
            <span className="truncate text-xs text-sidebar-foreground/60">
              {tenantSlug}.controldesk.app
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {sortedSections.map((section) => (
          <SidebarGroup key={section.labelKey}>
            <SidebarGroupLabel>{tSections(section.labelKey)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    (item.href !== "/dashboard" &&
                      pathname.startsWith(item.href));
                  const Icon = item.icon;
                  const label = tItems(item.titleKey);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={label}
                        render={
                          <Link href={item.href}>
                            <Icon />
                            <span>{label}</span>
                          </Link>
                        }
                      />
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent/40 px-2 py-2 text-xs text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden">
          <Sparkles className="size-4 text-primary" />
          <span className="leading-tight">{tNav("sidebarFooter")}</span>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
