import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { TaskStatus, Tables } from "@/types/database";

/**
 * Data helpers for the WBS `project_tasks` module.
 *
 * `loadProjectTasks(projectId)` returns a *flat* array (RLS-scoped, ordered
 * by parent + sort_order). `buildTaskTree()` folds it into a tree with
 * derived `wbs_code`, `depth`, `children`, and rolled-up `rolled_progress`
 * / `rolled_start` / `rolled_end` so the UI can render both the tree
 * and a Gantt chart from a single fetch.
 *
 * The rollup lives in TypeScript (not a trigger) to keep writes cheap
 * — cf. the migration header.
 */

export type ProjectTaskRow = Tables<"project_tasks">;

/** Enriched node for tree rendering. */
export type TaskTreeNode = ProjectTaskRow & {
  /** "1.2.3" style code derived from sort_order + parent chain. */
  wbs_code: string;
  /** 0-based depth (0 = root). */
  depth: number;
  /** Immediate children in sort order. */
  children: TaskTreeNode[];
  /** Progress rolled-up from descendants (leaf uses own progress_pct). */
  rolled_progress: number;
  /** Earliest planned_start_date in the subtree (or own). */
  rolled_start: string | null;
  /** Latest planned_end_date in the subtree (or own). */
  rolled_end: string | null;
};

/**
 * Fetch all tasks for a project. RLS enforces tenant + read policy.
 * Deduped per RSC request via `React.cache()`.
 */
export const loadProjectTasks = cache(
  async (projectId: string): Promise<ProjectTaskRow[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_tasks")
      .select("*")
      .eq("project_id", projectId)
      .order("parent_task_id", { ascending: true, nullsFirst: true })
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  },
);

/**
 * Fold a flat task list into a rooted tree with derived fields.
 *
 * @param rows           Flat tasks in the parent+sort_order order returned
 *                       by `loadProjectTasks()`.
 * @returns              Array of root nodes (parent_task_id === null),
 *                       each with `children[]`, `depth`, `wbs_code`,
 *                       and rolled-up progress / dates.
 */
export function buildTaskTree(rows: ProjectTaskRow[]): TaskTreeNode[] {
  // 1. Materialise enriched shells indexed by id.
  const byId = new Map<string, TaskTreeNode>();
  for (const row of rows) {
    byId.set(row.id, {
      ...row,
      wbs_code: "",
      depth: 0,
      children: [],
      rolled_progress: 0,
      rolled_start: null,
      rolled_end: null,
    });
  }

  // 2. Wire children onto parents.
  const roots: TaskTreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_task_id) {
      const parent = byId.get(node.parent_task_id);
      if (parent) {
        parent.children.push(node);
      } else {
        // Orphan (parent deleted?) — treat as root to keep it visible.
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  // 3. Sort every children[] array by sort_order.
  const sortChildren = (n: TaskTreeNode) => {
    n.children.sort((a, b) => a.sort_order - b.sort_order);
    n.children.forEach(sortChildren);
  };
  roots.sort((a, b) => a.sort_order - b.sort_order);
  roots.forEach(sortChildren);

  // 4. Assign wbs_code and depth via DFS.
  const assignCode = (n: TaskTreeNode, prefix: string, depth: number) => {
    n.wbs_code = prefix;
    n.depth = depth;
    n.children.forEach((child, idx) => {
      const nextPrefix = prefix ? `${prefix}.${idx + 1}` : String(idx + 1);
      assignCode(child, nextPrefix, depth + 1);
    });
  };
  roots.forEach((n, idx) => assignCode(n, String(idx + 1), 0));

  // 5. Roll up progress + date range post-order.
  //    Leaves use own progress_pct. Parents = weighted average by weight_pct
  //    if any child has weight > 0, otherwise simple mean.
  const rollup = (n: TaskTreeNode) => {
    if (n.children.length === 0) {
      n.rolled_progress = n.progress_pct;
      n.rolled_start = n.planned_start_date;
      n.rolled_end = n.planned_end_date;
      return;
    }
    n.children.forEach(rollup);

    const weightedSum = n.children.reduce(
      (acc, c) => acc + (c.weight_pct || 0) * c.rolled_progress,
      0,
    );
    const totalWeight = n.children.reduce(
      (acc, c) => acc + (c.weight_pct || 0),
      0,
    );
    if (totalWeight > 0) {
      n.rolled_progress = Math.round((weightedSum / totalWeight) * 100) / 100;
    } else {
      const avg =
        n.children.reduce((acc, c) => acc + c.rolled_progress, 0) /
        n.children.length;
      n.rolled_progress = Math.round(avg * 100) / 100;
    }

    n.rolled_start = earliestDate([
      n.planned_start_date,
      ...n.children.map((c) => c.rolled_start),
    ]);
    n.rolled_end = latestDate([
      n.planned_end_date,
      ...n.children.map((c) => c.rolled_end),
    ]);
  };
  roots.forEach(rollup);

  return roots;
}

/** Flatten a tree back to a preorder list — handy for table rendering. */
export function flattenTaskTree(nodes: TaskTreeNode[]): TaskTreeNode[] {
  const out: TaskTreeNode[] = [];
  const walk = (n: TaskTreeNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

function earliestDate(dates: (string | null)[]): string | null {
  const valid = dates.filter((d): d is string => Boolean(d));
  if (valid.length === 0) return null;
  return valid.reduce((min, d) => (d < min ? d : min));
}

function latestDate(dates: (string | null)[]): string | null {
  const valid = dates.filter((d): d is string => Boolean(d));
  if (valid.length === 0) return null;
  return valid.reduce((max, d) => (d > max ? d : max));
}

// ---------------------------------------------------------------------------
// Aggregate helpers exported for UI badges / stats cards.
// ---------------------------------------------------------------------------

export type TaskStats = {
  total: number;
  byStatus: Record<TaskStatus, number>;
  overdue: number;
  averageProgress: number;
};

export function computeTaskStats(rows: ProjectTaskRow[]): TaskStats {
  const byStatus: Record<TaskStatus, number> = {
    TODO: 0,
    IN_PROGRESS: 0,
    BLOCKED: 0,
    REVIEW: 0,
    DONE: 0,
    CANCELLED: 0,
  };
  const today = new Date().toISOString().slice(0, 10);
  let overdue = 0;
  let progressSum = 0;
  let progressCount = 0;

  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    if (
      row.planned_end_date &&
      row.planned_end_date < today &&
      row.status !== "DONE" &&
      row.status !== "CANCELLED"
    ) {
      overdue += 1;
    }
    if (row.status !== "CANCELLED") {
      progressSum += row.progress_pct;
      progressCount += 1;
    }
  }

  return {
    total: rows.length,
    byStatus,
    overdue,
    averageProgress:
      progressCount > 0
        ? Math.round((progressSum / progressCount) * 100) / 100
        : 0,
  };
}
