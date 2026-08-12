import { describe, expect, it } from "vitest";

import type { ProjectTaskRow } from "./tasks";
import {
  buildTaskTree,
  computeTaskStats,
  flattenTaskTree,
} from "./tasks";

function makeRow(overrides: Partial<ProjectTaskRow>): ProjectTaskRow {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    tenant_id: overrides.tenant_id ?? "t1",
    project_id: overrides.project_id ?? "p1",
    milestone_id: overrides.milestone_id ?? null,
    parent_task_id: overrides.parent_task_id ?? null,
    sort_order: overrides.sort_order ?? 0,
    name: overrides.name ?? "Task",
    description: overrides.description ?? null,
    status: overrides.status ?? "TODO",
    progress_pct: overrides.progress_pct ?? 0,
    weight_pct: overrides.weight_pct ?? 0,
    planned_start_date: overrides.planned_start_date ?? null,
    planned_end_date: overrides.planned_end_date ?? null,
    actual_start_date: overrides.actual_start_date ?? null,
    actual_end_date: overrides.actual_end_date ?? null,
    owner_employee_id: overrides.owner_employee_id ?? null,
    depends_on_task_id: overrides.depends_on_task_id ?? null,
    budget_amount: overrides.budget_amount ?? null,
    created_by: overrides.created_by ?? null,
    created_at: overrides.created_at ?? new Date().toISOString(),
    updated_at: overrides.updated_at ?? new Date().toISOString(),
  };
}

describe("buildTaskTree", () => {
  it("returns empty for no rows", () => {
    expect(buildTaskTree([])).toEqual([]);
  });

  it("builds a single-level tree with wbs codes 1, 2, 3", () => {
    const rows = [
      makeRow({ id: "a", name: "A", sort_order: 0 }),
      makeRow({ id: "b", name: "B", sort_order: 1 }),
      makeRow({ id: "c", name: "C", sort_order: 2 }),
    ];
    const tree = buildTaskTree(rows);
    expect(tree.map((n) => n.wbs_code)).toEqual(["1", "2", "3"]);
    expect(tree.every((n) => n.depth === 0)).toBe(true);
  });

  it("nests children under parent + assigns hierarchical codes", () => {
    const rows = [
      makeRow({ id: "a", name: "A", sort_order: 0 }),
      makeRow({ id: "a1", name: "A1", parent_task_id: "a", sort_order: 0 }),
      makeRow({ id: "a2", name: "A2", parent_task_id: "a", sort_order: 1 }),
      makeRow({ id: "a1a", name: "A1a", parent_task_id: "a1", sort_order: 0 }),
    ];
    const tree = buildTaskTree(rows);
    expect(tree).toHaveLength(1);
    const a = tree[0];
    expect(a.wbs_code).toBe("1");
    expect(a.children.map((c) => c.wbs_code)).toEqual(["1.1", "1.2"]);
    expect(a.children[0].children[0].wbs_code).toBe("1.1.1");
    expect(a.children[0].children[0].depth).toBe(2);
  });

  it("respects sort_order within siblings", () => {
    const rows = [
      makeRow({ id: "b", name: "B", sort_order: 1 }),
      makeRow({ id: "a", name: "A", sort_order: 0 }),
      makeRow({ id: "c", name: "C", sort_order: 2 }),
    ];
    const tree = buildTaskTree(rows);
    expect(tree.map((n) => n.name)).toEqual(["A", "B", "C"]);
  });

  it("rolls up progress using weighted average when weights present", () => {
    const rows = [
      makeRow({ id: "root", name: "R", sort_order: 0 }),
      // 50% weight, 100% done → contributes 50
      makeRow({
        id: "c1",
        parent_task_id: "root",
        sort_order: 0,
        weight_pct: 50,
        progress_pct: 100,
      }),
      // 50% weight, 0% done → contributes 0
      makeRow({
        id: "c2",
        parent_task_id: "root",
        sort_order: 1,
        weight_pct: 50,
        progress_pct: 0,
      }),
    ];
    const tree = buildTaskTree(rows);
    expect(tree[0].rolled_progress).toBe(50);
  });

  it("rolls up progress using simple mean when no weights", () => {
    const rows = [
      makeRow({ id: "root", name: "R", sort_order: 0 }),
      makeRow({
        id: "c1",
        parent_task_id: "root",
        sort_order: 0,
        progress_pct: 40,
      }),
      makeRow({
        id: "c2",
        parent_task_id: "root",
        sort_order: 1,
        progress_pct: 60,
      }),
    ];
    const tree = buildTaskTree(rows);
    expect(tree[0].rolled_progress).toBe(50);
  });

  it("rolled_start = earliest, rolled_end = latest across subtree", () => {
    const rows = [
      makeRow({ id: "root", sort_order: 0 }),
      makeRow({
        id: "c1",
        parent_task_id: "root",
        sort_order: 0,
        planned_start_date: "2026-08-10",
        planned_end_date: "2026-08-20",
      }),
      makeRow({
        id: "c2",
        parent_task_id: "root",
        sort_order: 1,
        planned_start_date: "2026-08-05",
        planned_end_date: "2026-08-15",
      }),
    ];
    const tree = buildTaskTree(rows);
    expect(tree[0].rolled_start).toBe("2026-08-05");
    expect(tree[0].rolled_end).toBe("2026-08-20");
  });
});

describe("flattenTaskTree", () => {
  it("returns preorder DFS", () => {
    const rows = [
      makeRow({ id: "a", name: "A", sort_order: 0 }),
      makeRow({ id: "a1", name: "A1", parent_task_id: "a", sort_order: 0 }),
      makeRow({ id: "b", name: "B", sort_order: 1 }),
    ];
    const tree = buildTaskTree(rows);
    const flat = flattenTaskTree(tree);
    expect(flat.map((n) => n.name)).toEqual(["A", "A1", "B"]);
  });
});

describe("computeTaskStats", () => {
  it("counts totals + by-status + overdue + average", () => {
    const rows = [
      makeRow({ id: "1", status: "DONE", progress_pct: 100 }),
      makeRow({ id: "2", status: "IN_PROGRESS", progress_pct: 30 }),
      makeRow({
        id: "3",
        status: "TODO",
        progress_pct: 0,
        planned_end_date: "2020-01-01", // long overdue
      }),
      makeRow({ id: "4", status: "CANCELLED", progress_pct: 10 }),
    ];
    const stats = computeTaskStats(rows);
    expect(stats.total).toBe(4);
    expect(stats.byStatus.DONE).toBe(1);
    expect(stats.byStatus.IN_PROGRESS).toBe(1);
    expect(stats.byStatus.TODO).toBe(1);
    expect(stats.byStatus.CANCELLED).toBe(1);
    expect(stats.overdue).toBe(1);
    // Average excludes CANCELLED — (100 + 30 + 0) / 3 ≈ 43.33
    expect(stats.averageProgress).toBeCloseTo(43.33, 2);
  });

  it("returns zeros for empty list", () => {
    const stats = computeTaskStats([]);
    expect(stats.total).toBe(0);
    expect(stats.overdue).toBe(0);
    expect(stats.averageProgress).toBe(0);
  });
});
