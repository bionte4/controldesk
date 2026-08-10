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

import {
  ASSIGNMENT_VIEWER_ROLES,
  BUDGET_VIEWER_ROLES,
  CLIENT_VIEWER_ROLES,
  CONTRACT_VIEWER_ROLES,
  EMPLOYEE_DIRECTORY_VIEWER_ROLES,
  HANDOVER_VIEWER_ROLES,
  INSIGHTS_VIEWER_ROLES,
  PAYROLL_VIEWER_ROLES,
  PERFORMANCE_VIEWER_ROLES,
  PETTY_CASH_VIEWER_ROLES,
  roleInGate,
  UPK_VIEWER_ROLES,
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
  /** If set, the item is only shown when the current role is in the list. */
  roles?: readonly EmployeeRole[];
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
        // `INSIGHTS_VIEWER_ROLES` in `src/lib/rbac/roles.ts`. The
        // `/insights` page also enforces the same list as a redirect
        // guard because RLS on `ai_insights` is tenant-only.
        roles: INSIGHTS_VIEWER_ROLES,
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
        // Client directory + commercial history. Sidebar + page
        // redirect both source from `CLIENT_VIEWER_ROLES` so EMPLOYEE
        // / SUPERVISOR see clients only via their own project detail
        // pages (rules §8 delivery-layer scoping).
        roles: CLIENT_VIEWER_ROLES,
      },
      { titleKey: "projects", href: "/projects", icon: ClipboardList },
      {
        titleKey: "assignments",
        href: "/assignments",
        icon: UserPlus,
        // Cross-project PM + employee allocation matrix — management
        // + HR (utilization planning). Mirrors `ASSIGNMENT_VIEWER_ROLES`.
        roles: ASSIGNMENT_VIEWER_ROLES,
      },
      // NOTE: "Team" nav entry retired — the staff directory lives at
      // /hr/employees (People > Karyawan) as of the Employees module. The
      // legacy `/team` URL still resolves via a server redirect so old
      // bookmarks remain valid; see `src/app/(app)/team/page.tsx`.
      {
        titleKey: "handovers",
        href: "/handovers",
        icon: ArrowLeftRight,
        // PM handover notes. Mirrors `HANDOVER_VIEWER_ROLES` — the
        // list now includes PROJECT_MANAGER (they own the outgoing +
        // incoming perspective) so the link isn't a dead-end for PMs.
        roles: HANDOVER_VIEWER_ROLES,
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
        // Petty cash operators + management oversight. Mirrors
        // `PETTY_CASH_VIEWER_ROLES` in `src/lib/rbac/roles.ts` — the
        // `/finance/petty-cash` + `[id]` pages enforce the same list
        // as a redirect guard because RLS on petty cash tables is
        // tenant-only.
        roles: PETTY_CASH_VIEWER_ROLES,
      },
      {
        titleKey: "budgets",
        href: "/finance/budgets",
        icon: BadgeDollarSign,
        // Budget planning (total_planned per project, budget_details
        // line items) is a finance/management concern. RLS on
        // `budgets` + `budget_details` is tenant-only, so both the
        // list and detail pages enforce `BUDGET_VIEWER_ROLES` as a
        // redirect guard. Sidebar gate mirrors the same list.
        roles: BUDGET_VIEWER_ROLES,
      },
      {
        titleKey: "contracts",
        href: "/finance/contracts",
        icon: FileText,
        // Contract data (MRR, contract value, SLA commercial terms) is
        // commercially sensitive. Mirrors the DB update policy
        // `bpo_contracts_finance_update` so the sidebar link is only
        // visible to roles that can also meaningfully act on contracts.
        // The `/finance/contracts` page + `/finance/contracts/[id]`
        // page both enforce the same list at the page layer because
        // the DB read policy is tenant-only (see
        // `CONTRACT_VIEWER_ROLES` in `src/lib/rbac/roles.ts`).
        roles: CONTRACT_VIEWER_ROLES,
      },
      { titleKey: "approvals", href: "/approvals", icon: ShieldCheck },
    ],
  },
  {
    labelKey: "people",
    items: [
      // Staff directory is HR/mgmt only — plain EMPLOYEE and PCC
      // have no operational need for the org chart. Scoping
      // (SPV/PM see teammates, OM portfolio, HR/Finance/Admin
      // everyone) is enforced inside the page by
      // `resolveEmployeeScope()`; this gate just controls the
      // sidebar link so a denied role never sees a dead link.
      {
        titleKey: "employees",
        href: "/hr/employees",
        icon: Users,
        roles: EMPLOYEE_DIRECTORY_VIEWER_ROLES,
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
        // HR performance evaluations. RLS on `performance_evaluations`
        // already limits rows to HR/Mgmt OR the SPV/PM/OM who own the
        // row (see migration 0059), so an EMPLOYEE hitting this page
        // would see an empty list. Gate the sidebar entry (and add a
        // page-level redirect) so we don't tease a dead-end link.
        roles: PERFORMANCE_VIEWER_ROLES,
      },
      {
        titleKey: "upk",
        href: "/hr/upk",
        icon: Banknote,
        // Termination severance (UPK) notes. RLS on `upk_notes`
        // limits rows to HR/Mgmt or drafter, but the page shell
        // still exposes sensitive terminology. Sidebar + page
        // redirect both mirror `UPK_VIEWER_ROLES`.
        roles: UPK_VIEWER_ROLES,
      },
      {
        titleKey: "payroll",
        href: "/hr/payroll",
        icon: Banknote,
        // Rules §3 salary confidentiality. Payroll periods + line
        // items now RLS-gated to `is_payroll_operator()` (see
        // migration 0080). Sidebar gate matches `PAYROLL_VIEWER_ROLES`.
        roles: PAYROLL_VIEWER_ROLES,
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

export function filterNavForRole(role: AnyDbEmployeeRole): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    // `roleInGate` folds canonical + legacy on both sides so a user
    // seeded with `role='PM'` sees every item declared with
    // `PROJECT_MANAGER` (and vice versa). Keeps the sidebar drift-free
    // during the Fase 0 legacy/canonical dual-mode.
    items: section.items.filter(
      (item) => !item.roles || roleInGate(role, item.roles),
    ),
  })).filter((section) => section.items.length > 0);
}
