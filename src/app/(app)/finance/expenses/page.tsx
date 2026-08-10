import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { FinanceStatusBadge } from "@/components/finance/finance-status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatInTz } from "@/lib/format/date";
import { businessDaysUntil } from "@/lib/format/business-days";
import { formatIDR, parseMoneyFromDb } from "@/lib/format/money";
import { requireCurrentEmployee } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/expenses/state";
import { EXPENSE_CATEGORIES } from "@/lib/validation/expense";
import type { AnyDbEmployeeRole } from "@/lib/rbac/roles";
import {
  buildApproverOrSelfClause,
  isApproverRole,
  resolveProjectScope,
} from "@/lib/security/project-scope";
import type { ExpensePaymentMethod, ExpenseStatus } from "@/types/database";

import { NewExpenseSheet, type ProjectOption } from "./new-expense-sheet";

export const metadata: Metadata = {
  title: "Expenses",
};

type ExpenseRow = {
  id: string;
  amount_db: string | number;
  category: string;
  description: string;
  status: ExpenseStatus;
  incurred_on: string;
  created_at: string;
  updated_at: string;
  project_code: string;
  project_name: string;
  submitter_employee_id: string;
  payment_method: ExpensePaymentMethod | null;
  late_submission_reason: string | null;
};

type StatusFilter =
  | "ALL"
  | "MY_DRAFTS"
  | "PENDING"
  | "APPROVED"
  | "REJECTED";

const PENDING_STATUSES: ExpenseStatus[] = [
  "PENDING_L1_SUPERVISOR",
  "PENDING_L2_PROJECT_MANAGER",
  "PENDING_L2_5_FINANCE",
  "PENDING_L3_OPERATIONS_MANAGER",
  "PENDING_L4_HEAD_MANAGER",
  "PENDING_L5_GENERAL_MANAGER",
];

async function loadExpenses(input: {
  caller: { id: string; role: AnyDbEmployeeRole };
  filter: StatusFilter;
}): Promise<ExpenseRow[]> {
  const supabase = await createClient();

  // Rules §3 — approver-OR-self project scope. This is the *primary*
  // visibility gate; the status-filter switch below is a secondary
  // slice that always AND-composes on top. Non-approvers only see
  // their own submissions regardless of which status tab they open.
  const scope = await resolveProjectScope(input.caller);
  const scopeClause = buildApproverOrSelfClause(
    scope,
    input.caller.id,
    "submitter_employee_id",
    { treatAsApprover: isApproverRole(input.caller.role) },
  );

  let query = supabase
    .from("project_expenses")
    .select(
      "id, amount, category, description, status, incurred_on, created_at, updated_at, submitter_employee_id, payment_method, late_submission_reason, projects(code, name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (scopeClause === "self") {
    query = query.eq("submitter_employee_id", input.caller.id);
  } else if (scopeClause !== null) {
    query = query.or(scopeClause);
  }

  // Filter logic. NOTE: DRAFT rows are hidden from non-submitters at
  // the UI layer here. RLS still lets them read, but that's fine —
  // the list view just doesn't clutter with drafts owned by other
  // people. The DRAFT hide is redundant when scopeClause="self" but
  // idempotent, so we leave the switch untouched for the other tabs.
  switch (input.filter) {
    case "MY_DRAFTS":
      query = query
        .eq("status", "DRAFT")
        .eq("submitter_employee_id", input.caller.id);
      break;
    case "PENDING":
      query = query.in("status", PENDING_STATUSES);
      break;
    case "APPROVED":
      query = query.eq("status", "APPROVED");
      break;
    case "REJECTED":
      query = query.in("status", ["REJECTED", "CANCELLED"]);
      break;
    case "ALL":
    default:
      // Show everything except drafts owned by other people.
      query = query.or(
        `status.neq.DRAFT,submitter_employee_id.eq.${input.caller.id}`,
      );
      break;
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row) => {
    const proj = row.projects as unknown as {
      code: string;
      name: string;
    } | null;
    return {
      id: row.id,
      amount_db: row.amount,
      category: row.category,
      description: row.description,
      status: row.status as ExpenseStatus,
      incurred_on: row.incurred_on,
      created_at: row.created_at,
      updated_at: row.updated_at ?? row.created_at,
      project_code: proj?.code ?? "—",
      project_name: proj?.name ?? "—",
      submitter_employee_id: row.submitter_employee_id,
      payment_method: row.payment_method,
      late_submission_reason: row.late_submission_reason,
    };
  });
}

/**
 * Return a `{tone,label}` hint for stale DRAFT rows (>= 7 wd since last
 * update) and late-submitted rows (`late_submission_reason` populated).
 * Returns `null` when the row is healthy — the caller skips rendering.
 */
function computeExpenseSlaHint(
  row: Pick<
    ExpenseRow,
    "status" | "updated_at" | "late_submission_reason"
  >,
): { tone: string; label: string } | null {
  if (row.status === "DRAFT") {
    const wdOld = -businessDaysUntil(row.updated_at, new Date());
    if (wdOld >= 7) {
      return {
        tone: "border-amber-500/50 bg-amber-500/15 text-amber-200",
        label: `Stale ${wdOld} wd`,
      };
    }
    return null;
  }
  if (row.late_submission_reason && row.late_submission_reason.length > 0) {
    return {
      tone: "border-amber-400/40 bg-amber-500/10 text-amber-300",
      label: "Nota telat",
    };
  }
  return null;
}

/**
 * Load project options for the New Expense sheet.
 *
 * Scoping mirrors `/finance/cash-advances::loadProjectOptions`:
 *   - Org / approver roles (PM / OM / DIRECTOR / ADMIN / FINANCE)
 *     see every live project in the tenant so they can back-file
 *     expenses on any engagement.
 *   - Everyone else (EMPLOYEE / SUPERVISOR / PCC / HR) only sees
 *     projects with an ACTIVE assignment through any of the three
 *     assignment tables — same union RLS uses.
 *
 * Leaving this open would leak the entire project register to
 * unassigned employees (project codes/names are considered
 * sensitive per rules §3) and would also produce a UX trap where
 * picking an unrelated project would fail PDP with an opaque
 * "not authorized" error.
 */
async function loadProjectOptions(actor: {
  id: string;
  role: AnyDbEmployeeRole;
}): Promise<ProjectOption[]> {
  const supabase = await createClient();
  const scope = await resolveProjectScope(actor);
  let base = supabase
    .from("projects")
    .select("id, code, name")
    .in("status", ["PLANNING", "ACTIVE"])
    .order("name", { ascending: true })
    .limit(200);
  if (scope.kind !== "org") {
    if (scope.empty) return [];
    base = base.in("id", scope.projectIds);
  }
  const { data, error } = await base;
  if (error || !data) return [];
  return data.map((p) => ({ id: p.id, label: `${p.code} · ${p.name}` }));
}

const FILTERS: readonly { id: StatusFilter; labelKey: string }[] = [
  { id: "ALL", labelKey: "filters.all" },
  { id: "MY_DRAFTS", labelKey: "filters.myDrafts" },
  { id: "PENDING", labelKey: "filters.pending" },
  { id: "APPROVED", labelKey: "filters.approved" },
  { id: "REJECTED", labelKey: "filters.rejected" },
] as const;

function parseFilter(raw: string | undefined): StatusFilter {
  const found = FILTERS.find((f) => f.id === raw);
  return found?.id ?? "ALL";
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const filter = parseFilter(sp.status);

  const [employee, t, tCat] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("expenses"),
    getTranslations("expenses.categories"),
  ]);
  const caller = {
    id: employee.id,
    role: employee.role as AnyDbEmployeeRole,
  };
  const [expenses, projectOptions] = await Promise.all([
    loadExpenses({ caller, filter }),
    loadProjectOptions(caller),
  ]);

  // Field-level submitters (EMPLOYEE / SUPERVISOR / HR / PettyCash) don't see
  // the MA (budget line) selector — PM / Finance / OM+ / TENANT_ADMIN classify
  // during their review. Keeps sensitive budget breakdown out of low-privilege
  // sightlines and matches the mockup's approver-driven coding flow.
  const MA_PICKERS: readonly string[] = [
    "PROJECT_MANAGER",
    "LEAD_FINANCE",
    "OPERATIONS_MANAGER",
    "HEAD_MANAGER",
    "GENERAL_MANAGER",
    "TENANT_ADMIN",
  ];
  const canPickBudgetLine = MA_PICKERS.includes(employee.role as string);

  // CoA picker is gated on the same set of roles. Options are fetched
  // dynamically inside the sheet as the project changes, so no
  // pre-loading here.
  const canPickCoa = canPickBudgetLine;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label-meta">{t("kicker")}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t("subtitle")}
          </p>
        </div>
        <NewExpenseSheet
          projects={projectOptions}
          canPickBudgetLine={canPickBudgetLine}
          canPickCoa={canPickCoa}
        />
      </header>

      {/* Status tabs */}
      <nav
        aria-label="Filter by status"
        className="flex flex-wrap items-center gap-1 border-b border-border/60"
      >
        {FILTERS.map((f) => {
          const isActive = f.id === filter;
          const href =
            f.id === "ALL"
              ? "/finance/expenses"
              : `/finance/expenses?status=${f.id}`;
          return (
            <Link
              key={f.id}
              href={href}
              className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(f.labelKey as "filters.all")}
            </Link>
          );
        })}
      </nav>

      {expenses.length === 0 ? (
        <Card className="glass">
          <CardHeader className="items-center text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Receipt className="size-6" />
            </div>
            <CardTitle className="font-display text-xl">{t("empty")}</CardTitle>
            <CardDescription className="max-w-md text-center">
              {t("emptyBody")}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card className="glass overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left">
                    <Th>{t("columns.date")}</Th>
                    <Th>{t("columns.project")}</Th>
                    <Th>{t("columns.description")}</Th>
                    <Th>{t("columns.category")}</Th>
                    <Th>{t("columns.paymentMethod")}</Th>
                    <Th className="text-right">{t("columns.amount")}</Th>
                    <Th>{t("columns.status")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr
                      key={e.id}
                      className="border-t border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {formatInTz(e.incurred_on, "dd MMM yyyy")}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {e.project_code}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/finance/expenses/${e.id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {e.description}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {(EXPENSE_CATEGORIES as readonly string[]).includes(
                          e.category,
                        )
                          ? tCat(
                              e.category as (typeof EXPENSE_CATEGORIES)[number],
                            )
                          : e.category}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {e.payment_method
                          ? t(
                              `paymentMethods.${e.payment_method}` as "paymentMethods.CASH",
                            )
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatIDR(parseMoneyFromDb(e.amount_db), {
                          compact: true,
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <FinanceStatusBadge
                            tone={STATUS_TONE[e.status]}
                            label={STATUS_LABEL[e.status]}
                          />
                          {(() => {
                            const hint = computeExpenseSlaHint(e);
                            return hint ? (
                              <Badge
                                variant="outline"
                                className={hint.tone}
                                aria-label={`Expense SLA — ${hint.label}`}
                              >
                                {hint.label}
                              </Badge>
                            ) : null;
                          })()}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`label-meta px-4 py-3 text-xs font-medium text-muted-foreground ${className ?? ""}`}
    >
      {children}
    </th>
  );
}
