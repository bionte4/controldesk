import { describe, expect, it } from "vitest";

import {
  REPORT_KINDS,
  REPORT_REGISTRY,
  isValidReportKind,
  reportsForRole,
} from "./registry";

describe("REPORT_REGISTRY", () => {
  it("has an entry for every kind in REPORT_KINDS (no missing metadata)", () => {
    for (const kind of REPORT_KINDS) {
      expect(REPORT_REGISTRY[kind]).toBeDefined();
      expect(REPORT_REGISTRY[kind].kind).toBe(kind);
    }
  });

  it("assigns at least one allowed role to every report (no orphans)", () => {
    for (const kind of REPORT_KINDS) {
      expect(REPORT_REGISTRY[kind].allowedRoles.length).toBeGreaterThan(0);
    }
  });

  it("never exposes reports to EMPLOYEE (only PM+ tiers per rules §15b)", () => {
    for (const kind of REPORT_KINDS) {
      expect(REPORT_REGISTRY[kind].allowedRoles).not.toContain("EMPLOYEE");
    }
  });
});

describe("reportsForRole", () => {
  it("returns an empty array for EMPLOYEE (no report cards for staff)", () => {
    expect(reportsForRole("EMPLOYEE")).toHaveLength(0);
  });

  it("returns all reports for TENANT_ADMIN (admin sees everything)", () => {
    // Admins see every kind — mirrors §15b's tier hierarchy.
    const list = reportsForRole("TENANT_ADMIN").map((r) => r.kind);
    for (const kind of REPORT_KINDS) {
      expect(list).toContain(kind);
    }
  });

  it("hides Petty Cash Statement from PROJECT_MANAGER (custodian/finance-only per §10)", () => {
    const list = reportsForRole("PROJECT_MANAGER").map((r) => r.kind);
    expect(list).not.toContain("petty-cash-statement");
  });

  it("only shows Petty Cash Statement to PETTY_CASH_CUSTODIAN (their sole report)", () => {
    const list = reportsForRole("PETTY_CASH_CUSTODIAN").map((r) => r.kind);
    // Custodian sees petty-cash only; finance-only reports are hidden.
    expect(list).toContain("petty-cash-statement");
    expect(list).not.toContain("expense-register");
    expect(list).not.toContain("project-portfolio");
  });
});

describe("isValidReportKind", () => {
  it("accepts every registered kind", () => {
    for (const kind of REPORT_KINDS) {
      expect(isValidReportKind(kind)).toBe(true);
    }
  });

  it("rejects unknown kinds so the API 404s cleanly", () => {
    expect(isValidReportKind("random-string")).toBe(false);
    expect(isValidReportKind("")).toBe(false);
    expect(isValidReportKind("../etc/passwd")).toBe(false);
  });
});
