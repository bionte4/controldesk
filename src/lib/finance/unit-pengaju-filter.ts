/**
 * Shared filtering logic for the `unit_pengaju` dropdown across
 * Field-Ops CA, General CA, and Budget forms (migration 0087).
 *
 * The filter is intentionally a pure function so both server actions
 * and client components can call it without any React coupling.
 * Client forms wrap the call in `React.useMemo`; server actions use
 * `isUnitAllowedForProject()` from `src/lib/data/project-allowed-units.ts`
 * as the authoritative gate (this file is UI-only).
 *
 * Contract:
 *   - projectId undefined / not in the whitelist map → allow every
 *     unit in `allUnitOptions` (backward-compat: projects predating
 *     the whitelist keep working).
 *   - whitelist present + non-empty → narrow to the intersection.
 *   - whitelist present + EMPTY → still return the full list. An
 *     explicit empty whitelist ("no units allowed") is a policy
 *     decision the app treats as "misconfigured", not "block all".
 *     Server-side validation is still the source of truth for
 *     rejection; the UI stays permissive to avoid trapping a user
 *     with zero options.
 */

export type UnitOption = { id: string; label: string };

export function filterUnitOptions(input: {
  projectId?: string | null;
  allUnitOptions: readonly UnitOption[];
  allowedUnitsByProject: Record<string, string[]>;
}): { unitOptions: UnitOption[]; unitFiltered: boolean } {
  const { projectId, allUnitOptions, allowedUnitsByProject } = input;
  const whitelist = projectId ? allowedUnitsByProject[projectId] : undefined;
  if (!whitelist || whitelist.length === 0) {
    return {
      unitOptions: [...allUnitOptions],
      unitFiltered: false,
    };
  }
  const whitelistSet = new Set(whitelist);
  return {
    unitOptions: allUnitOptions.filter((opt) => whitelistSet.has(opt.label)),
    unitFiltered: true,
  };
}
