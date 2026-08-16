"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";

import { Logo } from "@/components/brand/logo";
import { PwaInstallButton } from "@/components/pwa/pwa-install-button";

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
import { filterNavForRole, filterNavByAllowedCapabilities, type NavItem } from "@/lib/nav/config";
import type { CapabilityId } from "@/lib/rbac/capabilities";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";
import { cn } from "@/lib/utils";

/**
 * Visual polish overlay for the sidebar menu buttons.
 *
 * The shared `SidebarMenuButton` primitive from `components/ui/sidebar`
 * gives hover and active states the SAME `bg-sidebar-accent` — visually
 * indistinguishable except for the `font-medium` on active, which
 * users can't reliably see on short labels. We layer these overrides
 * so:
 *   • Active items get a 3px indigo accent bar on the left rail — the
 *     "you are here" affordance every enterprise nav has had since
 *     Notion/Linear popularised it.
 *   • Active icon adopts the primary colour so the whole row reads as
 *     one deliberate accent, not just "hover but sticky".
 *   • Hover stays soft (subtle bg tint) so it doesn't compete with
 *     the active row for attention when the user is arrowing through
 *     the list.
 *   • In icon-collapsed mode the accent bar collapses too — a 3px bar
 *     on a 32px square button looks like a mistake, so we hide it and
 *     rely on the bg + icon colour to signal state.
 *
 * All selectors are `data-active` because the primitive spreads a
 * `data-active="true"` attribute (via `useRender`'s `state.active`)
 * when `isActive` is truthy.
 */
const MENU_BUTTON_POLISH = cn(
  "relative",
  "before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-primary before:opacity-0 before:transition-opacity",
  "data-active:before:opacity-100",
  "group-data-[collapsible=icon]:before:hidden",
  "data-active:[&_svg]:text-primary",
  "data-active:bg-sidebar-accent/70",
  "hover:bg-sidebar-accent/40",
);

const GROUP_LABEL_POLISH = cn(
  "text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/50",
);

export function AppSidebar({
  role,
  allowedCapabilities,
  tenantName,
  tenantSlug,
}: {
  role: AnyDbEmployeeRole;
  /**
   * Capability IDs the caller currently has access to, computed on
   * the server via `resolveCapabilitiesFor().can(id)` and passed
   * down as a plain string array (serialisable across the RSC ↔
   * Client boundary). When absent (legacy call sites), we fall
   * back to the sync catalog-default filter.
   */
  allowedCapabilities?: readonly CapabilityId[];
  tenantName: string;
  tenantSlug: string;
}) {
  const pathname = usePathname();
  const locale = useLocale();
  const tSections = useTranslations("nav.sections");
  const tItems = useTranslations("nav.items");
  const tNav = useTranslations("nav");
  const sections = React.useMemo(
    () =>
      allowedCapabilities
        ? filterNavByAllowedCapabilities(role, allowedCapabilities)
        : filterNavForRole(role),
    [allowedCapabilities, role],
  );

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
    <Sidebar collapsible="icon" className="border-r border-sidebar-border/60">
      {/* Header — refined divider (border-b/50) so the transition into
          the scrollable menu list feels intentional, not accidental */}
      <SidebarHeader className="border-b border-sidebar-border/40 pb-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
          <Logo size={32} className="shrink-0" />
          <div className="flex flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
            <span className="truncate font-display text-sm font-semibold tracking-tight">
              {tenantName}
            </span>
            <span className="truncate text-[11px] text-sidebar-foreground/55">
              {tenantSlug}.controldesk.app
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-1 py-2">
        {sortedSections.map((section) => (
          <SidebarGroup key={section.labelKey} className="px-2 py-1">
            <SidebarGroupLabel className={GROUP_LABEL_POLISH}>
              {tSections(section.labelKey)}
            </SidebarGroupLabel>
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
                        className={MENU_BUTTON_POLISH}
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

      <SidebarFooter className="border-t border-sidebar-border/40 pt-3">
        <div className="flex flex-col gap-2 group-data-[collapsible=icon]:hidden">
          <PwaInstallButton variant="compact" />
          <div className="flex items-center gap-2 rounded-lg bg-sidebar-accent/40 px-2.5 py-2 text-[11px] leading-tight text-sidebar-accent-foreground">
            <Sparkles className="size-3.5 shrink-0 text-primary" />
            <span>{tNav("sidebarFooter")}</span>
          </div>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
