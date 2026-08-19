import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { ProjectStatus } from "@/lib/validation/project";

/**
 * Data + guard helpers for the projects module.
 *
 * The most consequential export is {@link assertProjectOperational}
 * (rules §6 lifecycle) — a server-side gate that every operational
 * mutation (expenses, cash advances, timesheets, issues) must run
 * before touching the DB. It refuses when the project has not been
 * unlocked for daily operations, i.e. still in DRAFT (Business Case
 * intake), PLANNING (budget drafting), or ARCHIVED.
 */

/**
 * Project stages that permit operational mutations (submit expense /
 * CA, log timesheet, open issue). Anything outside this set is either
 * pre-unlock (DRAFT, PLANNING) or post-close (COMPLETED, ARCHIVED —
 * with COMPLETED allowed for settlement wrap-up only).
 *
 * ACTIVE + ON_HOLD: full ops allowed.
 * COMPLETED       : settlement only — new drafts are refused. The
 *                   caller may still record settlement entries against
 *                   existing pending CAs.
 * DRAFT / PLANNING: no ops. Return a friendly error naming the stage
 *                   so the UI can guide the actor.
 * ARCHIVED        : hard stop.
 */
const OPERATIONAL_STATUSES: readonly ProjectStatus[] = [
  "ACTIVE",
  "ON_HOLD",
] as const;

const OPERATIONAL_MSG_ID: Record<ProjectStatus, string> = {
  DRAFT:
    "Project is still in Business Case (Draft) stage — promote to Planning and activate it before recording expenses or cash advances.",
  PLANNING:
    "Project is in Planning stage — the budget must be approved and a PM assigned before operational entries are allowed.",
  ACTIVE: "",
  ON_HOLD: "",
  COMPLETED:
    "Project is Completed — no new operational entries can be submitted. Settlement of pending items is still permitted.",
  ARCHIVED: "Project is Archived and read-only.",
};

/**
 * Throws when the project cannot accept new operational mutations.
 * Reads only `status` (tiny query, benefits from PG's page cache) and
 * relies on RLS to scope to the caller's tenant.
 */
export async function assertProjectOperational(
  projectId: string,
): Promise<{ status: ProjectStatus }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, status")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error("Project not found or not accessible.");
  }
  const status = data.status as ProjectStatus;
  if (!OPERATIONAL_STATUSES.includes(status)) {
    const msg = OPERATIONAL_MSG_ID[status];
    throw new Error(msg || `Project status ${status} does not allow operational entries.`);
  }
  return { status };
}

/**
 * Statuses in which Finance / OM is allowed to draft or edit budgets
 * (rules §6). DRAFT means "still in Business Case" — the intake is
 * not yet a real project so budgeting would be premature. COMPLETED
 * and ARCHIVED are terminal — no new commitments.
 */
const BUDGET_EDIT_STATUSES: readonly ProjectStatus[] = [
  "PLANNING",
  "ACTIVE",
  "ON_HOLD",
] as const;

const BUDGET_MSG: Record<ProjectStatus, string> = {
  DRAFT:
    "Project is still in Business Case (Draft) stage — promote to Planning first before drafting a budget.",
  PLANNING: "",
  ACTIVE: "",
  ON_HOLD: "",
  COMPLETED:
    "Project is Completed — new budgets are no longer accepted.",
  ARCHIVED: "Project is Archived and read-only.",
};

/**
 * Throws when the project is not in a stage that accepts new / edited
 * budget rows. Weaker gate than {@link assertProjectOperational}
 * because PLANNING is intentionally allowed here (that's the stage
 * where Finance drafts the numbers).
 */
export async function assertProjectAcceptsBudget(
  projectId: string,
): Promise<{ status: ProjectStatus }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, status")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Project not found or not accessible.");
  const status = data.status as ProjectStatus;
  if (!BUDGET_EDIT_STATUSES.includes(status)) {
    const msg = BUDGET_MSG[status];
    throw new Error(msg || `Project status ${status} does not accept budgets.`);
  }
  return { status };
}

/**
 * Read-only helper used by activation checks. Returns whether the
 * project has at least one APPROVED budget row (any fiscal year).
 * Kept plain (no cache) — activation is a rare event and the query is
 * indexed on `(project_id, status)`.
 */
export async function hasApprovedBudget(projectId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("budgets")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "APPROVED");
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/**
 * Read-only helper — does this project currently have an ACTIVE
 * primary PM assignment? Feeds the activation gate + UI banner CTA.
 */
export async function hasActivePmAssignment(
  projectId: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("project_pm_assignments")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("status", "ACTIVE");
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

/**
 * Compact `{id, code, name, status}` list for form pickers. Excludes
 * ARCHIVED by default because archived projects rarely need a new
 * association. RLS scopes to the caller's tenant automatically.
 *
 * Wrapped in `cache()` so the KB form and any other picker that
 * mounts on the same RSC render share a single query.
 */
export type ProjectPickerRow = {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
};

export const loadProjectsForPicker = cache(
  async (opts?: {
    includeArchived?: boolean;
  }): Promise<ProjectPickerRow[]> => {
    const supabase = await createClient();
    let q = supabase
      .from("projects")
      .select("id, code, name, status")
      .order("name", { ascending: true });
    if (!opts?.includeArchived) {
      q = q.neq("status", "ARCHIVED");
    }
    const { data, error } = await q;
    if (error || !data) return [];
    return data as ProjectPickerRow[];
  },
);
