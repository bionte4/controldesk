/**
 * ControlDesk — Client Portal read-only data helpers (GAS §28).
 *
 * SECURITY CONTRACT — every function in this module MUST:
 *   1. Accept a `PortalSession` argument (never re-read the cookie
 *      internally — callers should have already resolved it).
 *   2. Restrict the query with both `.eq("tenant_id", session.client.tenant_id)`
 *      AND (where applicable) `.eq("client_id", session.client.id)`.
 *   3. Only return the projection needed by the caller — never `select("*")`
 *      on tables that hold internal-role columns (e.g. `employees.role`,
 *      `project_expenses.actor_employee_id`) so we don't leak.
 *   4. Use the service-role Supabase client so RLS's "authenticated" gate
 *      doesn't block portal-user visitors (they have no JWT).
 *
 * These invariants are the ONLY thing separating a client from another
 * tenant's data — RLS cannot help here because the client-user path has no
 * `authenticated` role attached to it.
 */

import { cache } from "react";

import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

import type { PortalSession } from "./session";

export type PortalProjectRow = Pick<
  Tables<"projects">,
  | "id"
  | "tenant_id"
  | "client_id"
  | "code"
  | "name"
  | "status"
  | "progress"
  | "start_date"
  | "end_date"
  | "project_type"
  | "description"
>;

export type PortalMilestoneRow = Pick<
  Tables<"project_milestones">,
  | "id"
  | "project_id"
  | "seq"
  | "name"
  | "description"
  | "weight_bps"
  | "status"
  | "planned_start_date"
  | "planned_end_date"
  | "actual_start_date"
  | "actual_end_date"
>;

export type PortalContractRow = Pick<
  Tables<"bpo_contracts">,
  | "id"
  | "contract_number"
  | "mrr_amount"
  | "currency"
  | "start_date"
  | "end_date"
  | "status"
  | "notes"
>;

export type PortalProjectFinance = {
  /** May be null when the project has no `project_budgets` row yet. */
  budget_amount: string;
  spent_amount: string;
  currency: string;
  /** Contracts on the SAME client whose active window overlaps the project. */
  overlapping_contracts: PortalContractRow[];
};

const PROJECT_COLS =
  "id, tenant_id, client_id, code, name, status, progress, start_date, end_date, project_type, description" as const;

const MILESTONE_COLS =
  "id, project_id, seq, name, description, weight_bps, status, planned_start_date, planned_end_date, actual_start_date, actual_end_date" as const;

const CONTRACT_COLS =
  "id, contract_number, mrr_amount, currency, start_date, end_date, status, notes" as const;

/**
 * List projects owned by the client. Cached per request.
 */
export const listPortalProjects = cache(
  async (session: PortalSession): Promise<PortalProjectRow[]> => {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("projects")
      .select(PROJECT_COLS)
      .eq("tenant_id", session.client.tenant_id)
      .eq("client_id", session.client.id)
      .order("start_date", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []) as unknown as PortalProjectRow[];
  },
);

/**
 * Fetch a single project owned by the client. Returns `null` if the id
 * doesn't belong to this client (i.e. someone tried `/portal/projects/<id>`
 * of another tenant's project — the tenant + client_id filters block it).
 */
export const getPortalProject = cache(
  async (
    session: PortalSession,
    projectId: string,
  ): Promise<PortalProjectRow | null> => {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("projects")
      .select(PROJECT_COLS)
      .eq("tenant_id", session.client.tenant_id)
      .eq("client_id", session.client.id)
      .eq("id", projectId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as unknown as PortalProjectRow | null;
  },
);

/**
 * List milestones for a project owned by this client. The extra
 * `projects` join in the filter is defence-in-depth: even if a caller
 * somehow forwarded a milestone id belonging to another client, the join
 * would return zero rows.
 */
export const listPortalMilestones = cache(
  async (
    session: PortalSession,
    projectId: string,
  ): Promise<PortalMilestoneRow[]> => {
    const project = await getPortalProject(session, projectId);
    if (!project) return [];
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("project_milestones")
      .select(MILESTONE_COLS)
      .eq("tenant_id", session.client.tenant_id)
      .eq("project_id", projectId)
      .order("seq", { ascending: true });
    if (error) throw error;
    return (data ?? []) as unknown as PortalMilestoneRow[];
  },
);

/**
 * List every ACTIVE contract for the current client. Used on the portal
 * dashboard finance strip AND on the project detail Financials section.
 */
export const listPortalClientContracts = cache(
  async (session: PortalSession): Promise<PortalContractRow[]> => {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("bpo_contracts")
      .select(CONTRACT_COLS)
      .eq("tenant_id", session.client.tenant_id)
      .eq("client_id", session.client.id)
      .in("status", ["ACTIVE", "DRAFT"])
      .order("start_date", { ascending: false, nullsFirst: false });
    if (error) throw error;
    return (data ?? []) as unknown as PortalContractRow[];
  },
);

/**
 * Per-project financial summary: budget + spent aggregate + overlapping
 * contracts. Deliberately does NOT expose the underlying `project_expenses`
 * rows (internal cost structure). Returns `null` when the project doesn't
 * belong to this client (mirrors `getPortalProject` semantics).
 */
export const getPortalProjectFinance = cache(
  async (
    session: PortalSession,
    projectId: string,
  ): Promise<PortalProjectFinance | null> => {
    const project = await getPortalProject(session, projectId);
    if (!project) return null;

    const supabase = createServiceRoleClient();

    const { data: budget, error: budgetErr } = await supabase
      .from("project_budgets")
      .select("budget_amount, spent_amount, currency")
      .eq("tenant_id", session.client.tenant_id)
      .eq("project_id", projectId)
      .maybeSingle();
    if (budgetErr) throw budgetErr;

    // Contracts for this client whose window overlaps the project. Contracts
    // with `end_date IS NULL` are open-ended and count as overlapping if
    // they started on/before the project's end_date (or the project has no
    // end_date).
    let contractsQ = supabase
      .from("bpo_contracts")
      .select(CONTRACT_COLS)
      .eq("tenant_id", session.client.tenant_id)
      .eq("client_id", session.client.id)
      .in("status", ["ACTIVE", "DRAFT"]);

    if (project.end_date) {
      contractsQ = contractsQ.lte("start_date", project.end_date);
    }
    const { data: contracts, error: contractsErr } = await contractsQ.order(
      "start_date",
      { ascending: false, nullsFirst: false },
    );
    if (contractsErr) throw contractsErr;

    const filtered = ((contracts ?? []) as unknown as PortalContractRow[]).filter(
      (c) => {
        // Second-pass filter: contract must end after project start (or be open-ended).
        if (project.start_date && c.end_date) {
          return c.end_date >= project.start_date;
        }
        return true;
      },
    );

    return {
      budget_amount: (budget?.budget_amount ?? "0").toString(),
      spent_amount: (budget?.spent_amount ?? "0").toString(),
      currency: budget?.currency ?? "IDR",
      overlapping_contracts: filtered,
    };
  },
);

/**
 * KPI counts for the portal dashboard. Kept as a single call so the RSC
 * page can render everything above the fold in one round-trip.
 */
export const getPortalDashboardStats = cache(
  async (
    session: PortalSession,
  ): Promise<{
    total_projects: number;
    active_projects: number;
    completed_projects: number;
    avg_progress_pct: number;
  }> => {
    const projects = await listPortalProjects(session);
    const total = projects.length;
    const active = projects.filter(
      (p) => p.status === "ACTIVE" || p.status === "PLANNING",
    ).length;
    const completed = projects.filter((p) => p.status === "COMPLETED").length;
    const avg =
      total === 0
        ? 0
        : Math.round(
            projects.reduce((sum, p) => sum + Number(p.progress ?? 0), 0) /
              total,
          );
    return {
      total_projects: total,
      active_projects: active,
      completed_projects: completed,
      avg_progress_pct: avg,
    };
  },
);
