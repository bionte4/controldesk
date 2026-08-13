import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

/**
 * Per-project `unit_pengaju` whitelist for Field-Ops Cash Advance
 * forms — see migration `0086_project_allowed_units.sql`.
 *
 * The Field-Ops CA form calls `loadAllowedUnitsForProjects()` once per
 * request with the list of projects the caller can see. Empty result
 * for a project ID means "no whitelist configured → fall back to every
 * active tenant lookup". The form uses this map to filter the
 * Unit-Pengaju dropdown as soon as a project is selected.
 *
 * All queries here are tenant-scoped through Supabase RLS; the caller
 * only ever sees rows in their own tenant.
 */

/**
 * Batch-fetch allowed units for every project ID in one round-trip.
 * Returns a Map keyed by project ID; a project with no mapping row
 * simply does not appear in the map (callers treat missing key as
 * "no whitelist → allow everything").
 *
 * Memoised for the lifetime of the request via `React.cache()` so the
 * Field-Ops form loader and any downstream server-action validator
 * can call it independently without a second query.
 */
export const loadAllowedUnitsForProjects = cache(
  async (projectIds: readonly string[]): Promise<Map<string, string[]>> => {
    // Never call `.in("col", [])` — supabase-js drops an empty array
    // and returns EVERY row (documented footgun). Short-circuit here.
    if (projectIds.length === 0) return new Map();

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("project_allowed_units")
      .select("project_id, unit_label")
      .in("project_id", projectIds);

    if (error || !data) return new Map();

    const map = new Map<string, string[]>();
    for (const row of data) {
      const existing = map.get(row.project_id) ?? [];
      existing.push(row.unit_label);
      map.set(row.project_id, existing);
    }
    // Sort each bucket alphabetically so the UI renders a stable order
    // even if the DB returns rows in insertion order.
    for (const [key, list] of map) {
      map.set(
        key,
        [...list].sort((a, b) => a.localeCompare(b, "id-ID")),
      );
    }
    return map;
  },
);

/**
 * Convenience wrapper: same shape as `loadAllowedUnitsForProjects`
 * but keyed for a single project. Returns `null` when no whitelist
 * row exists, or an array (possibly empty after a user removed every
 * unit) when the project has been explicitly configured.
 *
 * The distinction between `null` and `[]` matters for validation:
 *   - `null`  → project has no policy → any active tenant unit is fine
 *   - `[]`    → project explicitly forbids Field-Ops CA (no valid unit)
 *
 * Callers that only need "is this unit allowed?" should prefer
 * `isUnitAllowedForProject()` below.
 */
export async function loadAllowedUnitsForProject(
  projectId: string,
): Promise<string[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_allowed_units")
    .select("unit_label")
    .eq("project_id", projectId);

  if (error) return null;
  if (!data || data.length === 0) return null;
  return data
    .map((r) => r.unit_label)
    .sort((a, b) => a.localeCompare(b, "id-ID"));
}

/**
 * Check whether a given `unit_pengaju` label is permitted for the
 * project. `null` from the loader (no whitelist configured) is
 * treated as "allow anything".
 *
 * Server actions call this before persisting a Field-Ops CA to
 * guarantee the client hasn't bypassed the dropdown filter (a hostile
 * client could POST any string).
 */
export async function isUnitAllowedForProject(
  projectId: string,
  unitLabel: string,
): Promise<boolean> {
  const whitelist = await loadAllowedUnitsForProject(projectId);
  if (whitelist === null) return true;
  return whitelist.includes(unitLabel);
}
