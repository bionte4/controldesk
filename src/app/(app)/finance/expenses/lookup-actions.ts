"use server";

import { z } from "zod";

import { requireCurrentEmployee } from "@/lib/auth/session";
import {
  loadBudgetLinesForProject,
  type BudgetLineOption,
} from "@/lib/data/expenses";
import {
  loadCoaForProject,
  type CoaAccountForProject,
} from "@/lib/data/coa";

/**
 * Client-callable lookups for the New Expense / New CA / New Field Ops
 * forms. Pure reads: no PDP, no audit — RLS on the underlying tables
 * scopes results to the caller's tenant.
 */

const projectIdSchema = z.object({ project_id: z.string().uuid() });

export async function fetchBudgetLinesForProject(input: {
  project_id: string;
}): Promise<{ ok: true; data: BudgetLineOption[] } | { ok: false; reason: string }> {
  const parsed = projectIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "Invalid project id." };
  }
  // Auth guard — must be an active employee.
  await requireCurrentEmployee();

  const lines = await loadBudgetLinesForProject(parsed.data.project_id);
  return { ok: true, data: lines };
}

/**
 * Return the deduped list of CoA accounts already coded on this
 * project's budget lines. Feeds the CoA dropdown in the New Expense /
 * New CA / New Field Ops sheets so users can only pick GL accounts
 * that Finance has actually pre-registered for the project.
 */
export async function fetchCoaForProject(input: {
  project_id: string;
}): Promise<
  | { ok: true; data: CoaAccountForProject[] }
  | { ok: false; reason: string }
> {
  const parsed = projectIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "Invalid project id." };
  }
  await requireCurrentEmployee();

  const options = await loadCoaForProject(parsed.data.project_id);
  return { ok: true, data: options };
}
