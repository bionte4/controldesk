/**
 * ControlDesk — Budget Request data access (Fase 2, rules §9.6).
 *
 * All queries tenant-scoped via RLS. Callers are RSC / Server Actions.
 */

import { cache } from "react";

import { BR_PENDING_STATUSES } from "./state";
import { createClient } from "@/lib/supabase/server";
import type {
  BudgetRequestStatus,
  Tables,
} from "@/types/database";

export type BudgetRequestRow = Tables<"budget_requests">;
export type BudgetRequestLineRow = Tables<"budget_request_lines">;
export type BudgetRequestApprovalLogRow =
  Tables<"budget_request_approval_logs">;

export type BudgetRequestWithMeta = BudgetRequestRow & {
  requester: Pick<Tables<"employees">, "id" | "full_name"> | null;
  budget: Pick<
    Tables<"budgets">,
    "id" | "title" | "fiscal_year" | "project_id"
  > | null;
  lines: (BudgetRequestLineRow & {
    detail: Pick<Tables<"budget_details">, "id" | "seq" | "category"> | null;
  })[];
};

export type BudgetRequestWithLogs = BudgetRequestWithMeta & {
  logs: (BudgetRequestApprovalLogRow & {
    actor: Pick<Tables<"employees">, "id" | "full_name"> | null;
  })[];
};

// ---------------------------------------------------------------------------
// Queries.
// ---------------------------------------------------------------------------

const REQUEST_WITH_META_SELECT = `
  *,
  requester:employees!budget_requests_requester_employee_id_fkey(id, full_name),
  budget:budgets!budget_requests_budget_id_fkey(id, title, fiscal_year, project_id),
  lines:budget_request_lines(
    *,
    detail:budget_details!budget_request_lines_budget_detail_id_fkey(id, seq, category)
  )
` as const;

/** All budget requests attached to a budget, newest first. */
export const listBudgetRequestsByBudget = cache(
  async (budgetId: string): Promise<BudgetRequestWithMeta[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("budget_requests")
      .select(REQUEST_WITH_META_SELECT)
      .eq("budget_id", budgetId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as BudgetRequestWithMeta[];
  },
);

/** All pending budget requests in the tenant — approver inbox. */
export const listPendingBudgetRequests = cache(
  async (opts?: {
    status?: BudgetRequestStatus[];
    limit?: number;
  }): Promise<BudgetRequestWithMeta[]> => {
    const supabase = await createClient();
    const statuses =
      opts?.status && opts.status.length > 0
        ? opts.status
        : (BR_PENDING_STATUSES as readonly BudgetRequestStatus[]);
    const { data, error } = await supabase
      .from("budget_requests")
      .select(REQUEST_WITH_META_SELECT)
      .in("status", statuses as BudgetRequestStatus[])
      .order("created_at", { ascending: true })
      .limit(opts?.limit ?? 100);
    if (error) throw error;
    return (data ?? []) as unknown as BudgetRequestWithMeta[];
  },
);

/** Single budget request with lines + approval log timeline. */
export const getBudgetRequestWithLogs = cache(
  async (id: string): Promise<BudgetRequestWithLogs | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("budget_requests")
      .select(REQUEST_WITH_META_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const { data: logs, error: logsError } = await supabase
      .from("budget_request_approval_logs")
      .select(
        `
          *,
          actor:employees!budget_request_approval_logs_actor_employee_id_fkey(id, full_name)
        `,
      )
      .eq("budget_request_id", id)
      .order("created_at", { ascending: true });
    if (logsError) throw logsError;

    return {
      ...(data as unknown as BudgetRequestWithMeta),
      logs: (logs ?? []) as unknown as BudgetRequestWithLogs["logs"],
    };
  },
);

/** KPI count — number of budget requests currently pending in the tenant. */
export const countPendingBudgetRequests = cache(
  async (): Promise<number> => {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("budget_requests")
      .select("id", { count: "exact", head: true })
      .in("status", BR_PENDING_STATUSES as BudgetRequestStatus[]);
    if (error) throw error;
    return count ?? 0;
  },
);
