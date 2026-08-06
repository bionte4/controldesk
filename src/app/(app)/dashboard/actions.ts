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
import type { MilestoneStatus } from "@/types/database";

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
};

export type PortfolioSnapshot = CorePortfolioSnapshot & {
  tenantId: string;
};

export type { PortfolioTile };

function flatSparkline(): KpiPoint[] {
  return Array.from({ length: 12 }, (_, i) => ({ label: `W${i + 1}`, value: 0 }));
}

/**
 * Build the per-tenant portfolio snapshot. RSC-safe — the RLS layer
 * automatically constrains rows to the caller's tenant.
 */
export async function getPortfolioSnapshot(): Promise<PortfolioSnapshot> {
  const employee = await requireCurrentEmployee();
  const supabase = await createClient();

  const [projectsRes, budgetsRes, budgetDetailsRes, milestonesRes] =
    await Promise.all([
      supabase
        .from("projects")
        .select(
          "id, code, name, status, project_type, progress, clients(name)",
        )
        .in("status", ["PLANNING", "ACTIVE", "ON_HOLD"])
        .order("name", { ascending: true })
        .limit(12),
      supabase
        .from("budgets")
        .select(
          "id, project_id, title, fiscal_year, status, total_planned_amount, created_at",
        )
        .order("fiscal_year", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("budget_details")
        .select(
          "budget_id, planned_amount, realized_amount, outstanding_amount",
        )
        .limit(2000),
      supabase
        .from("project_milestones")
        .select("project_id, status, weight_bps")
        .limit(2000),
    ]);

  const projects = (projectsRes.data ?? []) as unknown as ProjectRow[];
  const budgets = (budgetsRes.data ?? []) as unknown as BudgetRow[];
  const budgetDetails = (budgetDetailsRes.data ?? []) as unknown as BudgetDetailRow[];
  const milestones = (milestonesRes.data ?? []) as unknown as MilestoneRow[];

  const core = buildPortfolioSnapshot({
    projects,
    budgets,
    budgetDetails,
    milestones,
  });

  return { ...core, tenantId: employee.tenant_id };
}

/**
 * Live KPI aggregator (rules §12 partial — full BPO revenue / gross-margin
 * numbers still land in a later slice). Currently derives numbers from:
 *   - `projects` (active count)
 *   - `budgets` (approved planned sum)
 *   - `project_milestones` (done-weight ratio)
 *   - Aggregated pending queues across expense / CA / HR / budget.
 */
export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const employee = await requireCurrentEmployee();
  const canonicalRole = toCanonicalRole(employee.role as AnyDbEmployeeRole);
  const supabase = await createClient();

  const budgetInboxStatuses = budgetPendingForRole(canonicalRole);

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
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .in("status", ["PLANNING", "ACTIVE"]),
    supabase
      .from("budgets")
      .select("total_planned_amount")
      .eq("status", "APPROVED")
      .limit(500),
    supabase.from("project_milestones").select("status, weight_bps").limit(2000),
    supabase
      .from("project_expenses")
      .select("id", { count: "exact", head: true })
      .in("status", EXPENSE_PENDING_STATUSES),
    supabase
      .from("cash_advances")
      .select("id", { count: "exact", head: true })
      .in("status", [
        ...CA_PENDING_APPROVAL_STATUSES,
        ...CANONICAL_CA_PENDING_STATUSES,
      ]),
    supabase
      .from("hr_requests")
      .select("id", { count: "exact", head: true })
      .in("status", HR_PENDING_STATUSES),
    budgetInboxStatuses.length > 0
      ? supabase
          .from("budgets")
          .select("id", { count: "exact", head: true })
          .in("status", budgetInboxStatuses)
      : Promise.resolve({ count: 0 }),
    supabase
      .from("project_issues")
      .select("sla_due_at, status")
      .in("status", ["OPEN", "IN_PROGRESS", "REOPENED"]),
    supabase
      .from("budget_requests")
      .select("id", { count: "exact", head: true })
      .in("status", ["PENDING_PM", "PENDING_FINANCE", "PENDING_DIRECTOR"]),
    supabase
      .from("timesheet_weeks")
      .select("id", { count: "exact", head: true })
      .eq("status", "SUBMITTED"),
  ]);

  const activeProjects = activeRes.count ?? 0;

  const approvedBudgets =
    (approvedBudgetRes.data ?? []) as unknown as {
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
