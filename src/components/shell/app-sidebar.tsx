"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { filterNavForRole } from "@/lib/nav/config";
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
  const tSections = useTranslations("nav.sections");
  const tItems = useTranslations("nav.items");
  const tNav = useTranslations("nav");
  const sections = React.useMemo(() => filterNavForRole(role), [role]);

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
        {sections.map((section) => (
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
