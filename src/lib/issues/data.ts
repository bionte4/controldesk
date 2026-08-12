/**
 * ControlDesk — Project Issues data access (Fase 2, rules §26).
 *
 * All queries are tenant-scoped automatically via RLS
 * (`current_tenant_id()` derived from JWT claim). Callers are RSC / Server
 * Actions — never route directly to the browser.
 *
 * Every helper is wrapped in `React.cache()` so a single RSC render can
 * call it multiple times without redundant round-trips.
 */

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { issueSlaSnapshot, type IssueSlaSnapshot } from "./sla";
import type {
  Enums,
  ProjectIssueSeverity,
  ProjectIssueStatus,
  Tables,
} from "@/types/database";

export type IssueRow = Tables<"project_issues">;
export type IssueEventRow = Tables<"project_issue_events">;

export type IssueWithPeople = IssueRow & {
  reporter: Pick<Tables<"employees">, "id" | "full_name"> | null;
  assignee: Pick<Tables<"employees">, "id" | "full_name"> | null;
  project: Pick<Tables<"projects">, "id" | "code" | "name"> | null;
};

export type IssueEventWithActor = IssueEventRow & {
  actor: Pick<Tables<"employees">, "id" | "full_name"> | null;
};

export type IssueListItem = IssueWithPeople & {
  sla: IssueSlaSnapshot;
};

// ---------------------------------------------------------------------------
// Queries.
// ---------------------------------------------------------------------------

/** All issues for a project, newest first. */
export const listIssuesByProject = cache(
  async (projectId: string): Promise<IssueListItem[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_issues")
      .select(
        `
          *,
          reporter:employees!project_issues_reporter_employee_id_fkey(id, full_name),
          assignee:employees!project_issues_assignee_employee_id_fkey(id, full_name),
          project:projects!project_issues_project_id_fkey(id, code, name)
        `,
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map(withSlaSnapshot);
  },
);

/** All active (OPEN/IN_PROGRESS/REOPENED) issues in the tenant, sorted by
 *  SLA breach urgency then severity. Used by dashboard KPI + standalone
 *  Issues page. */
export const listActiveIssuesForTenant = cache(
  async (limit = 50): Promise<IssueListItem[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_issues")
      .select(
        `
          *,
          reporter:employees!project_issues_reporter_employee_id_fkey(id, full_name),
          assignee:employees!project_issues_assignee_employee_id_fkey(id, full_name),
          project:projects!project_issues_project_id_fkey(id, code, name)
        `,
      )
      .in("status", ["OPEN", "IN_PROGRESS", "REOPENED"])
      .order("sla_due_at", { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(withSlaSnapshot);
  },
);

/** One issue with people + event timeline. Returns `null` if not found /
 *  cross-tenant. */
export const getIssueWithEvents = cache(
  async (
    issueId: string,
  ): Promise<{
    issue: IssueListItem;
    events: IssueEventWithActor[];
  } | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_issues")
      .select(
        `
          *,
          reporter:employees!project_issues_reporter_employee_id_fkey(id, full_name),
          assignee:employees!project_issues_assignee_employee_id_fkey(id, full_name),
          project:projects!project_issues_project_id_fkey(id, code, name)
        `,
      )
      .eq("id", issueId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const { data: events, error: eventsError } = await supabase
      .from("project_issue_events")
      .select(
        `
          *,
          actor:employees!project_issue_events_actor_employee_id_fkey(id, full_name)
        `,
      )
      .eq("issue_id", issueId)
      .order("created_at", { ascending: true });
    if (eventsError) throw eventsError;

    return {
      issue: withSlaSnapshot(data),
      events: (events ?? []) as IssueEventWithActor[],
    };
  },
);

/**
 * Count of currently-breached and at-risk issues in the tenant. Used by
 * dashboard KPI + email digest.
 */
export const countIssuesSlaKpi = cache(
  async (): Promise<{
    breached: number;
    atRisk: number;
    active: number;
  }> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_issues")
      .select("sla_due_at,status")
      .in("status", ["OPEN", "IN_PROGRESS", "REOPENED"]);
    if (error) throw error;

    const now = new Date();
    let breached = 0;
    let atRisk = 0;
    for (const row of data ?? []) {
      const snap = issueSlaSnapshot(new Date(row.sla_due_at), now);
      if (snap.breached) breached += 1;
      else if (snap.atRisk) atRisk += 1;
    }
    return { breached, atRisk, active: data?.length ?? 0 };
  },
);

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/**
 * Attach a live SLA snapshot to a raw DB row. The DB stores `sla_due_at`
 * as UTC — we hydrate it into a JS `Date` and compute business-hours
 * remaining vs `new Date()`.
 */
function withSlaSnapshot(row: IssueWithPeople): IssueListItem {
  return {
    ...row,
    sla: issueSlaSnapshot(new Date(row.sla_due_at)),
  };
}

// Re-export enum types so callers can `import type {...}` from one place.
export type IssueStatusValue = Enums<"project_issue_status">;
export type IssueSeverityValue = Enums<"project_issue_severity">;
export type { ProjectIssueSeverity, ProjectIssueStatus };
