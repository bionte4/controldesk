import "server-only";

import type { LucideIcon } from "lucide-react";
import {
  BadgeDollarSign,
  FolderKanban,
  GitBranch,
  HandCoins,
  ReceiptText,
  Wallet,
} from "lucide-react";

import type { AnyDbEmployeeRole, EmployeeRole } from "@/lib/rbac/roles";

/**
 * Report registry — single source of truth for the metadata that the
 * `/reports` page uses to render the left "Choose a report" list.
 * Query implementations, CSV/XLSX/PDF serializers, and PDP allow-lists
 * all keys off `kind`. Add new reports here first; downstream code
 * fails at compile-time if the kind is unknown.
 *
 * Convention:
 *   - `kind` maps 1:1 to the route segment `/reports/[kind]` and the
 *     download API path `/api/reports/[kind]`.
 *   - `titleKey` / `descriptionKey` resolve against `reports.list.*`
 *     in `messages/{id,en}.json`.
 *   - `allowedRoles` is the union of roles that can *see* the card —
 *     RLS still scopes the actual data. E.g. PM can pick "Expense
 *     Register" but they only get expense rows on their assigned
 *     projects.
 *   - `filters` lists the parameter shape used by the shared filter
 *     form (implemented in `src/app/(app)/reports/filter-form.tsx`).
 */
export const REPORT_KINDS = [
  "project-portfolio",
  "expense-register",
  "cash-advance-register",
  "petty-cash-statement",
  "budget-vs-actual",
  "budget-request-register",
] as const;

export type ReportKind = (typeof REPORT_KINDS)[number];

export type ReportFilter =
  | "dateRange"
  | "project"
  | "projectMulti"
  | "fiscalYear"
  | "fund"
  | "expenseStatus"
  | "caStatus"
  | "brKind";

export type ReportMeta = {
  kind: ReportKind;
  icon: LucideIcon;
  titleKey: string;
  descriptionKey: string;
  /**
   * Union of every DB role string (legacy OR canonical GAS alias)
   * that may see this card. Kept as `AnyDbEmployeeRole[]` — not
   * `EmployeeRole[]` — because the DB emits both legacy and canonical
   * values during the Fase 0 dual-mode. We check membership via a
   * strict string `.includes()` (see `reportsForRole` below) so
   * PETTY_CASH_CUSTODIAN stays scoped to petty-cash reports even
   * though it folds to canonical `FINANCE` alongside LEAD_FINANCE.
   */
  allowedRoles: readonly AnyDbEmployeeRole[];
  filters: readonly ReportFilter[];
  /**
   * Default filter helper for the form — some reports default to
   * "current month" (registers) while others default to "current
   * fiscal year" (budget vs actual). Consumer picks a preset via this
   * hint.
   */
  defaultDateRange: "currentMonth" | "currentFiscalYear" | "last90Days";
};

// Legacy DB names + canonical GAS aliases side-by-side so a user
// seeded with either flavour can see the same reports. See rules §6
// on the dual-mode enum during Fase 0. Kept `TENANT_ADMIN` distinct
// from `HR_ADMIN` (both fold to `ADMIN` canonical) so canonical
// `ADMIN` remains ambiguous — reports gate through explicit legacy
// values, and canonical `ADMIN` is admitted here because the intent
// is "any admin-tier org role".
const CORE_FINANCE: readonly AnyDbEmployeeRole[] = [
  "LEAD_FINANCE",
  "OPERATIONS_MANAGER",
  "HEAD_MANAGER",
  "GENERAL_MANAGER",
  "TENANT_ADMIN",
  // Canonical GAS aliases:
  "FINANCE",
  "OM",
  "DIRECTOR",
  "ADMIN",
];

const FINANCE_PLUS_PM: readonly AnyDbEmployeeRole[] = [
  ...CORE_FINANCE,
  "PROJECT_MANAGER",
  "PM",
];

export const REPORT_REGISTRY: Readonly<Record<ReportKind, ReportMeta>> = {
  "project-portfolio": {
    kind: "project-portfolio",
    icon: FolderKanban,
    titleKey: "portfolio.title",
    descriptionKey: "portfolio.description",
    // Portfolio is scoped by RLS — PM only sees their projects, OM
    // sees their portfolio, Finance/Director see everything. Safe to
    // expose broadly.
    allowedRoles: FINANCE_PLUS_PM,
    filters: ["dateRange"],
    defaultDateRange: "last90Days",
  },
  "expense-register": {
    kind: "expense-register",
    icon: ReceiptText,
    titleKey: "expenseRegister.title",
    descriptionKey: "expenseRegister.description",
    allowedRoles: FINANCE_PLUS_PM,
    filters: ["dateRange", "projectMulti", "expenseStatus"],
    defaultDateRange: "currentMonth",
  },
  "cash-advance-register": {
    kind: "cash-advance-register",
    icon: Wallet,
    titleKey: "caRegister.title",
    descriptionKey: "caRegister.description",
    allowedRoles: FINANCE_PLUS_PM,
    filters: ["dateRange", "projectMulti", "caStatus"],
    defaultDateRange: "currentMonth",
  },
  "petty-cash-statement": {
    kind: "petty-cash-statement",
    icon: HandCoins,
    titleKey: "pettyCashStatement.title",
    descriptionKey: "pettyCashStatement.description",
    // Custodians can pull their own fund statement; Finance sees all
    // funds. PM is intentionally excluded — petty cash is a
    // custodian/finance domain per rules §10. Explicitly enumerates
    // both legacy + canonical role names since canonical `FINANCE`
    // folds LEAD_FINANCE with PETTY_CASH_CUSTODIAN, and we want the
    // gate here to remain explicit rather than lossy.
    allowedRoles: [
      "PETTY_CASH_CUSTODIAN",
      "LEAD_FINANCE",
      "OPERATIONS_MANAGER",
      "HEAD_MANAGER",
      "GENERAL_MANAGER",
      "TENANT_ADMIN",
      // Canonical GAS aliases (FINANCE folds LEAD_FINANCE +
      // PETTY_CASH_CUSTODIAN, so it's admitted regardless):
      "FINANCE",
      "OM",
      "DIRECTOR",
      "ADMIN",
    ],
    filters: ["dateRange", "fund"],
    defaultDateRange: "currentMonth",
  },
  "budget-vs-actual": {
    kind: "budget-vs-actual",
    icon: BadgeDollarSign,
    titleKey: "budgetVsActual.title",
    descriptionKey: "budgetVsActual.description",
    allowedRoles: FINANCE_PLUS_PM,
    filters: ["fiscalYear", "project"],
    defaultDateRange: "currentFiscalYear",
  },
  "budget-request-register": {
    kind: "budget-request-register",
    icon: GitBranch,
    titleKey: "budgetRequestRegister.title",
    descriptionKey: "budgetRequestRegister.description",
    allowedRoles: FINANCE_PLUS_PM,
    filters: ["dateRange", "projectMulti", "brKind"],
    defaultDateRange: "currentMonth",
  },
};

/**
 * Filter the registry to the reports a given role is allowed to see.
 * Used by the RSC `/reports` page to render the card list.
 *
 * Uses strict string `.includes()` (NOT the canonical fold from
 * `roleInGate`) because petty-cash reports legitimately want to
 * distinguish `PETTY_CASH_CUSTODIAN` from `LEAD_FINANCE` even
 * though both fold to canonical `FINANCE`. Each `allowedRoles`
 * list therefore explicitly enumerates both flavours (legacy DB
 * name + canonical GAS alias) — see `CORE_FINANCE` /
 * `FINANCE_PLUS_PM` above for the shared bases.
 */
export function reportsForRole(role: AnyDbEmployeeRole): ReportMeta[] {
  return REPORT_KINDS.map((k) => REPORT_REGISTRY[k]).filter((r) =>
    r.allowedRoles.includes(role),
  );
}

export function isValidReportKind(v: string): v is ReportKind {
  return (REPORT_KINDS as readonly string[]).includes(v);
}
