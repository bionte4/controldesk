import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { CoaAccountType, CoaNormalSide } from "@/types/database";

/**
 * Data loaders for the Chart of Accounts master table (migration 0055).
 *
 *   - `loadPostableAccounts()`    — dropdown list for budget-line / expense /
 *                                    CA / petty-cash forms. Filtered to
 *                                    `is_active=true` AND `is_postable=true`.
 *   - `loadCoaTree()`             — hierarchical tree for the admin settings
 *                                    page. Returns roots + resolved children.
 *   - `loadCoaFlatForAdmin()`     — flat list including inactive rows, used
 *                                    by the admin toggle table.
 *
 * All loaders rely on `chart_of_accounts_tenant_read` RLS (rules §16) to
 * scope by tenant. Wrapped in React `cache()` so repeat calls per request
 * dedupe automatically.
 */

export type CoaAccount = {
  id: string;
  code: string;
  name: string;
  account_type: CoaAccountType;
  normal_side: CoaNormalSide;
  parent_id: string | null;
  is_postable: boolean;
  is_active: boolean;
  description: string | null;
};

export type CoaAccountWithChildren = CoaAccount & {
  children: CoaAccountWithChildren[];
  depth: number;
};

/**
 * Postable + active accounts, sorted by numeric code. This is the list
 * fed into every "pick an account" dropdown (budget lines, expenses, CA
 * lines, petty-cash entries). Kept tiny (~40 rows for a fresh tenant),
 * so it's safe to load fully — no server-side search is needed.
 */
export const loadPostableAccounts = cache(async (): Promise<CoaAccount[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chart_of_accounts")
    .select(
      "id, code, name, account_type, normal_side, parent_id, is_postable, is_active, description",
    )
    .eq("is_active", true)
    .eq("is_postable", true)
    .order("code", { ascending: true });
  if (error || !data) return [];
  return data;
});

/**
 * Full hierarchical tree of every account (active + inactive) plus their
 * pre-resolved children. Depth is precomputed for indent styling. Roots
 * come first (order by code). Used by the `/settings/coa` admin page.
 */
export const loadCoaTree = cache(async (): Promise<CoaAccountWithChildren[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chart_of_accounts")
    .select(
      "id, code, name, account_type, normal_side, parent_id, is_postable, is_active, description",
    )
    .order("code", { ascending: true });
  if (error || !data) return [];

  // Map every id → mutable node; wire up children lazily.
  const byId = new Map<string, CoaAccountWithChildren>();
  for (const row of data) {
    byId.set(row.id, { ...row, children: [], depth: 0 });
  }

  const roots: CoaAccountWithChildren[] = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Second pass: assign depth. Iterative to survive very deep trees
  // without a stack overflow (unlikely, but keeps us honest).
  const stack: Array<[CoaAccountWithChildren, number]> = roots.map((r) => [r, 0]);
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    node.depth = depth;
    for (const child of node.children) stack.push([child, depth + 1]);
  }

  return roots;
});

/**
 * Flat listing (all rows including inactive), sorted by code. Handy when
 * the admin page needs simple map lookups or CSV export.
 */
export const loadCoaFlatForAdmin = cache(async (): Promise<CoaAccount[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chart_of_accounts")
    .select(
      "id, code, name, account_type, normal_side, parent_id, is_postable, is_active, description",
    )
    .order("code", { ascending: true });
  if (error || !data) return [];
  return data;
});

/**
 * Server-side guard for every mutation that accepts a `coa_id`. Returns
 * `null` if the caller sent no CoA (allowed during Fase 2/3 rollout),
 * throws a caller-friendly `Error` if the row is missing / inactive /
 * not postable, and returns the id when the row is valid.
 *
 * Uses `createServerClient` (no argument) so RLS enforces tenant scope;
 * we deliberately do not pass a tenant id — that would just double-check
 * an invariant the DB already enforces.
 */
/**
 * Project-scoped CoA listing. Returns only the CoA accounts that are
 * actually referenced by an active / draft / submitted budget line
 * (`budget_details.coa_id`) for the supplied project. Deduped by CoA
 * with the referencing MA labels attached so the caller can render a
 * "5301 · Transport — MA: Perjalanan, BBM" style option label.
 *
 * Kept as a plain async function (not `cache()`) because callers pass
 * a runtime `projectId` — the React cache would keep one entry per
 * project which is fine, but not worth the ceremony when the query is
 * already a single round-trip.
 */
export type CoaAccountForProject = {
  id: string;
  code: string;
  name: string;
  /**
   * Denormalised MA labels for every `budget_details` row that maps to
   * this CoA within the project. Ordered by `budget_details.seq`.
   * Empty array only happens transiently while the join returns stale
   * rows — server actions still verify active+postable on submit.
   */
  ma_labels: string[];
};

export async function loadCoaForProject(
  projectId: string,
): Promise<CoaAccountForProject[]> {
  if (!projectId) return [];
  const supabase = await createClient();
  // The join goes budget_details → budgets (for project_id filter) →
  // chart_of_accounts (for active + postable + name). RLS handles
  // tenant scoping automatically.
  const { data, error } = await supabase
    .from("budget_details")
    .select(
      "seq, category, code, coa:coa_id(id, code, name, is_active, is_postable), budgets!inner(project_id)",
    )
    .eq("budgets.project_id", projectId)
    .not("coa_id", "is", null)
    .order("seq", { ascending: true });
  if (error || !data) return [];

  const byCoaId = new Map<string, CoaAccountForProject>();
  for (const row of data as unknown as Array<{
    seq: number;
    category: string;
    code: string | null;
    coa: {
      id: string;
      code: string;
      name: string;
      is_active: boolean;
      is_postable: boolean;
    } | null;
  }>) {
    const coa = row.coa;
    if (!coa || !coa.is_active || !coa.is_postable) continue;
    const maLabel = row.code ?? `#${row.seq} · ${row.category}`;
    if (!byCoaId.has(coa.id)) {
      byCoaId.set(coa.id, {
        id: coa.id,
        code: coa.code,
        name: coa.name,
        ma_labels: [maLabel],
      });
    } else {
      byCoaId.get(coa.id)!.ma_labels.push(maLabel);
    }
  }
  return Array.from(byCoaId.values()).sort((a, b) =>
    a.code.localeCompare(b.code),
  );
}

export async function assertPostableCoa(
  coaId: string | null | undefined,
): Promise<string | null> {
  if (!coaId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chart_of_accounts")
    .select("id, is_active, is_postable")
    .eq("id", coaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !data.is_active || !data.is_postable) {
    throw new Error(
      "Selected CoA account is not active or not postable. Ask your admin to update Settings › Chart of Accounts.",
    );
  }
  return data.id;
}
