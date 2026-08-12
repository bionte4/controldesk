import type { Metadata } from "next";
import Link from "next/link";
import {
  BadgeDollarSign,
  CalendarDays,
  Coins,
  FileClock,
  Inbox,
  Paperclip,
  PiggyBank,
  Receipt,
  Wallet,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatInTz } from "@/lib/format/date";
import { formatIDR, parseMoneyFromDb } from "@/lib/format/money";
import {
  formatRole,
  toCanonicalRole,
  type AnyDbEmployeeRole,
} from "@/lib/rbac/roles";
import { requireCurrentEmployee } from "@/lib/auth/session";
import {
  isApproverRole,
  resolveEmployeeScope,
  resolveProjectScope,
} from "@/lib/security/project-scope";
import { createClient } from "@/lib/supabase/server";
import {
  PENDING_STATUSES,
  STATUS_APPROVER_ROLE,
  STATUS_LABEL,
  STATUS_TONE,
} from "@/lib/expenses/state";
import {
  CA_STATUS_LABEL,
  CA_STATUS_TONE,
} from "@/lib/cash-advance/state";
import {
  CANONICAL_CA_STATUS_LABEL,
  CANONICAL_CA_STATUS_TONE,
} from "@/lib/cash-advance/state-canonical";
import { mergedCaPendingForRole } from "@/lib/cash-advance/inbox";
import {
  HR_PENDING_STATUSES,
  HR_STATUS_APPROVER_ROLE,
  HR_STATUS_LABEL,
  HR_STATUS_TONE,
} from "@/lib/hris/state";
import {
  BUDGET_STATUS_LABEL,
  BUDGET_STATUS_TONE,
  budgetPendingForRole,
} from "@/lib/budgets/state";
import {
  BR_STATUS_SLOT,
  brApprovalChain,
  brCanApprove,
  brPendingForRole,
} from "@/lib/budget-requests/state";
import {
  TW_STATUS_TONE,
  canApproveWeek,
  weekEndFromStart,
} from "@/lib/timesheets/week-state";
import type {
  BudgetRequestKind,
  BudgetRequestStatus,
  BudgetStatus,
  CashAdvanceStatus,
  ExpenseStatus,
  HrRequestKind,
  HrRequestStatus,
  PettyCashReplenishmentStatus,
  TimesheetStatus,
} from "@/types/database";
import type { EmployeeRole } from "@/lib/rbac/roles";

import { ApprovalChainProgress } from "@/components/approvals/approval-chain-progress";

import { BudgetRequestActionButtons } from "../finance/budget-requests/budget-request-actions";

import { ApprovalsRealtime } from "./approvals-realtime";

export const metadata: Metadata = { title: "Approvals" };

function expensePendingForRole(role: EmployeeRole): ExpenseStatus[] {
  if (role === "TENANT_ADMIN") return [...PENDING_STATUSES];
  return PENDING_STATUSES.filter((s) => STATUS_APPROVER_ROLE[s] === role);
}

/**
 * Unified label lookup — canonical labels win where they exist.
 */
function caStatusLabel(status: CashAdvanceStatus): string {
  const canonical =
    (CANONICAL_CA_STATUS_LABEL as Partial<Record<CashAdvanceStatus, string>>)[
      status
    ];
  return canonical ?? CA_STATUS_LABEL[status];
}

function caStatusTone(status: CashAdvanceStatus): string {
  const canonical =
    (CANONICAL_CA_STATUS_TONE as Partial<Record<CashAdvanceStatus, string>>)[
      status
    ];
  return canonical ?? CA_STATUS_TONE[status];
}

function hrPendingForRole(role: EmployeeRole): HrRequestStatus[] {
  if (role === "TENANT_ADMIN") return [...HR_PENDING_STATUSES];
  return HR_PENDING_STATUSES.filter((s) => HR_STATUS_APPROVER_ROLE[s] === role);
}

const PETTY_CASH_APPROVER_ROLES: readonly EmployeeRole[] = [
  "LEAD_FINANCE",
  "TENANT_ADMIN",
];

type ExpenseItem = {
  id: string;
  amount: string;
  description: string;
  status: ExpenseStatus;
  incurred_on: string;
  created_at: string;
  projects: { id: string; code: string; name: string } | null;
  submitter: { full_name: string; role: EmployeeRole } | null;
};

type CashAdvanceItem = {
  id: string;
  amount: string;
  purpose: string;
  status: CashAdvanceStatus;
  needed_by: string | null;
  created_at: string;
  projects: { id: string; code: string; name: string } | null;
  requester: { full_name: string; role: EmployeeRole } | null;
};

type HrItem = {
  id: string;
  kind: HrRequestKind;
  status: HrRequestStatus;
  reason: string;
  start_at: string;
  end_at: string;
  created_at: string;
  requester: { full_name: string; role: EmployeeRole } | null;
};

type ReplenishmentItem = {
  id: string;
  requested_amount: string;
  status: PettyCashReplenishmentStatus;
  created_at: string;
  fund: { id: string; location_name: string } | null;
  requester: { full_name: string; role: EmployeeRole } | null;
};

type BudgetItem = {
  id: string;
  title: string;
  fiscal_year: number;
  status: BudgetStatus;
  total_planned_amount: string;
  created_at: string;
  projects: { id: string; code: string; name: string } | null;
  creator: { full_name: string; role: EmployeeRole } | null;
};

type BudgetRequestItem = {
  id: string;
  budget_id: string;
  kind: BudgetRequestKind;
  amount: string;
  status: BudgetRequestStatus;
  justification: string;
  requester_employee_id: string;
  created_at: string;
  requester: { full_name: string; role: EmployeeRole } | null;
  budget: {
    id: string;
    title: string;
    fiscal_year: number;
    projects: { id: string; code: string; name: string } | null;
  } | null;
};

const BR_STATUS_TONE: Record<BudgetRequestStatus, string> = {
  DRAFT: "border-slate-400/40 text-slate-400",
  PENDING_PM: "border-indigo-400/40 text-indigo-400",
  PENDING_FINANCE: "border-amber-400/40 text-amber-400",
  PENDING_DIRECTOR: "border-purple-400/40 text-purple-400",
  APPROVED: "border-emerald-400/40 text-emerald-400",
  APPLIED: "border-emerald-600/40 text-emerald-600",
  REJECTED: "border-rose-400/40 text-rose-400",
  CANCELLED: "border-slate-500/40 text-slate-500",
};

const BR_KIND_TONE: Record<BudgetRequestKind, string> = {
  INCREASE: "border-emerald-400/40 text-emerald-400",
  DECREASE: "border-rose-400/40 text-rose-400",
  TRANSFER: "border-indigo-400/40 text-indigo-400",
};

type WeeklyTimesheetItem = {
  id: string;
  employee_id: string;
  week_start_date: string;
  status: TimesheetStatus;
  total_hours: string;
  total_overtime: string;
  created_at: string;
  employee: { full_name: string; role: EmployeeRole } | null;
};

export default async function ApprovalsPage() {
  const [employee, t] = await Promise.all([
    requireCurrentEmployee(),
    getTranslations("approvals"),
  ]);

  const legacyRole = employee.role as EmployeeRole;
  const dbRole = employee.role as AnyDbEmployeeRole;
  // Rules §6 — `toCanonicalRole` folds `PETTY_CASH_CUSTODIAN` into
  // canonical `FINANCE`. Left uncontrolled, that fold gives PCC a
  // seat in every finance-tier approval queue (expenses in
  // PENDING_L2_5_FINANCE, cash advances in PENDING_FINANCE, budget
  // + budget-request finance slots). PCC is expressly not a
  // financial approver — they only reconcile petty-cash
  // replenishments, gated below via `PETTY_CASH_APPROVER_ROLES`.
  //
  // The `isApproverRole` gate is our authoritative "does this
  // role sit in ANY approval chain outside their own submissions?"
  // predicate. Applying it here folds the PCC leak closed in a
  // single spot instead of chasing every downstream role helper.
  const isApprover = isApproverRole(dbRole);
  const expenseStatuses = isApprover ? expensePendingForRole(legacyRole) : [];
  const caStatuses = isApprover ? mergedCaPendingForRole(dbRole) : [];
  const hrStatuses = isApprover ? hrPendingForRole(legacyRole) : [];
  const canReviewReplenishment = (
    PETTY_CASH_APPROVER_ROLES as readonly string[]
  ).includes(employee.role);
  const canonicalRole = toCanonicalRole(dbRole);
  const budgetStatuses = isApprover ? budgetPendingForRole(canonicalRole) : [];
  const brStatuses = isApprover ? brPendingForRole(canonicalRole) : [];
  const canReviewWeeklyTimesheets =
    isApprover && canApproveWeek(legacyRole, "SUBMITTED");

  const supabase = await createClient();

  // Rules §3 — even for approvers we intersect each queue with
  // the actor's project/employee scope. A PM getting L2 items for
  // *every* project in the tenant is a portfolio leak; they should
  // only see items on projects they lead. Org roles
  // (Finance/Director/HR-Admin/GM/Admin) skip the intersection.
  const caller = {
    id: employee.id,
    role: employee.role as AnyDbEmployeeRole,
  };
  const [projScope, empScope] = await Promise.all([
    resolveProjectScope(caller),
    resolveEmployeeScope(caller),
  ]);
  // A scoped caller with zero visible projects/employees must
  // never fall through to a tenant-wide fetch — pin to an
  // impossible UUID so `.in()` returns 0 rows deterministically.
  const IMPOSSIBLE_UUID = "00000000-0000-0000-0000-000000000000";
  const projectFilterIds =
    projScope.kind === "org"
      ? null
      : projScope.empty
        ? [IMPOSSIBLE_UUID]
        : projScope.projectIds;
  const employeeFilterIds =
    empScope.kind === "org"
      ? null
      : empScope.ids.length === 0
        ? [IMPOSSIBLE_UUID]
        : empScope.ids;

  const [expenseRes, caRes, hrRes, pcRes, budgetRes, brRes, twRes] = await Promise.all([
    expenseStatuses.length
      ? (() => {
          let q = supabase
            .from("project_expenses")
            .select(
              "id, amount, description, status, incurred_on, created_at, projects(id, code, name), submitter:submitter_employee_id(full_name, role)",
            )
            .in("status", expenseStatuses)
            .order("created_at", { ascending: true })
            .limit(100);
          if (projectFilterIds) q = q.in("project_id", projectFilterIds);
          return q;
        })()
      : { data: [] as unknown[] },
    caStatuses.length
      ? (() => {
          let q = supabase
            .from("cash_advances")
            .select(
              "id, amount, purpose, status, needed_by, created_at, projects(id, code, name), requester:requester_employee_id(full_name, role)",
            )
            .in("status", [...caStatuses])
            .order("created_at", { ascending: true })
            .limit(100);
          if (projectFilterIds) q = q.in("project_id", projectFilterIds);
          return q;
        })()
      : { data: [] as unknown[] },
    hrStatuses.length
      ? (() => {
          let q = supabase
            .from("hr_requests")
            .select(
              "id, kind, status, reason, start_at, end_at, created_at, requester:requester_employee_id(full_name, role)",
            )
            .in("status", hrStatuses)
            .order("created_at", { ascending: true })
            .limit(100);
          if (employeeFilterIds)
            q = q.in("requester_employee_id", employeeFilterIds);
          return q;
        })()
      : { data: [] as unknown[] },
    canReviewReplenishment
      ? supabase
          .from("petty_cash_replenishments")
          .select(
            "id, requested_amount, status, created_at, fund:fund_id(id, location_name), requester:requested_by(full_name, role)",
          )
          .in("status", ["PENDING_FINANCE", "APPROVED"])
          .order("created_at", { ascending: true })
          .limit(100)
      : { data: [] as unknown[] },
    budgetStatuses.length
      ? (() => {
          let q = supabase
            .from("budgets")
            .select(
              "id, title, fiscal_year, status, total_planned_amount, created_at, projects(id, code, name), creator:employees!budgets_created_by_fkey(full_name, role)",
            )
            .in("status", budgetStatuses)
            .order("created_at", { ascending: true })
            .limit(100);
          if (projectFilterIds) q = q.in("project_id", projectFilterIds);
          return q;
        })()
      : { data: [] as unknown[] },
    brStatuses.length
      ? (() => {
          let q = supabase
            .from("budget_requests")
            .select(
              "id, budget_id, kind, amount, status, justification, requester_employee_id, created_at, requester:employees!budget_requests_requester_employee_id_fkey(full_name, role), budget:budgets!budget_requests_budget_id_fkey(id, title, fiscal_year, projects(id, code, name))",
            )
            .in("status", brStatuses)
            .order("created_at", { ascending: true })
            .limit(100);
          // Budget requests point at a budget which points at a
          // project — the RPC-style FK filter `budget.project_id`
          // isn't supported by PostgREST's `.in()` shorthand, so
          // we instead intersect on requester employee scope as
          // the closest available proxy. PM sees BRs from their
          // team; org roles see everything.
          if (employeeFilterIds)
            q = q.in("requester_employee_id", employeeFilterIds);
          return q;
        })()
      : { data: [] as unknown[] },
    canReviewWeeklyTimesheets
      ? (() => {
          let q = supabase
            .from("timesheet_weeks")
            .select(
              "id, employee_id, week_start_date, status, total_hours, total_overtime, created_at, employee:employees!timesheet_weeks_employee_id_fkey(full_name, role)",
            )
            .eq("status", "SUBMITTED")
            .order("week_start_date", { ascending: false })
            .limit(100);
          if (employeeFilterIds) q = q.in("employee_id", employeeFilterIds);
          return q;
        })()
      : { data: [] as unknown[] },
  ]);

  const expenseItems = ((expenseRes.data ?? []) as unknown as ExpenseItem[]);
  const caItems = ((caRes.data ?? []) as unknown as CashAdvanceItem[]);
  const hrItems = ((hrRes.data ?? []) as unknown as HrItem[]);
  const pcItems = ((pcRes.data ?? []) as unknown as ReplenishmentItem[]);
  const budgetItems = ((budgetRes.data ?? []) as unknown as BudgetItem[]);
  const brItems = ((brRes.data ?? []) as unknown as BudgetRequestItem[]);
  const twItems = ((twRes.data ?? []) as unknown as WeeklyTimesheetItem[]);

  // ------------------------------------------------------------------
  // Batch attachment counts — surfaces "N nota" chips inline so
  // approvers can triage without opening each item. RLS on
  // `attachments` scopes rows to the current tenant already; the
  // resource_id filter narrows to only the shown items.
  // ------------------------------------------------------------------
  const expenseIds = expenseItems.map((i) => i.id);
  const caIds = caItems.map((i) => i.id);
  const pcIds = pcItems.map((i) => i.id);

  const [expenseAttRes, caAttRes, pcAttRes] = await Promise.all([
    expenseIds.length > 0
      ? supabase
          .from("attachments")
          .select("resource_id")
          .eq("resource_type", "project_expense")
          .in("resource_id", expenseIds)
      : { data: [] as { resource_id: string }[] },
    caIds.length > 0
      ? supabase
          .from("attachments")
          .select("resource_id")
          .eq("resource_type", "cash_advance")
          .in("resource_id", caIds)
      : { data: [] as { resource_id: string }[] },
    pcIds.length > 0
      ? supabase
          .from("attachments")
          .select("resource_id")
          .eq("resource_type", "petty_cash_replenishment")
          .in("resource_id", pcIds)
      : { data: [] as { resource_id: string }[] },
  ]);

  function tallyBy(
    rows: { resource_id: string }[] | null | undefined,
  ): Map<string, number> {
    const m = new Map<string, number>();
    (rows ?? []).forEach((r) => {
      m.set(r.resource_id, (m.get(r.resource_id) ?? 0) + 1);
    });
    return m;
  }
  const expenseAttachCount = tallyBy(
    expenseAttRes.data as { resource_id: string }[] | null,
  );
  const caAttachCount = tallyBy(
    caAttRes.data as { resource_id: string }[] | null,
  );
  const pcAttachCount = tallyBy(
    pcAttRes.data as { resource_id: string }[] | null,
  );

  const hasAnyRole =
    expenseStatuses.length > 0 ||
    caStatuses.length > 0 ||
    hrStatuses.length > 0 ||
    canReviewReplenishment ||
    budgetStatuses.length > 0 ||
    brStatuses.length > 0 ||
    canReviewWeeklyTimesheets;

  const totalItems =
    expenseItems.length +
    caItems.length +
    hrItems.length +
    pcItems.length +
    budgetItems.length +
    brItems.length +
    twItems.length;

  return (
    <div className="flex flex-col gap-6">
      <ApprovalsRealtime tenantId={employee.tenant_id} />
      <header>
        <p className="label-meta">{t("kicker")}</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {t("title", { role: formatRole(employee.role) })}
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          {t("subtitle")}
        </p>
      </header>

      {!hasAnyRole ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title={t("noRoleTitle")}
          body={t("noRoleBody")}
        />
      ) : totalItems === 0 ? (
        <EmptyState
          icon={<Inbox className="size-6" />}
          title={t("empty")}
          body={t("emptyBody")}
        />
      ) : (
        <div className="flex flex-col gap-8">
          {expenseItems.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader
                icon={<Receipt className="size-4" />}
                label={t("sections.expenses")}
                count={expenseItems.length}
              />
              <div className="grid gap-3">
                {expenseItems.map((item) => (
                  <Link
                    key={item.id}
                    href={`/finance/expenses/${item.id}`}
                    className="glass rounded-2xl border border-white/10 p-4 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {item.projects?.code ?? "—"}
                          </span>
                          <Badge
                            variant="outline"
                            className={STATUS_TONE[item.status]}
                          >
                            {STATUS_LABEL[item.status]}
                          </Badge>
                          <AttachmentBadge
                            count={expenseAttachCount.get(item.id) ?? 0}
                            label={t("attachmentsLabel", {
                              n: expenseAttachCount.get(item.id) ?? 0,
                            })}
                          />
                        </div>
                        <p className="mt-1 font-medium">{item.description}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.projects?.name ?? "—"} ·{" "}
                          {t("submittedBy", {
                            name: item.submitter?.full_name ?? "—",
                            role: item.submitter?.role
                              ? formatRole(item.submitter.role)
                              : "",
                          })}
                          {" · "}
                          {formatInTz(item.created_at, "dd MMM, HH:mm")}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="label-meta">{t("amount")}</p>
                        <p className="font-display text-xl font-semibold tabular-nums">
                          {formatIDR(parseMoneyFromDb(item.amount), {
                            compact: true,
                          })}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {caItems.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader
                icon={<Wallet className="size-4" />}
                label={t("sections.cashAdvances")}
                count={caItems.length}
              />
              <div className="grid gap-3">
                {caItems.map((item) => (
                  <Link
                    key={item.id}
                    href={`/finance/cash-advances/${item.id}`}
                    className="glass rounded-2xl border border-white/10 p-4 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {item.projects?.code ?? "—"}
                          </span>
                          <Badge
                            variant="outline"
                            className={caStatusTone(item.status)}
                          >
                            {caStatusLabel(item.status)}
                          </Badge>
                          <AttachmentBadge
                            count={caAttachCount.get(item.id) ?? 0}
                            label={t("attachmentsLabel", {
                              n: caAttachCount.get(item.id) ?? 0,
                            })}
                          />
                        </div>
                        <p className="mt-1 font-medium">{item.purpose}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.projects?.name ?? "—"} ·{" "}
                          {t("submittedBy", {
                            name: item.requester?.full_name ?? "—",
                            role: item.requester?.role
                              ? formatRole(item.requester.role)
                              : "",
                          })}
                          {" · "}
                          {formatInTz(item.created_at, "dd MMM, HH:mm")}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="label-meta">{t("amount")}</p>
                        <p className="font-display text-xl font-semibold tabular-nums">
                          {formatIDR(parseMoneyFromDb(item.amount), {
                            compact: true,
                          })}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {hrItems.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader
                icon={<FileClock className="size-4" />}
                label={t("sections.hrRequests")}
                count={hrItems.length}
              />
              <div className="grid gap-3">
                {hrItems.map((item) => (
                  <Link
                    key={item.id}
                    href={`/hr/requests/${item.id}`}
                    className="glass rounded-2xl border border-white/10 p-4 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {item.kind}
                          </span>
                          <Badge
                            variant="outline"
                            className={HR_STATUS_TONE[item.status]}
                          >
                            {HR_STATUS_LABEL[item.status]}
                          </Badge>
                        </div>
                        <p className="mt-1 font-medium line-clamp-1">
                          {item.reason}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatInTz(item.start_at, "dd MMM, HH:mm")}
                          {" → "}
                          {formatInTz(item.end_at, "dd MMM, HH:mm")}
                          {" · "}
                          {t("submittedBy", {
                            name: item.requester?.full_name ?? "—",
                            role: item.requester?.role
                              ? formatRole(item.requester.role)
                              : "",
                          })}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {budgetItems.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader
                icon={<BadgeDollarSign className="size-4" />}
                label={t("sections.budgets")}
                count={budgetItems.length}
              />
              <div className="grid gap-3">
                {budgetItems.map((item) => (
                  <Link
                    key={item.id}
                    href={`/finance/budgets/${item.id}`}
                    className="glass rounded-2xl border border-white/10 p-4 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {item.projects?.code ?? "—"} · FY{item.fiscal_year}
                          </span>
                          <Badge
                            variant="outline"
                            className={BUDGET_STATUS_TONE[item.status]}
                            title={BUDGET_STATUS_LABEL[item.status]}
                          >
                            {BUDGET_STATUS_LABEL[item.status]}
                          </Badge>
                        </div>
                        <p className="mt-1 font-medium">{item.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.projects?.name ?? "—"} ·{" "}
                          {t("submittedBy", {
                            name: item.creator?.full_name ?? "—",
                            role: item.creator?.role
                              ? formatRole(item.creator.role)
                              : "",
                          })}
                          {" · "}
                          {formatInTz(item.created_at, "dd MMM, HH:mm")}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="label-meta">{t("amount")}</p>
                        <p className="font-display text-xl font-semibold tabular-nums">
                          {formatIDR(
                            parseMoneyFromDb(item.total_planned_amount),
                            { compact: true },
                          )}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {brItems.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader
                icon={<PiggyBank className="size-4" />}
                label={t("sections.budgetRequests")}
                count={brItems.length}
              />
              <div className="grid gap-3">
                {brItems.map((item) => {
                  const amount = parseMoneyFromDb(item.amount);
                  const chain = brApprovalChain(Number(amount));
                  const activeSlot = BR_STATUS_SLOT[item.status];
                  const canApprove = brCanApprove({
                    actorRole: canonicalRole,
                    current: item.status,
                  });
                  const canApply =
                    item.status === "APPROVED" &&
                    (canonicalRole === "PM" ||
                      canonicalRole === "OM" ||
                      canonicalRole === "DIRECTOR" ||
                      canonicalRole === "FINANCE" ||
                      canonicalRole === "ADMIN");
                  const mode = canApprove
                    ? ("approve+reject" as const)
                    : canApply
                      ? ("apply" as const)
                      : ("none" as const);
                  const projectCode = item.budget?.projects?.code ?? "—";
                  const projectName = item.budget?.projects?.name ?? "—";
                  return (
                    <div
                      key={item.id}
                      className="glass rounded-2xl border border-white/10 p-4 hover:border-primary/40 transition-colors"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/finance/budgets/${item.budget_id}#br-${item.id}`}
                              className="font-mono text-xs text-muted-foreground hover:text-primary transition-colors"
                            >
                              {projectCode} · FY{item.budget?.fiscal_year ?? "—"}
                            </Link>
                            <Badge
                              variant="outline"
                              className={BR_KIND_TONE[item.kind]}
                            >
                              {item.kind}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={BR_STATUS_TONE[item.status]}
                            >
                              {item.status}
                            </Badge>
                          </div>
                          <Link
                            href={`/finance/budgets/${item.budget_id}#br-${item.id}`}
                            className="block"
                          >
                            <p className="mt-1 font-medium line-clamp-2">
                              {item.justification}
                            </p>
                          </Link>
                          <ApprovalChainProgress
                            slots={chain}
                            active={activeSlot}
                            className="mt-1.5"
                            ariaLabel={`Approval chain — ${item.status}`}
                          />
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            {projectName} ·{" "}
                            {t("submittedBy", {
                              name: item.requester?.full_name ?? "—",
                              role: item.requester?.role
                                ? formatRole(item.requester.role)
                                : "",
                            })}
                            {" · "}
                            {formatInTz(item.created_at, "dd MMM, HH:mm")}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <div className="text-right">
                            <p className="label-meta">{t("amount")}</p>
                            <p className="font-display text-xl font-semibold tabular-nums">
                              {formatIDR(amount, { compact: true })}
                            </p>
                          </div>
                          <BudgetRequestActionButtons
                            id={item.id}
                            mode={mode}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {twItems.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader
                icon={<CalendarDays className="size-4" />}
                label={t("sections.weeklyTimesheets")}
                count={twItems.length}
              />
              <div className="grid gap-3">
                {twItems.map((item) => {
                  const weekEnd = weekEndFromStart(item.week_start_date);
                  const hours = Number(item.total_hours);
                  const overtime = Number(item.total_overtime);
                  return (
                    <Link
                      key={item.id}
                      href={`/hr/timesheets/weekly/${item.week_start_date}?employee_id=${item.employee_id}`}
                      className="glass rounded-2xl border border-white/10 p-4 hover:border-primary/40 transition-colors"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">
                              {item.week_start_date} → {weekEnd}
                            </span>
                            <Badge
                              variant="outline"
                              className={TW_STATUS_TONE[item.status]}
                            >
                              {item.status}
                            </Badge>
                          </div>
                          <p className="mt-1 font-medium">
                            {item.employee?.full_name ?? "—"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("submittedBy", {
                              name: item.employee?.full_name ?? "—",
                              role: item.employee?.role
                                ? formatRole(item.employee.role)
                                : "",
                            })}
                            {" · "}
                            {formatInTz(item.created_at, "dd MMM, HH:mm")}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="label-meta">
                            {t("weeklyTotals")}
                          </p>
                          <p className="font-display text-xl font-semibold tabular-nums">
                            {hours.toFixed(1)}h
                          </p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            +{overtime.toFixed(1)}h OT
                          </p>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {pcItems.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeader
                icon={<Coins className="size-4" />}
                label={t("sections.pettyCash")}
                count={pcItems.length}
              />
              <div className="grid gap-3">
                {pcItems.map((item) => (
                  <Link
                    key={item.id}
                    href={
                      item.fund
                        ? `/finance/petty-cash/${item.fund.id}`
                        : "/finance/petty-cash"
                    }
                    className="glass rounded-2xl border border-white/10 p-4 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {item.fund?.location_name ?? "—"}
                          </span>
                          <Badge
                            variant="outline"
                            className="border-purple-400/30 bg-purple-500/10 text-purple-200"
                          >
                            {item.status}
                          </Badge>
                          <AttachmentBadge
                            count={pcAttachCount.get(item.id) ?? 0}
                            label={t("attachmentsLabel", {
                              n: pcAttachCount.get(item.id) ?? 0,
                            })}
                          />
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t("submittedBy", {
                            name: item.requester?.full_name ?? "—",
                            role: item.requester?.role
                              ? formatRole(item.requester.role)
                              : "",
                          })}
                          {" · "}
                          {formatInTz(item.created_at, "dd MMM, HH:mm")}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="label-meta">{t("amount")}</p>
                        <p className="font-display text-xl font-semibold tabular-nums">
                          {formatIDR(parseMoneyFromDb(item.requested_amount), {
                            compact: true,
                          })}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Card className="glass">
      <CardHeader className="items-center text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          {icon}
        </div>
        <CardTitle className="font-display text-xl">{title}</CardTitle>
        <CardDescription className="max-w-md text-center">
          {body}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function SectionHeader({
  icon,
  label,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{icon}</span>
      <h2 className="text-sm font-semibold uppercase tracking-wide">{label}</h2>
      <Badge variant="outline" className="border-white/10 bg-white/5">
        {count}
      </Badge>
    </div>
  );
}

/**
 * Compact chip showing how many supporting attachments the approver
 * will find when opening a row. Hidden when count is 0 so it doesn't
 * add noise for items without evidence.
 */
function AttachmentBadge({
  count,
  label,
}: {
  count: number;
  label: string;
}) {
  if (count <= 0) return null;
  return (
    <Badge
      variant="outline"
      className="border-white/10 bg-white/5 text-xs tabular-nums"
      title={label}
    >
      <Paperclip className="mr-1 size-3" aria-hidden />
      <span aria-label={label}>{count}</span>
    </Badge>
  );
}
