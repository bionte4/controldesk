import { describe, expect, it } from "vitest";

import { resolveVisibilityFilter } from "@/lib/data/knowledge-articles";

/**
 * Fase 2c unit tests for the visibility ACL filter. Focus is on
 * the shape of the emitted PostgREST `.or()` clause because
 * that's the boundary the DB will honour — everything the app
 * sees passes through this string.
 *
 * We assert exact clause strings (rather than "contains"
 * substrings) so any accidental change to the operator or the
 * separator hierarchy triggers the test — the resulting query
 * would silently over- or under-fetch otherwise.
 */
describe("resolveVisibilityFilter", () => {
  const EMP_ID = "00000000-0000-0000-0000-000000000001";
  const PROJ_A = "00000000-0000-0000-0000-000000000002";
  const PROJ_B = "00000000-0000-0000-0000-000000000003";

  it("returns null for admin callers (unrestricted)", () => {
    const filter = resolveVisibilityFilter({
      employeeId: EMP_ID,
      role: "TENANT_ADMIN",
      activeProjectIds: [],
      isAdmin: true,
    });
    expect(filter).toBeNull();
  });

  it("plain EMPLOYEE with no projects: TENANT_WIDE + author + role fold", () => {
    const filter = resolveVisibilityFilter({
      employeeId: EMP_ID,
      role: "EMPLOYEE",
      activeProjectIds: [],
      isAdmin: false,
    });
    // Canonical fold of EMPLOYEE is EMPLOYEE — same value, so
    // roleSet dedupes to a single entry.
    expect(filter).toBe(
      [
        "visibility.eq.TENANT_WIDE",
        `author_employee_id.eq.${EMP_ID}`,
        "and(visibility.eq.ROLE_GATED,visibility_roles.ov.{EMPLOYEE})",
      ].join(","),
    );
  });

  it("legacy PROJECT_MANAGER role adds its canonical fold PM", () => {
    const filter = resolveVisibilityFilter({
      employeeId: EMP_ID,
      role: "PROJECT_MANAGER",
      activeProjectIds: [],
      isAdmin: false,
    });
    // Order is `[caller, canonical]` so PROJECT_MANAGER comes
    // first. Test locks that order — swapping it silently would
    // still pass the DB but drift the audit expectations.
    expect(filter).toBe(
      [
        "visibility.eq.TENANT_WIDE",
        `author_employee_id.eq.${EMP_ID}`,
        "and(visibility.eq.ROLE_GATED,visibility_roles.ov.{PROJECT_MANAGER,PM})",
      ].join(","),
    );
  });

  it("canonical PM role: fold is self, roleSet dedupes to single entry", () => {
    const filter = resolveVisibilityFilter({
      employeeId: EMP_ID,
      role: "PM",
      activeProjectIds: [],
      isAdmin: false,
    });
    expect(filter).toBe(
      [
        "visibility.eq.TENANT_WIDE",
        `author_employee_id.eq.${EMP_ID}`,
        "and(visibility.eq.ROLE_GATED,visibility_roles.ov.{PM})",
      ].join(","),
    );
  });

  it("with active projects, appends PROJECT_SCOPED clause with .in list", () => {
    const filter = resolveVisibilityFilter({
      employeeId: EMP_ID,
      role: "EMPLOYEE",
      activeProjectIds: [PROJ_A, PROJ_B],
      isAdmin: false,
    });
    expect(filter).toBe(
      [
        "visibility.eq.TENANT_WIDE",
        `author_employee_id.eq.${EMP_ID}`,
        "and(visibility.eq.ROLE_GATED,visibility_roles.ov.{EMPLOYEE})",
        `and(visibility.eq.PROJECT_SCOPED,visibility_project_id.in.(${PROJ_A},${PROJ_B}))`,
      ].join(","),
    );
  });

  it("no active projects: PROJECT_SCOPED clause is omitted entirely", () => {
    const filter = resolveVisibilityFilter({
      employeeId: EMP_ID,
      role: "EMPLOYEE",
      activeProjectIds: [],
      isAdmin: false,
    });
    // Whatever the exact filter, it MUST NOT include a
    // `.in.()` clause — PostgREST rejects `.in.()` with an
    // empty parenthesised list, which would break the whole
    // query rather than "return no PROJECT_SCOPED rows".
    expect(filter).not.toContain("visibility_project_id.in");
  });

  it("PROJECT_SCOPED clause is only added when there is ≥1 project id", () => {
    const withOne = resolveVisibilityFilter({
      employeeId: EMP_ID,
      role: "EMPLOYEE",
      activeProjectIds: [PROJ_A],
      isAdmin: false,
    });
    expect(withOne).toContain(
      `and(visibility.eq.PROJECT_SCOPED,visibility_project_id.in.(${PROJ_A}))`,
    );
  });

  it("canonical FINANCE with legacy fold: fold produces FINANCE self-only", () => {
    // FINANCE is canonical passthrough (folds to itself),
    // NOT to LEAD_FINANCE. Documenting the asymmetry — a
    // canonical-only caller only matches canonical-stored
    // arrays, so authors that store `["LEAD_FINANCE"]` are
    // opting into legacy-only readership.
    const filter = resolveVisibilityFilter({
      employeeId: EMP_ID,
      role: "FINANCE",
      activeProjectIds: [],
      isAdmin: false,
    });
    expect(filter).toContain("visibility_roles.ov.{FINANCE}");
    expect(filter).not.toContain("LEAD_FINANCE");
  });
});
