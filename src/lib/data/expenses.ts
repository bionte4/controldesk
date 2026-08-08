import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { parseMoneyFromDb } from "@/lib/format/money";
import type { BudgetStatus, ExpenseStatus, Tables } from "@/types/database";

/**
 * Data loaders for the Expenses module (rules §17.4).
 *
 * All queries are RSC-safe and rely on Supabase RLS for tenant scoping.
 * Wrapped in `React.cache()` to dedupe within a single request.
 */

// ---------------------------------------------------------------------------
// Budget lines (MA) eligible for a given project. Sourced from the
// `v_project_budget_lines` view (see migration 0044).
// ---------------------------------------------------------------------------

export type BudgetLineOption = {
  id: string;
  code: string | null;
  seq: number;
  category: string;
  description: string | null;
  budget_status: BudgetStatus;
  fiscal_year: number;
  planned_amount: number;
  remaining_amount: number;
  label: string;
};

/**
 * Statuses of the parent `budgets` header considered "usable" for expense
 * submission. Mockup copy says: "Only budget lines on an approved (or
 * draft/submitted) budget for the project are shown."
 */
const ELIGIBLE_BUDGET_STATUSES: readonly BudgetStatus[] = [
  "DRAFT",
  "PENDING_FINANCE",
  "PENDING_DIRECTOR",
  "APPROVED",
];

export const loadBudgetLinesForProject = cache(
  async (projectId: string): Promise<BudgetLineOption[]> => {
    if (!projectId) return [];
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("v_project_budget_lines")
      .select(
        "budget_detail_id, code, seq, category, description, budget_status, fiscal_year, planned_amount, remaining_amount",
      )
      .eq("project_id", projectId)
      .in("budget_status", [...ELIGIBLE_BUDGET_STATUSES])
      .order("fiscal_year", { ascending: false })
      .order("seq", { ascending: true });

    if (error || !data) return [];

    return data.map((row) => {
      const codePart = row.code ?? `#${row.seq}`;
      const catPart = row.category ?? "";
      const yearPart = row.fiscal_year ? ` · FY${row.fiscal_year}` : "";
      return {
        id: row.budget_detail_id as string,
        code: row.code,
        seq: row.seq as number,
        category: row.category as string,
        description: row.description,
        budget_status: row.budget_status as BudgetStatus,
        fiscal_year: row.fiscal_year as number,
        planned_amount: Number(parseMoneyFromDb(row.planned_amount)),
        remaining_amount: Number(parseMoneyFromDb(row.remaining_amount)),
        label: `${codePart} · ${catPart}${yearPart}`,
      };
    });
  },
);

// ---------------------------------------------------------------------------
// Expenses list for the current tenant (RLS-scoped).
// ---------------------------------------------------------------------------

export type ExpenseListRow = Pick<
  Tables<"project_expenses">,
  | "id"
  | "amount"
  | "category"
  | "description"
  | "status"
  | "incurred_on"
  | "created_at"
  | "payment_method"
  | "submitter_employee_id"
> & {
  project_code: string;
  project_name: string;
};

export type ExpenseListFilter = {
  status?: ExpenseStatus | "ALL";
  limit?: number;
};

export const loadExpenses = cache(
  async (filter: ExpenseListFilter = {}): Promise<ExpenseListRow[]> => {
    const supabase = await createClient();
    const limit = filter.limit ?? 200;

    let query = supabase
      .from("project_expenses")
      .select(
        "id, amount, category, description, status, incurred_on, created_at, payment_method, submitter_employee_id, projects(code, name)",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (filter.status && filter.status !== "ALL") {
      query = query.eq("status", filter.status);
    }

    const { data, error } = await query;
    if (error || !data) return [];

    return data.map((row) => {
      const proj = row.projects as unknown as {
        code: string;
        name: string;
      } | null;
      return {
        id: row.id,
        amount: row.amount,
        category: row.category,
        description: row.description,
        status: row.status as ExpenseStatus,
        incurred_on: row.incurred_on,
        created_at: row.created_at,
        payment_method: row.payment_method,
        submitter_employee_id: row.submitter_employee_id,
        project_code: proj?.code ?? "—",
        project_name: proj?.name ?? "—",
      };
    });
  },
);
