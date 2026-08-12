import { describe, it, expect } from "vitest";

import {
  buildPortfolioSnapshot,
  selectRepresentativeBudgets,
  zeroMilestoneCounts,
  type BudgetDetailRow,
  type BudgetRow,
  type MilestoneRow,
  type ProjectRow,
} from "./snapshot";

// ---------------------------------------------------------------------------
// Fixture helpers.
// ---------------------------------------------------------------------------

function project(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "proj-1",
    code: "PRJ-001",
    name: "Untitled Project",
    status: "ACTIVE",
    project_type: "FIXED_PRICE",
    progress: 0,
    clients: { name: "Acme Corp" },
    ...overrides,
  };
}

function budget(overrides: Partial<BudgetRow> = {}): BudgetRow {
  return {
    id: "bud-1",
    project_id: "proj-1",
    title: "FY2026",
    fiscal_year: 2026,
    status: "APPROVED",
    total_planned_amount: "0",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function detail(overrides: Partial<BudgetDetailRow> = {}): BudgetDetailRow {
  return {
    budget_id: "bud-1",
    planned_amount: "0",
    realized_amount: "0",
    outstanding_amount: "0",
    ...overrides,
  };
}

function milestone(overrides: Partial<MilestoneRow> = {}): MilestoneRow {
  return {
    project_id: "proj-1",
    status: "PLANNED",
    weight_bps: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// zeroMilestoneCounts.
// ---------------------------------------------------------------------------

describe("zeroMilestoneCounts", () => {
  it("returns all five statuses set to zero", () => {
    const c = zeroMilestoneCounts();
    expect(c).toEqual({
      PLANNED: 0,
      IN_PROGRESS: 0,
      AT_RISK: 0,
      DONE: 0,
      CANCELLED: 0,
    });
  });

  it("returns a fresh object each call", () => {
    const a = zeroMilestoneCounts();
    const b = zeroMilestoneCounts();
    a.DONE = 5;
    expect(b.DONE).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// selectRepresentativeBudgets.
// ---------------------------------------------------------------------------

describe("selectRepresentativeBudgets", () => {
  it("prefers APPROVED over any pending status", () => {
    const chosen = selectRepresentativeBudgets([
      budget({ id: "b1", status: "PENDING_FINANCE" }),
      budget({ id: "b2", status: "APPROVED" }),
    ]);
    expect(chosen.get("proj-1")?.id).toBe("b2");
  });

  it("prefers PENDING_FINANCE over DRAFT", () => {
    const chosen = selectRepresentativeBudgets([
      budget({ id: "b1", status: "DRAFT" }),
      budget({ id: "b2", status: "PENDING_FINANCE" }),
    ]);
    expect(chosen.get("proj-1")?.id).toBe("b2");
  });

  it("prefers PENDING_DIRECTOR over DRAFT", () => {
    const chosen = selectRepresentativeBudgets([
      budget({ id: "b1", status: "DRAFT" }),
      budget({ id: "b2", status: "PENDING_DIRECTOR" }),
    ]);
    expect(chosen.get("proj-1")?.id).toBe("b2");
  });

  it("prefers DRAFT / REVISED over CANCELLED", () => {
    const chosen = selectRepresentativeBudgets([
      budget({ id: "b1", status: "CANCELLED" }),
      budget({ id: "b2", status: "REVISED" }),
    ]);
    expect(chosen.get("proj-1")?.id).toBe("b2");
  });

  it("breaks ties on same priority by newer fiscal year", () => {
    const chosen = selectRepresentativeBudgets([
      budget({ id: "b1", status: "APPROVED", fiscal_year: 2025 }),
      budget({ id: "b2", status: "APPROVED", fiscal_year: 2026 }),
    ]);
    expect(chosen.get("proj-1")?.id).toBe("b2");
  });

  it("breaks ties within same fiscal year by newer created_at", () => {
    const chosen = selectRepresentativeBudgets([
      budget({
        id: "b1",
        status: "APPROVED",
        fiscal_year: 2026,
        created_at: "2026-01-01T00:00:00.000Z",
      }),
      budget({
        id: "b2",
        status: "APPROVED",
        fiscal_year: 2026,
        created_at: "2026-06-01T00:00:00.000Z",
      }),
    ]);
    expect(chosen.get("proj-1")?.id).toBe("b2");
  });

  it("returns one budget per project", () => {
    const chosen = selectRepresentativeBudgets([
      budget({ id: "a", project_id: "p1", status: "APPROVED" }),
      budget({ id: "b", project_id: "p2", status: "DRAFT" }),
      budget({ id: "c", project_id: "p3", status: "PENDING_FINANCE" }),
    ]);
    expect(chosen.size).toBe(3);
    expect(chosen.get("p1")?.id).toBe("a");
    expect(chosen.get("p2")?.id).toBe("b");
    expect(chosen.get("p3")?.id).toBe("c");
  });

  it("returns an empty map when given no budgets", () => {
    expect(selectRepresentativeBudgets([]).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildPortfolioSnapshot.
// ---------------------------------------------------------------------------

describe("buildPortfolioSnapshot — empty inputs", () => {
  it("returns zero aggregates and no tiles", () => {
    const snap = buildPortfolioSnapshot({
      projects: [],
      budgets: [],
      budgetDetails: [],
      milestones: [],
    });
    expect(snap.tiles).toEqual([]);
    expect(snap.activeProjectCount).toBe(0);
    expect(snap.totalPlannedAll).toBe(0n);
    expect(snap.totalRealizedAll).toBe(0n);
    expect(snap.totalOutstandingAll).toBe(0n);
    expect(snap.averageProgressPct).toBe(0);
  });
});

describe("buildPortfolioSnapshot — project without budget", () => {
  const snap = buildPortfolioSnapshot({
    projects: [project({ id: "p1" })],
    budgets: [],
    budgetDetails: [],
    milestones: [],
  });

  it("marks the budget as non-existent", () => {
    expect(snap.tiles[0]?.budget.exists).toBe(false);
    expect(snap.tiles[0]?.budget.id).toBeNull();
    expect(snap.tiles[0]?.budget.planned).toBe(0n);
    expect(snap.tiles[0]?.budget.utilizationPct).toBe(0);
  });

  it("still counts the project as active", () => {
    expect(snap.activeProjectCount).toBe(1);
  });
});

describe("buildPortfolioSnapshot — happy path", () => {
  const snap = buildPortfolioSnapshot({
    projects: [
      project({ id: "p1", progress: 40 }),
      project({ id: "p2", progress: 80, status: "PLANNING" }),
      project({ id: "p3", progress: 100, status: "ON_HOLD" }),
    ],
    budgets: [
      budget({
        id: "b1",
        project_id: "p1",
        status: "APPROVED",
        total_planned_amount: "100000000",
      }),
      budget({
        id: "b2",
        project_id: "p2",
        status: "PENDING_FINANCE",
        total_planned_amount: "50000000",
      }),
    ],
    budgetDetails: [
      detail({ budget_id: "b1", realized_amount: "30000000", outstanding_amount: "20000000" }),
      detail({ budget_id: "b1", realized_amount: "10000000", outstanding_amount: "0" }),
      detail({ budget_id: "b2", realized_amount: "5000000", outstanding_amount: "5000000" }),
    ],
    milestones: [
      milestone({ project_id: "p1", status: "DONE" }),
      milestone({ project_id: "p1", status: "IN_PROGRESS" }),
      milestone({ project_id: "p2", status: "AT_RISK" }),
    ],
  });

  it("selects the correct representative budget per project", () => {
    const p1 = snap.tiles.find((t) => t.projectId === "p1");
    const p2 = snap.tiles.find((t) => t.projectId === "p2");
    expect(p1?.budget.id).toBe("b1");
    expect(p1?.budget.status).toBe("APPROVED");
    expect(p2?.budget.id).toBe("b2");
    expect(p2?.budget.status).toBe("PENDING_FINANCE");
  });

  it("aggregates realized / outstanding across line items", () => {
    const p1 = snap.tiles.find((t) => t.projectId === "p1");
    expect(p1?.budget.realized).toBe(40_000_000n);
    expect(p1?.budget.outstanding).toBe(20_000_000n);
  });

  it("computes budget utilisation as (realized + outstanding) / planned × 100", () => {
    const p1 = snap.tiles.find((t) => t.projectId === "p1");
    // (40M + 20M) / 100M = 60.00%
    expect(p1?.budget.utilizationPct).toBeCloseTo(60);
  });

  it("counts milestones by status per project", () => {
    const p1 = snap.tiles.find((t) => t.projectId === "p1");
    expect(p1?.milestoneCounts.DONE).toBe(1);
    expect(p1?.milestoneCounts.IN_PROGRESS).toBe(1);
    expect(p1?.milestoneCounts.AT_RISK).toBe(0);
  });

  it("counts only ACTIVE + PLANNING as active projects (not ON_HOLD)", () => {
    expect(snap.activeProjectCount).toBe(2);
  });

  it("sums planned across all tiles including projects without budgets", () => {
    expect(snap.totalPlannedAll).toBe(150_000_000n);
  });

  it("averages progress across all tiles (including ON_HOLD)", () => {
    // (40 + 80 + 100) / 3 = 73.33...
    expect(snap.averageProgressPct).toBeCloseTo(73.333, 2);
  });
});

describe("buildPortfolioSnapshot — over-budget project", () => {
  const snap = buildPortfolioSnapshot({
    projects: [project({ id: "p1", progress: 100 })],
    budgets: [
      budget({
        id: "b1",
        project_id: "p1",
        status: "APPROVED",
        total_planned_amount: "10000000",
      }),
    ],
    budgetDetails: [
      detail({
        budget_id: "b1",
        realized_amount: "8000000",
        outstanding_amount: "7000000",
      }),
    ],
    milestones: [],
  });

  it("reports > 100% utilisation for over-spend", () => {
    // (8M + 7M) / 10M = 150%
    expect(snap.tiles[0]?.budget.utilizationPct).toBeCloseTo(150);
  });
});

describe("buildPortfolioSnapshot — precision", () => {
  it("keeps huge planned amounts precise via bigint math", () => {
    const snap = buildPortfolioSnapshot({
      projects: [project({ id: "p1" })],
      budgets: [
        budget({
          id: "b1",
          project_id: "p1",
          total_planned_amount: "999999999999",
        }),
      ],
      budgetDetails: [
        detail({
          budget_id: "b1",
          realized_amount: "333333333333",
          outstanding_amount: "0",
        }),
      ],
      milestones: [],
    });
    // Should not lose precision even at trillion-rupiah scale.
    expect(snap.tiles[0]?.budget.planned).toBe(999_999_999_999n);
    expect(snap.tiles[0]?.budget.realized).toBe(333_333_333_333n);
    expect(snap.tiles[0]?.budget.utilizationPct).toBeCloseTo(33.33, 2);
  });
});

describe("buildPortfolioSnapshot — client name resolution", () => {
  it("exposes client name when present", () => {
    const snap = buildPortfolioSnapshot({
      projects: [project({ id: "p1", clients: { name: "Kirana Studio" } })],
      budgets: [],
      budgetDetails: [],
      milestones: [],
    });
    expect(snap.tiles[0]?.clientName).toBe("Kirana Studio");
  });

  it("returns null when client relation is missing", () => {
    const snap = buildPortfolioSnapshot({
      projects: [project({ id: "p1", clients: null })],
      budgets: [],
      budgetDetails: [],
      milestones: [],
    });
    expect(snap.tiles[0]?.clientName).toBeNull();
  });
});
