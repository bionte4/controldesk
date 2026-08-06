import { describe, expect, it } from "vitest";

import {
  CA_PENDING_APPROVAL_STATUSES,
  CA_STATUS_APPROVER_ROLE,
} from "@/lib/cash-advance/state";
import { CANONICAL_CA_PENDING_STATUSES } from "@/lib/cash-advance/state-canonical";

import { mergedCaPendingForRole } from "./inbox";

describe("mergedCaPendingForRole", () => {
  it("TENANT_ADMIN sees every legacy pending status plus every canonical pending status", () => {
    const merged = mergedCaPendingForRole("TENANT_ADMIN");
    // Every legacy pending status is present.
    for (const s of CA_PENDING_APPROVAL_STATUSES) {
      expect(merged).toContain(s);
    }
    // Every canonical pending status is present.
    for (const s of CANONICAL_CA_PENDING_STATUSES) {
      expect(merged).toContain(s);
    }
    // No duplicates.
    expect(new Set(merged).size).toBe(merged.length);
  });

  it("PROJECT_MANAGER sees PENDING_L2_PROJECT_MANAGER (legacy) and PENDING_PM (canonical)", () => {
    const merged = mergedCaPendingForRole("PROJECT_MANAGER");
    expect(merged).toContain("PENDING_L2_PROJECT_MANAGER");
    expect(merged).toContain("PENDING_PM");
    expect(merged).not.toContain("PENDING_L2_5_FINANCE");
    expect(merged).not.toContain("PENDING_DIRECTOR");
  });

  it("LEAD_FINANCE sees PENDING_L2_5_FINANCE (legacy) and PENDING_FINANCE (canonical)", () => {
    const merged = mergedCaPendingForRole("LEAD_FINANCE");
    expect(merged).toContain("PENDING_L2_5_FINANCE");
    expect(merged).toContain("PENDING_FINANCE");
  });

  it("SUPERVISOR sees legacy PENDING_L1_SUPERVISOR and canonical PENDING_SUPERVISOR", () => {
    const merged = mergedCaPendingForRole("SUPERVISOR");
    expect(merged).toContain("PENDING_L1_SUPERVISOR");
    expect(merged).toContain("PENDING_SUPERVISOR");
  });

  it("canonical PM role sees canonical PENDING_PM (legacy filter is exact-match by legacy code)", () => {
    const merged = mergedCaPendingForRole("PM");
    expect(merged).toContain("PENDING_PM");
    // Legacy chain rows use `PROJECT_MANAGER` — a canonical `PM` employee
    // sees them ONLY via the canonical slot fold. The legacy filter is
    // exact-match by legacy code, so this branch is intentionally empty.
    expect(merged.filter((s) => s === "PENDING_L2_PROJECT_MANAGER")).toHaveLength(0);
  });

  it("employee role sees no pending CAs (they never approve)", () => {
    const merged = mergedCaPendingForRole("EMPLOYEE");
    expect(merged).toHaveLength(0);
  });

  it("legacy statuses are ordered before canonical statuses", () => {
    const merged = mergedCaPendingForRole("TENANT_ADMIN");
    const firstCanonicalIdx = merged.findIndex(
      (s) =>
        (CANONICAL_CA_PENDING_STATUSES as readonly string[]).includes(s) &&
        !(CA_PENDING_APPROVAL_STATUSES as readonly string[]).includes(s),
    );
    const lastLegacyIdx = merged.findLastIndex((s) =>
      (CA_PENDING_APPROVAL_STATUSES as readonly string[]).includes(s),
    );
    // If both are present, legacy must come before canonical.
    if (firstCanonicalIdx !== -1 && lastLegacyIdx !== -1) {
      expect(lastLegacyIdx).toBeLessThan(firstCanonicalIdx);
    }
  });

  it("every legacy status maps back to some role via CA_STATUS_APPROVER_ROLE", () => {
    for (const s of CA_PENDING_APPROVAL_STATUSES) {
      expect(CA_STATUS_APPROVER_ROLE[s]).toBeDefined();
    }
  });
});
