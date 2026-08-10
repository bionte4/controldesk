"use server";

import { requireCurrentEmployee } from "@/lib/auth/session";
import { formatIDR, parseMoneyFromDb, type Money } from "@/lib/format/money";
import { budgetPendingForRole } from "@/lib/budgets/state";
import { toCanonicalRole, type AnyDbEmployeeRole } from "@/lib/rbac/roles";
import { PENDING_STATUSES as EXPENSE_PENDING_STATUSES } from "@/lib/expenses/state";
import { CA_PENDING_APPROVAL_STATUSES } from "@/lib/cash-advance/state";
import { CANONICAL_CA_PENDING_STATUSES } from "@/lib/cash-advance/state-canonical";
import { HR_PENDING_STATUSES } from "@/lib/hris/state";
import { businessMinutesBetween } from "@/lib/issues/sla";
import { createClient } from "@/lib/supabase/server";
import {
  buildPortfolioSnapshot,
  type PortfolioSnapshot as CorePortfolioSnapshot,
  type PortfolioTile,
  type ProjectRow,
  type BudgetRow,
  type BudgetDetailRow,
  type MilestoneRow,
} from "@/lib/portfolio/snapshot";
import {
  isApproverRole,
  resolveDashboardScope,
  type DashboardScope,
} from "@/lib/dashboard/scope";
import type { MilestoneStatus } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.generated";

export type Trend = "up" | "down" | "flat";

export type KpiPoint = { label: string; value: number };

export type Kpi = {
  id: string;
  label: string;
  value: number;
  formatted: string;
  delta: number; // percent
  trend: Trend;
  sparkline: KpiPoint[];
};

export type DashboardMetrics = {
  kpis: Kpi[];
  updatedAt: string;
  scope: DashboardScope["kind"];
};

export type PortfolioSnapshot = CorePortfolioSnapshot & {
  tenantId: string;
  scope: DashboardScope["kind"];
};

export type { PortfolioTile };

type DbClient = SupabaseClient<Database>;

function flatSparkline(): KpiPoint[] {
  return Array.from({ length: 12 }, (_, i) => ({ label: `W${i + 1}`, value: 0 }));
}

/**
 * Empty payload returned when the caller has a scoped dashboard
 * but zero assigned/portfolio projects. Guards against the
 * `supabase-js` gotcha where `.in("col", [])` behaves as an
 * unfiltered query and would silently leak tenant-wide rows.
 */
function emptyMetrics(scope: DashboardScope["kind"]): DashboardMetrics {
  const zeroKpi = (id: string, label: string, formatted = "0"): Kpi => ({
    id,
    label,
    value: 0,
    formatted,
    delta: 0,
    trend: "flat",
    sparkline: flatSparkline(),
  });
  return {
    updatedAt: new Date().toISOString(),
    scope,
    kpis: [
      zeroKpi("active_projects", "dashboard.kpis.activeProjects"),
      zeroKpi("approved_budget", "dashboard.kpis.approvedBudget", formatIDR(0n as Money, { compact: true })),
      zeroKpi("milestone_done_pct", "dashboard.kpis.milestoneDone", "0.0%"),
      zeroKpi("pending_approvals", "dashboard.kpis.pendingApprovals"),
      zeroKpi("issues_at_risk", "dashboard.kpis.issuesAtRisk"),
    ],
  };
}

/**
 * Resolve budget IDs that belong to projects the caller can see.
 * `budget_requests` is scoped via `budget_id`, not `project_id`,
 * so we prefetch the mapping.
 */
async function loadScopedBudgetIds(
  supabase: DbClient,
  projectIds: string[],
): Promise<string[]> {
  if (projectIds.length === 0) return [];
  const { data } = await supabase
    .from("budgets")
    .select("id")
    .in("project_id", projectIds);
  return (data ?? []).map((r) => r.id as string);
}

/**
 * Build the portfolio snapshot restricted to the caller's scope.
 * Uses the same `buildPortfolioSnapshot` core aggregator so the
 * downstream tile shape is untouched — only the input rows change.
 */
export async function getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  const employee = await requireCurrentEmployee();
  const scope = await resolveDashboardScope({
    id: employee.id,
    role: employee.role as AnyDbEmployeeRole,
  });
  const supabase = await createClient();

  if (scope.kind !== "org" && scope.empty) {
    const core = buildPortfolioSnapshot({
      projects: [],
      budgets: [],
      budgetDetails: [],
      milestones: [],
    });
    return { ...core, tenantId: employee.tenant_id, scope: scope.kind };
  }

  let projectsQ = supabase
    .from("projects")
    .select("id, code, name, status, project_type, progress, clients(name)")
    .in("status", ["PLANNING", "ACTIVE", "ON_HOLD"])
    .order("name", { ascending: true })
    .limit(12);
  if (scope.kind !== "org") {
    projectsQ = projectsQ.in("id", scope.projectIds);
  }

  let budgetsQ = supabase
    .from("budgets")
    .select(
      "id, project_id, title, fiscal_year, status, total_planned_amount, created_at",
    )
    .order("fiscal_year", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (scope.kind !== "org") {
    budgetsQ = budgetsQ.in("project_id", scope.projectIds);
  }

  let milestonesQ = supabase
    .from("project_milestones")
    .select("project_id, status, weight_bps")
    .limit(2000);
  if (scope.kind !== "org") {
    milestonesQ = milestonesQ.in("project_id", scope.projectIds);
  }

  const [projectsRes, budgetsRes, milestonesRes] = await Promise.all([
    projectsQ,
    budgetsQ,
    milestonesQ,
  ]);

  const projects = (projectsRes.data ?? []) as unknown as ProjectRow[];
  const budgets = (budgetsRes.data ?? []) as unknown as BudgetRow[];
  const milestones = (milestonesRes.data ?? []) as unknown as MilestoneRow[];

  // `budget_details` are scoped through their parent budget IDs to
  // avoid a JOIN — smaller round-trip, and RLS still applies.
  const budgetIds = budgets.map((b) => b.id).filter(Boolean);
  const budgetDetailsRes =
    budgetIds.length > 0
      ? await supabase
          .from("budget_details")
          .select(
            "budget_id, planned_amount, realized_amount, outstanding_amount",
          )
          .in("budget_id", budgetIds)
          .limit(2000)
      : { data: [] as unknown[] };
  const budgetDetails = (budgetDetailsRes.data ?? []) as unknown as BudgetDetailRow[];

  const core = buildPortfolioSnapshot({
    projects,
    budgets,
    budgetDetails,
    milestones,
  });

  return { ...core, tenantId: employee.tenant_id, scope: scope.kind };
}

/**
 * Live KPI aggregator (rules §3 ABAC + rules §12 partial).
 *
 * Scoping rules (canonical values via `resolveDashboardScope`):
 *   - `org`       → tenant-wide aggregates (no project filter).
 *   - `portfolio` → filter by projects handled by any employee
 *                   reporting (transitively) to the caller.
 *   - `assigned`  → filter by the caller's own PM/member
 *                   assignments. For non-approver roles
 *                   (`EMPLOYEE`, `PETTY_CASH_CUSTODIAN`) the
 *                   pending-approvals KPI switches to counting
 *                   *own submissions* only, so a field technician
 *                   never sees somebody else's expense queue.
 */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const employee = await requireCurrentEmployee();
  const dbRole = employee.role as AnyDbEmployeeRole;
  const canonicalRole = toCanonicalRole(dbRole);
  const scope = await resolveDashboardScope({
    id: employee.id,
    role: dbRole,
  });
  const supabase = await createClient();

  if (scope.kind !== "org" && scope.empty) {
    return emptyMetrics(scope.kind);
  }

  const isScoped = scope.kind !== "org";
  const projectIds = isScoped ? scope.projectIds : [];
  const budgetIds = isScoped
    ? await loadScopedBudgetIds(supabase, projectIds)
    : [];
  const treatAsApprover = isApproverRole(dbRole);
  const budgetInboxStatuses = budgetPendingForRole(canonicalRole);

  // -------------------------------------------------------------
  // Portfolio-level aggregates (always project-scoped).
  // -------------------------------------------------------------
  const activeProjectsQ = (() => {
    let q = supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .in("status", ["PLANNING", "ACTIVE"]);
    if (isScoped) q = q.in("id", projectIds);
    return q;
  })();

  const approvedBudgetQ = (() => {
    let q = supabase
      .from("budgets")
      .select("total_planned_amount")
      .eq("status", "APPROVED")
      .limit(500);
    if (isScoped) q = q.in("project_id", projectIds);
    return q;
  })();

  const milestonesQ = (() => {
    let q = supabase
      .from("project_milestones")
      .select("status, weight_bps")
      .limit(2000);
    if (isScoped) q = q.in("project_id", projectIds);
    return q;
  })();

  const activeIssuesQ = (() => {
    let q = supabase
      .from("project_issues")
      .select("sla_due_at, status")
      .in("status", ["OPEN", "IN_PROGRESS", "REOPENED"]);
    if (isScoped) q = q.in("project_id", projectIds);
    return q;
  })();

  // -------------------------------------------------------------
  // Pending-approval queues. Two branches:
  //
  //   (1) Approver roles: count all pending items *within scope*
  //       so a PM sees their project queue, an OM sees the
  //       portfolio queue, and an org role sees everything.
  //   (2) Non-approver roles (EMPLOYEE, PCC): count only the
  //       submissions this specific user filed and that are
  //       still awaiting a decision. This is the
  //       "own_submissions" policy chosen during the audit
  //       review — a field technician's Pending KPI reflects
  //       *their* backlog, never someone else's.
  // -------------------------------------------------------------
  const buildPendingQueries = () => {
    if (!treatAsApprover) {
      return {
        expensePending: supabase
          .from("project_expenses")
          .select("id", { count: "exact", head: true })
          .in("status", EXPENSE_PENDING_STATUSES)
          .eq("submitter_employee_id", employee.id),
        caPending: supabase
          .from("cash_advances")
          .select("id", { count: "exact", head: true })
          .in("status", [
            ...CA_PENDING_APPROVAL_STATUSES,
            ...CANONICAL_CA_PENDING_STATUSES,
          ])
          .eq("requester_employee_id", employee.id),
        hrPending: supabase
          .from("hr_requests")
          .select("id", { count: "exact", head: true })
          .in("status", HR_PENDING_STATUSES)
          .eq("requester_employee_id", employee.id),
        budgetPending: Promise.resolve({ count: 0 } as const),
        brPending: supabase
          .from("budget_requests")
          .select("id", { count: "exact", head: true })
          .in("status", ["PENDING_PM", "PENDING_FINANCE", "PENDING_DIRECTOR"])
          .eq("requester_employee_id", employee.id),
        twPending: supabase
          .from("timesheet_weeks")
          .select("id", { count: "exact", head: true })
          .eq("status", "SUBMITTED")
          .eq("employee_id", employee.id),
      };
    }

    // Approver branch — same tenant-wide queries as before, but
    // additionally scoped to the caller's assigned/portfolio
    // project set when applicable. `hr_requests` and
    // `timesheet_weeks` have no `project_id`, so we scope by
    // project via `project_id` (nullable on hr_requests) when
    // available and fall back to unscoped counts for org roles.
    let expensePending = supabase
      .from("project_expenses")
      .select("id", { count: "exact", head: true })
      .in("status", EXPENSE_PENDING_STATUSES);
    if (isScoped) expensePending = expensePending.in("project_id", projectIds);

    let caPending = supabase
      .from("cash_advances")
      .select("id", { count: "exact", head: true })
      .in("status", [
        ...CA_PENDING_APPROVAL_STATUSES,
        ...CANONICAL_CA_PENDING_STATUSES,
      ]);
    if (isScoped) caPending = caPending.in("project_id", projectIds);

    // `hr_requests.project_id` is nullable — for a PM/OM, we
    // still count only the requests attached to their projects;
    // leave-only requests without a project stay with HR/Finance.
    let hrPending = supabase
      .from("hr_requests")
      .select("id", { count: "exact", head: true })
      .in("status", HR_PENDING_STATUSES);
    if (isScoped) hrPending = hrPending.in("project_id", projectIds);

    let budgetPending: PromiseLike<{ count: number | null }> = Promise.resolve({
      count: 0,
    });
    if (budgetInboxStatuses.length > 0) {
      let q = supabase
        .from("budgets")
        .select("id", { count: "exact", head: true })
        .in("status", budgetInboxStatuses);
      if (isScoped) q = q.in("project_id", projectIds);
      budgetPending = q;
    }

    let brPending: PromiseLike<{ count: number | null }> = Promise.resolve({
      count: 0,
    });
    if (!isScoped) {
      brPending = supabase
        .from("budget_requests")
        .select("id", { count: "exact", head: true })
        .in("status", ["PENDING_PM", "PENDING_FINANCE", "PENDING_DIRECTOR"]);
    } else if (budgetIds.length > 0) {
      brPending = supabase
        .from("budget_requests")
        .select("id", { count: "exact", head: true })
        .in("status", ["PENDING_PM", "PENDING_FINANCE", "PENDING_DIRECTOR"])
        .in("budget_id", budgetIds);
    }

    // Timesheets don't carry a project_id — for approver roles in
    // a scoped view we count timesheets *for employees on the
    // caller's projects*. Cheaper path: skip for scoped views
    // (SPV/PM/OM see personalised approval inbox elsewhere).
    let twPending: PromiseLike<{ count: number | null }> = Promise.resolve({
      count: 0,
    });
    if (!isScoped) {
      twPending = supabase
        .from("timesheet_weeks")
        .select("id", { count: "exact", head: true })
        .eq("status", "SUBMITTED");
    }

    return {
      expensePending,
      caPending,
      hrPending,
      budgetPending,
      brPending,
      twPending,
    };
  };

  const pending = buildPendingQueries();

  const [
    activeRes,
    approvedBudgetRes,
    milestonesRes,
    expensePendingRes,
    caPendingRes,
    hrPendingRes,
    budgetPendingRes,
    activeIssuesRes,
    brPendingRes,
    twPendingRes,
  ] = await Promise.all([
    activeProjectsQ,
    approvedBudgetQ,
    milestonesQ,
    pending.expensePending,
    pending.caPending,
    pending.hrPending,
    pending.budgetPending,
    activeIssuesQ,
    pending.brPending,
    pending.twPending,
  ]);

  const activeProjects = activeRes.count ?? 0;

  const approvedBudgets = (approvedBudgetRes.data ?? []) as unknown as {
    total_planned_amount: string;
  }[];
  const totalApprovedPlanned = approvedBudgets.reduce(
    (acc, row) => acc + parseMoneyFromDb(row.total_planned_amount),
    0n as Money,
  );

  const milestones = (milestonesRes.data ?? []) as unknown as {
    status: MilestoneStatus;
    weight_bps: number;
  }[];
  const totalWeightBps = milestones.reduce((acc, m) => acc + m.weight_bps, 0);
  const doneWeightBps = milestones
    .filter((m) => m.status === "DONE")
    .reduce((acc, m) => acc + m.weight_bps, 0);
  const donePct =
    totalWeightBps > 0 ? (doneWeightBps / totalWeightBps) * 100 : 0;

  const pendingCount =
    (expensePendingRes.count ?? 0) +
    (caPendingRes.count ?? 0) +
    (hrPendingRes.count ?? 0) +
    (budgetPendingRes.count ?? 0) +
    (brPendingRes.count ?? 0) +
    (twPendingRes.count ?? 0);

  const activeIssues = (activeIssuesRes.data ?? []) as unknown as {
    sla_due_at: string;
  }[];
  const now = new Date();
  let issuesBreachedCount = 0;
  let issuesAtRiskCount = 0;
  for (const issue of activeIssues) {
    const remainingMinutes = businessMinutesBetween(
      now,
      new Date(issue.sla_due_at),
    );
    if (remainingMinutes < 0) issuesBreachedCount += 1;
    else if (remainingMinutes <= 60) issuesAtRiskCount += 1;
  }
  const issuesAttentionCount = issuesBreachedCount + issuesAtRiskCount;

  return {
    updatedAt: new Date().toISOString(),
    scope: scope.kind,
    kpis: [
      {
        id: "active_projects",
        label: "dashboard.kpis.activeProjects",
        value: activeProjects,
        formatted: String(activeProjects),
        delta: 0,
        trend: "flat",
        sparkline: flatSparkline(),
      },
      {
        id: "approved_budget",
        label: "dashboard.kpis.approvedBudget",
        value: Number(totalApprovedPlanned),
        formatted: formatIDR(totalApprovedPlanned, { compact: true }),
        delta: 0,
        trend: "flat",
        sparkline: flatSparkline(),
      },
      {
        id: "milestone_done_pct",
        label: "dashboard.kpis.milestoneDone",
        value: donePct,
        formatted: `${donePct.toFixed(1)}%`,
        delta: 0,
        trend: donePct > 0 ? "up" : "flat",
        sparkline: flatSparkline(),
      },
      {
        id: "pending_approvals",
        label: "dashboard.kpis.pendingApprovals",
        value: pendingCount,
        formatted: String(pendingCount),
        delta: 0,
        trend: pendingCount > 0 ? "up" : "flat",
        sparkline: flatSparkline(),
      },
      {
        id: "issues_at_risk",
        label: "dashboard.kpis.issuesAtRisk",
        value: issuesAttentionCount,
        formatted:
          issuesBreachedCount > 0
            ? `${issuesBreachedCount}!${
                issuesAtRiskCount > 0 ? ` · ${issuesAtRiskCount}` : ""
              }`
            : String(issuesAttentionCount),
        delta: 0,
        trend: issuesBreachedCount > 0 ? "up" : "flat",
        sparkline: flatSparkline(),
      },
    ],
  };
}
