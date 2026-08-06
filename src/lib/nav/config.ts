import {
  Archive,
  ArrowLeftRight,
  BadgeDollarSign,
  Banknote,
  BrainCircuit,
  Briefcase,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Coins,
  FileClock,
  Home,
  KeyRound,
  LineChart,
  ReceiptText,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { AnyDbEmployeeRole, EmployeeRole } from "@/lib/rbac/roles";
import type idMessages from "../../../messages/id.json";

/**
 * NavItem holds *translation keys* rather than raw strings so the shell can
 * render in either `id` or `en` without duplicating this config (rules §18).
 * Resolve via `useTranslations("nav.items")` / `("nav.sections")` at the
 * render site.
 *
 * Key types are derived from the id.json message dictionary so both this
 * config and the dictionaries stay perfectly in sync at compile time.
 */
export type NavItemKey = keyof typeof idMessages.nav.items;
export type NavSectionKey = keyof typeof idMessages.nav.sections;

export type NavItem = {
  /** Key under `nav.items.*` in the message dictionary. */
  titleKey: NavItemKey;
  href: string;
  icon: LucideIcon;
  /** If set, the item is only shown when the current role is in the list. */
  roles?: readonly EmployeeRole[];
};

export type NavSection = {
  /** Key under `nav.sections.*` in the message dictionary. */
  labelKey: NavSectionKey;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    labelKey: "overview",
    items: [
      { titleKey: "dashboard", href: "/dashboard", icon: Home },
      {
        titleKey: "insights",
        href: "/insights",
        icon: BrainCircuit,
        roles: [
          "TENANT_ADMIN",
          "GENERAL_MANAGER",
          "HEAD_MANAGER",
          "OPERATIONS_MANAGER",
          "PROJECT_MANAGER",
          "LEAD_FINANCE",
        ],
      },
    ],
  },
  {
    labelKey: "delivery",
    items: [
      { titleKey: "clients", href: "/clients", icon: Briefcase },
      { titleKey: "projects", href: "/projects", icon: ClipboardList },
      { titleKey: "team", href: "/team", icon: Users },
      {
        titleKey: "handovers",
        href: "/handovers",
        icon: ArrowLeftRight,
        roles: [
          "OPERATIONS_MANAGER",
          "HEAD_MANAGER",
          "GENERAL_MANAGER",
          "TENANT_ADMIN",
        ],
      },
    ],
  },
  {
    labelKey: "finance",
    items: [
      { titleKey: "expenses", href: "/finance/expenses", icon: ReceiptText },
      {
        titleKey: "cashAdvance",
        href: "/finance/cash-advances",
        icon: Wallet,
      },
      {
        titleKey: "pettyCash",
        href: "/finance/petty-cash",
        icon: Coins,
        roles: [
          "PETTY_CASH_CUSTODIAN",
          "LEAD_FINANCE",
          "TENANT_ADMIN",
          "GENERAL_MANAGER",
          "HEAD_MANAGER",
          "OPERATIONS_MANAGER",
          "PROJECT_MANAGER",
        ],
      },
      { titleKey: "budgets", href: "/finance/budgets", icon: BadgeDollarSign },
      { titleKey: "approvals", href: "/approvals", icon: ShieldCheck },
    ],
  },
  {
    labelKey: "people",
    items: [
      { titleKey: "roster", href: "/hr/roster", icon: CalendarDays },
      {
        titleKey: "timesheets",
        href: "/hr/timesheets",
        icon: ClipboardCheck,
      },
      { titleKey: "leaveOvertime", href: "/hr/requests", icon: FileClock },
      {
        titleKey: "payroll",
        href: "/hr/payroll",
        icon: Banknote,
        roles: ["LEAD_FINANCE", "HR_ADMIN", "TENANT_ADMIN", "GENERAL_MANAGER"],
      },
    ],
  },
  {
    labelKey: "analytics",
    items: [{ titleKey: "reports", href: "/reports", icon: LineChart }],
  },
  {
    labelKey: "settings",
    items: [
      {
        titleKey: "archives",
        href: "/settings/archives",
        icon: Archive,
        roles: ["TENANT_ADMIN", "GENERAL_MANAGER"],
      },
      {
        titleKey: "secrets",
        href: "/settings/secrets",
        icon: KeyRound,
        roles: ["TENANT_ADMIN", "GENERAL_MANAGER"],
      },
    ],
  },
];

export function filterNavForRole(role: AnyDbEmployeeRole): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !item.roles || item.roles.includes(role as EmployeeRole),
    ),
  })).filter((section) => section.items.length > 0);
}
