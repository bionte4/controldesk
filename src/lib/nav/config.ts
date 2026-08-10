import {
  Archive,
  ArrowLeftRight,
  BadgeDollarSign,
  Banknote,
  BookOpen,
  BrainCircuit,
  Briefcase,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Coins,
  FileClock,
  FileText,
  Home,
  KeyRound,
  LayoutGrid,
  LineChart,
  ListTree,
  Plug,
  ReceiptText,
  Scale,
  ShieldCheck,
  Sparkles,
  ToggleRight,
  Upload,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { defaultRolesFor, type CapabilityId } from "@/lib/rbac/capabilities";
import type { CapabilitySet } from "@/lib/rbac/capability-resolver";
import {
  roleInGate,
  type AnyDbEmployeeRole,
  type EmployeeRole,
} from "@/lib/rbac/roles";
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
  /**
   * Legacy role gate — plain list of roles that see the item. Kept
   * for entries that don't map to a capability (e.g. `settings/users`,
   * `settings/lookups`). When `capabilityId` is also set,
   * `capabilityId` wins.
   */
  roles?: readonly EmployeeRole[];
  /**
   * Fase 2 capability-based gate. When set, the sidebar filter
   * consults `CapabilitySet.can(id)` — which folds catalog defaults
   * with per-tenant overrides from `tenant_capability_overrides`.
   * This is the preferred gate for anything that maps 1:1 to a
   * capability in `src/lib/rbac/capabilities.ts`; the admin toggle
   * UI at `/settings/capabilities` mutates the same set.
   *
   * When BOTH `capabilityId` and `roles` are set, `capabilityId`
   * takes precedence (allows a graceful migration path for items
   * we haven't converted yet).
   */
  capabilityId?: CapabilityId;
  /**
   * Pin this item to the top of its section, above the alphabetized
   * rest. Used for section entry-point items like "Overview" under
   * Settings that should stay in a predictable slot regardless of
   * how their translated label sorts. Multiple pinned items keep
   * their config-file order relative to each other.
   */
  pinned?: boolean;
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
        // AI insight cards synthesize cross-project data — mirrors
        // catalog capability `view_insights`. Both the sidebar and
        // the `/insights` page consume `CapabilitySet.can()` so a
        // tenant override at `/settings/capabilities` applies to
        // both surfaces simultaneously.
        capabilityId: "view_insights",
      },
    ],
  },
  {
    labelKey: "delivery",
    items: [
      {
        titleKey: "clients",
        href: "/clients",
        icon: Briefcase,
        // Client directory + commercial history — capability
        // `view_client`. EMPLOYEE / SUPERVISOR see clients only via
        // their own project detail pages (rules §8 delivery-layer
        // scoping); page redirect enforces the same capability.
        capabilityId: "view_client",
      },
      { titleKey: "projects", href: "/projects", icon: ClipboardList },
      {
        titleKey: "assignments",
        href: "/assignments",
        icon: UserPlus,
        // Cross-project PM + employee allocation matrix — capability
        // `view_assignment` (management + HR utilization planning).
        capabilityId: "view_assignment",
      },
      // NOTE: "Team" nav entry retired — the staff directory lives at
      // /hr/employees (People > Karyawan) as of the Employees module. The
      // legacy `/team` URL still resolves via a server redirect so old
      // bookmarks remain valid; see `src/app/(app)/team/page.tsx`.
      {
        titleKey: "handovers",
        href: "/handovers",
        icon: ArrowLeftRight,
        // PM handover notes — capability `view_handover`.
        capabilityId: "view_handover",
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
        // Petty cash operators + management oversight — capability
        // `view_petty_cash`. RLS on petty cash tables is tenant-only,
        // so both list and detail pages consume the same capability.
        capabilityId: "view_petty_cash",
      },
      {
        titleKey: "budgets",
        href: "/finance/budgets",
        icon: BadgeDollarSign,
        // Budget planning — capability `view_budget`. Same capability
        // hides the Dashboard KPI + Projects Budget column + project
        // detail Budget/Expenses cards.
        capabilityId: "view_budget",
      },
      {
        titleKey: "contracts",
        href: "/finance/contracts",
        icon: FileText,
        // Commercial contracts (MRR, contract value, SLA terms) —
        // capability `view_contract`. High-sensitivity: admin
        // toggle at `/settings/capabilities` warns before grants.
        capabilityId: "view_contract",
      },
      { titleKey: "approvals", href: "/approvals", icon: ShieldCheck },
    ],
  },
  {
    labelKey: "people",
    items: [
      // Staff directory — capability `view_employee_directory`.
      // Row-level scoping (SPV/PM see teammates, OM portfolio,
      // HR/Finance/Admin everyone) is enforced inside the page by
      // `resolveEmployeeScope()`; this gate just controls whether
      // the sidebar link renders at all.
      {
        titleKey: "employees",
        href: "/hr/employees",
        icon: Users,
        capabilityId: "view_employee_directory",
      },
      { titleKey: "roster", href: "/hr/roster", icon: CalendarDays },
      {
        titleKey: "shifts",
        href: "/hr/shifts",
        icon: CalendarClock,
        // Read is unrestricted, but only shift writers see the sidebar
        // entry — mirrors PDP `decideWorkShift` write matrix so we
        // don't tease a link that leads to notFound() for employees.
        roles: [
          "HR_ADMIN",
          "TENANT_ADMIN",
          "GENERAL_MANAGER",
          "HEAD_MANAGER",
          "OPERATIONS_MANAGER",
          "PROJECT_MANAGER",
          "SUPERVISOR",
        ],
      },
      {
        titleKey: "timesheets",
        href: "/hr/timesheets",
        icon: ClipboardCheck,
      },
      { titleKey: "leaveOvertime", href: "/hr/requests", icon: FileClock },
      {
        titleKey: "performance",
        href: "/hr/performance",
        icon: BadgeDollarSign,
        // HR performance evaluations — capability `view_performance`.
        // Row-level RLS on `performance_evaluations` (migration 0059)
        // is complementary.
        capabilityId: "view_performance",
      },
      {
        titleKey: "upk",
        href: "/hr/upk",
        icon: Banknote,
        // Termination severance (UPK) notes — capability `view_upk`.
        // High-sensitivity: admin toggle at `/settings/capabilities`
        // warns before non-default grants.
        capabilityId: "view_upk",
      },
      {
        titleKey: "payroll",
        href: "/hr/payroll",
        icon: Banknote,
        // Payroll periods + line items — capability `view_payroll`.
        // Migration 0080 RLS-gates the tables to
        // `is_payroll_operator()` as a second line of defence.
        capabilityId: "view_payroll",
      },
    ],
  },
  {
    labelKey: "analytics",
    items: [
      {
        titleKey: "reports",
        href: "/reports",
        icon: LineChart,
        // Reports expose cross-project financials (budgets, expenses,
        // cash advances, petty cash) — kept out of EMPLOYEE /
        // SUPERVISOR reach. PM+ tiers can run reports scoped to what
        // they can see (RLS enforces the actual data guard on top).
        roles: [
          "PROJECT_MANAGER",
          "OPERATIONS_MANAGER",
          "HEAD_MANAGER",
          "GENERAL_MANAGER",
          "LEAD_FINANCE",
          "HR_ADMIN",
          "TENANT_ADMIN",
        ],
      },
    ],
  },
  {
    labelKey: "settings",
    items: [
      // Hub + Preferences are visible to every authenticated user
      // (no `roles` gate) so employees can reach their own account
      // preferences from the sidebar. Admin sub-items below stay
      // role-gated per rules §6.
      //
      // `Overview` is pinned so it stays at the top after the sort
      // pass in `<AppSidebar>` — otherwise it would drift somewhere
      // into the middle of the alphabetical list.
      {
        titleKey: "overview",
        href: "/settings",
        icon: LayoutGrid,
        pinned: true,
      },
      {
        titleKey: "preferences",
        href: "/settings/preferences",
        icon: Sparkles,
      },
      {
        titleKey: "users",
        href: "/settings/users",
        icon: UserCog,
        roles: ["TENANT_ADMIN", "HR_ADMIN"],
      },
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
      {
        titleKey: "lookups",
        href: "/settings/lookups",
        icon: ListTree,
        roles: ["TENANT_ADMIN", "GENERAL_MANAGER"],
      },
      {
        titleKey: "approvalThresholds",
        href: "/settings/approval-thresholds",
        icon: Scale,
        // Mirrors the settings-hub tile gate (`ADMIN_TILES`). DB RLS on
        // `public.approval_thresholds` (migration 0024) enforces the
        // same ADMIN/DIRECTOR write policy at the row layer as a second
        // line of defence.
        roles: ["TENANT_ADMIN", "GENERAL_MANAGER"],
      },
      {
        titleKey: "capabilities",
        href: "/settings/capabilities",
        icon: ShieldCheck,
        // Fase 2 capability toggle matrix. Same admin gate as the
        // approval thresholds surface — RLS on
        // `tenant_capability_overrides` (migration 0081) enforces
        // ADMIN + DIRECTOR write policy at the row layer.
        roles: ["TENANT_ADMIN", "GENERAL_MANAGER"],
      },
      {
        titleKey: "features",
        href: "/settings/features",
        icon: ToggleRight,
        // Read-only view of the tenant's feature flags (Fase 5). Toggle
        // is platform-admin only via /super-admin/tenants/{id} —
        // enforced by migration 0077 RLS policy
        // `tenant_feature_flags_platform_write`.
        roles: ["TENANT_ADMIN", "GENERAL_MANAGER"],
      },
      {
        titleKey: "coa",
        href: "/settings/coa",
        icon: BookOpen,
        roles: ["TENANT_ADMIN", "LEAD_FINANCE"],
      },
      {
        titleKey: "bulkImport",
        href: "/settings/bulk-import",
        icon: Upload,
        roles: [
          "TENANT_ADMIN",
          "HR_ADMIN",
          "LEAD_FINANCE",
          "GENERAL_MANAGER",
          "HEAD_MANAGER",
          "OPERATIONS_MANAGER",
        ],
      },
      {
        titleKey: "integrations",
        href: "/settings/integrations",
        icon: Plug,
        roles: ["TENANT_ADMIN", "GENERAL_MANAGER"],
      },
    ],
  },
];

/**
 * Filter the nav config for a caller with a resolved
 * `CapabilitySet` in hand. Server-side entry point — used by
 * anywhere that already has the resolver instance (server actions,
 * page-level RSCs). Client components cannot use this directly
 * because `CapabilitySet` methods can't cross the RSC ↔ Client
 * boundary; those consumers should call
 * `filterNavByAllowedCapabilities` with a plain string array
 * instead.
 *
 * When both `capabilityId` and `roles` are present on an item,
 * `capabilityId` wins so a tenant override at
 * `/settings/capabilities` always has the final say.
 */
export function filterNavForCaller(
  role: AnyDbEmployeeRole,
  caps: CapabilitySet,
): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (item.capabilityId) return caps.can(item.capabilityId);
      if (item.roles) return roleInGate(role, item.roles);
      return true;
    }),
  })).filter((section) => section.items.length > 0);
}

/**
 * Serialisation-safe filter for client components. Takes the
 * caller's list of allowed capability IDs (a plain string array,
 * as computed by the RSC layout) and returns only the sections /
 * items they can see. Legacy `roles` gates fall through to the
 * client-side role check.
 */
export function filterNavByAllowedCapabilities(
  role: AnyDbEmployeeRole,
  allowed: readonly CapabilityId[],
): NavSection[] {
  const allowedSet = new Set<string>(allowed);
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (item.capabilityId) return allowedSet.has(item.capabilityId);
      if (item.roles) return roleInGate(role, item.roles);
      return true;
    }),
  })).filter((section) => section.items.length > 0);
}

/**
 * Legacy sync filter — no capability awareness. Retained for
 * consumers that legitimately can't await (unit tests, non-server
 * code). App-shell consumers should call `filterNavForCaller` from
 * an RSC layout with the resolved `CapabilitySet`.
 *
 * `roleInGate` folds canonical + legacy on both sides so a user
 * seeded with `role='PM'` sees every item declared with
 * `PROJECT_MANAGER` (and vice versa). Keeps the sidebar drift-free
 * during the Fase 0 legacy/canonical dual-mode.
 *
 * @deprecated Prefer `filterNavForCaller` — this variant cannot see
 * per-tenant capability overrides. Kept only for isomorphic use
 * cases.
 */
export function filterNavForRole(role: AnyDbEmployeeRole): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (item.capabilityId) {
        // No capability set available in sync context — fall back
        // to catalog defaults so items don't disappear from tests
        // just because they migrated to capabilityId.
        return roleInGate(role, defaultRolesFor(item.capabilityId));
      }
      if (item.roles) return roleInGate(role, item.roles);
      return true;
    }),
  })).filter((section) => section.items.length > 0);
}
