/**
 * Portfolio snapshot aggregation (rules §8 executive dashboard).
 *
 * Pure functions — no Supabase, no auth. The dashboard action feeds rows
 * from Supabase in; this module returns a set of tiles + totals ready to
 * render.
 */

import { parseMoneyFromDb, type Money } from "@/lib/format/money";
import type {
  BudgetStatus,
  MilestoneStatus,
  ProjectStatus,
  ProjectType,
} from "@/types/database";

export type ProjectRow = {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  project_type: ProjectType;
  progress: number;
  clients: { name: string } | null;
};

export type BudgetRow = {
  id: string;
  project_id: string;
  title: string;
  fiscal_year: number;
  status: BudgetStatus;
  total_planned_amount: string;
  created_at: string;
};

export type BudgetDetailRow = {
  budget_id: string;
  planned_amount: string;
  realized_amount: string;
  outstanding_amount: string;
};

export type MilestoneRow = {
  project_id: string;
  status: MilestoneStatus;
  weight_bps: number;
};

export type PortfolioTile = {
  projectId: string;
  code: string;
  name: string;
  status: ProjectStatus;
  projectType: ProjectType;
  clientName: string | null;
  progressPct: number;
  milestoneCounts: Record<MilestoneStatus, number>;
  budget: {
    id: string | null;
    title: string | null;
    fiscalYear: number | null;
    status: BudgetStatus | null;
    planned: Money;
    realized: Money;
    outstanding: Money;
    /** utilization = (realized + outstanding) / planned × 100, floating percent */
    utilizationPct: number;
    /** true when a budget row exists at all */
    exists: boolean;
  };
};

export type PortfolioSnapshot = {
  activeProjectCount: number;
  totalPlannedAll: Money;
  totalRealizedAll: Money;
  totalOutstandingAll: Money;
  averageProgressPct: number;
  tiles: PortfolioTile[];
};

/**
 * Pick one "representative" budget per project. Preference:
 *   1. APPROVED
 *   2. PENDING_FINANCE / PENDING_DIRECTOR
 *   3. DRAFT / REVISED
 *   4. anything else (CANCELLED etc.)
 *
 * Within the same priority tier, prefer more-recent fiscal_year then more
 * recent created_at.
 */
export function selectRepresentativeBudgets(
  budgets: readonly BudgetRow[],
): Map<string, BudgetRow> {
  const priority = (b: BudgetRow): number => {
    if (b.status === "APPROVED") return 0;
    if (b.status === "PENDING_FINANCE" || b.status === "PENDING_DIRECTOR") return 1;
    if (b.status === "DRAFT" || b.status === "REVISED") return 2;
    return 3;
  };

  // Sort desc by (priority asc, fiscal_year desc, created_at desc) then
  // take the first per project.
  const sorted = [...budgets].sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    if (a.fiscal_year !== b.fiscal_year) return b.fiscal_year - a.fiscal_year;
    return b.created_at.localeCompare(a.created_at);
  });

  const chosen = new Map<string, BudgetRow>();
  for (const b of sorted) {
    if (!chosen.has(b.project_id)) chosen.set(b.project_id, b);
  }
  return chosen;
}

export function zeroMilestoneCounts(): Record<MilestoneStatus, number> {
  return {
    PLANNED: 0,
    IN_PROGRESS: 0,
    AT_RISK: 0,
    DONE: 0,
    CANCELLED: 0,
  };
}

/**
 * Build a portfolio snapshot from the four raw row sets.
 *
 * `projects` should already be filtered to the active portfolio (typically
 * PLANNING / ACTIVE / ON_HOLD).
 */
export function buildPortfolioSnapshot(input: {
  projects: readonly ProjectRow[];
  budgets: readonly BudgetRow[];
  budgetDetails: readonly BudgetDetailRow[];
  milestones: readonly MilestoneRow[];
}): PortfolioSnapshot {
  const budgetByProject = selectRepresentativeBudgets(input.budgets);

  const detailsByBudget = new Map<
    string,
    { realized: Money; outstanding: Money }
  >();
  for (const d of input.budgetDetails) {
    const cur = detailsByBudget.get(d.budget_id) ?? {
      realized: 0n,
      outstanding: 0n,
    };
    cur.realized += parseMoneyFromDb(d.realized_amount);
    cur.outstanding += parseMoneyFromDb(d.outstanding_amount);
    detailsByBudget.set(d.budget_id, cur);
  }

  const milestonesByProject = new Map<
    string,
    { counts: Record<MilestoneStatus, number> }
  >();
  for (const m of input.milestones) {
    const cur =
      milestonesByProject.get(m.project_id) ?? { counts: zeroMilestoneCounts() };
    cur.counts[m.status] += 1;
    milestonesByProject.set(m.project_id, cur);
  }

  const tiles: PortfolioTile[] = input.projects.map((p) => {
    const budget = budgetByProject.get(p.id);
    const details = budget ? detailsByBudget.get(budget.id) : undefined;
    const planned = budget ? parseMoneyFromDb(budget.total_planned_amount) : 0n;
    const realized = details?.realized ?? 0n;
    const outstanding = details?.outstanding ?? 0n;

    // Basis-points math for the utilisation percent so we do not lose
    // precision on huge planned amounts.
    const utilizationPct =
      planned > 0n
        ? Number(((realized + outstanding) * 10000n) / planned) / 100
        : 0;

    const ms = milestonesByProject.get(p.id) ?? { counts: zeroMilestoneCounts() };

    return {
      projectId: p.id,
      code: p.code,
      name: p.name,
      status: p.status,
      projectType: p.project_type,
      clientName: p.clients?.name ?? null,
      progressPct: Number(p.progress ?? 0),
      milestoneCounts: ms.counts,
      budget: {
        id: budget?.id ?? null,
        title: budget?.title ?? null,
        fiscalYear: budget?.fiscal_year ?? null,
        status: budget?.status ?? null,
        planned,
        realized,
        outstanding,
        utilizationPct,
        exists: Boolean(budget),
      },
    };
  });

  const activeProjectCount = tiles.filter(
    (t) => t.status === "ACTIVE" || t.status === "PLANNING",
  ).length;
  const totalPlannedAll = tiles.reduce(
    (acc, t) => acc + t.budget.planned,
    0n as Money,
  );
  const totalRealizedAll = tiles.reduce(
    (acc, t) => acc + t.budget.realized,
    0n as Money,
  );
  const totalOutstandingAll = tiles.reduce(
    (acc, t) => acc + t.budget.outstanding,
    0n as Money,
  );
  const averageProgressPct =
    tiles.length > 0
      ? tiles.reduce((acc, t) => acc + t.progressPct, 0) / tiles.length
      : 0;

  return {
    activeProjectCount,
    totalPlannedAll,
    totalRealizedAll,
    totalOutstandingAll,
    averageProgressPct,
    tiles,
  };
}
