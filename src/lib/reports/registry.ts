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

import type { EmployeeRole } from "@/lib/rbac/roles";

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
  allowedRoles: readonly EmployeeRole[];
  filters: readonly ReportFilter[];
  /**
   * Default filter helper for the form — some reports default to
   * "current month" (registers) while others default to "current
   * fiscal year" (budget vs actual). Consumer picks a preset via this
   * hint.
   */
  defaultDateRange: "currentMonth" | "currentFiscalYear" | "last90Days";
};

const CORE_FINANCE: readonly EmployeeRole[] = [
  "LEAD_FINANCE",
  "OPERATIONS_MANAGER",
  "HEAD_MANAGER",
  "GENERAL_MANAGER",
  "TENANT_ADMIN",
];

const FINANCE_PLUS_PM: readonly EmployeeRole[] = [
  ...CORE_FINANCE,
  "PROJECT_MANAGER",
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
    // custodian/finance domain per rules §10.
    allowedRoles: [
      "PETTY_CASH_CUSTODIAN",
      "LEAD_FINANCE",
      "OPERATIONS_MANAGER",
      "HEAD_MANAGER",
      "GENERAL_MANAGER",
      "TENANT_ADMIN",
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
 */
export function reportsForRole(role: EmployeeRole): ReportMeta[] {
  return REPORT_KINDS.map((k) => REPORT_REGISTRY[k]).filter((r) =>
    r.allowedRoles.includes(role),
  );
}

export function isValidReportKind(v: string): v is ReportKind {
  return (REPORT_KINDS as readonly string[]).includes(v);
}
