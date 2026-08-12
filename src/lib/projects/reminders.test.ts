import { describe, expect, it } from "vitest";

import {
  PROJECT_CONTRACT_EXPIRY_THRESHOLDS_DAYS,
  PROJECT_STATUSES_ELIGIBLE_FOR_EXPIRY_REMINDER,
  formatProjectExpiryReminder,
} from "./reminders";

describe("project contract-expiry reminder helpers", () => {
  it("declares thresholds in descending order (least urgent first)", () => {
    expect([...PROJECT_CONTRACT_EXPIRY_THRESHOLDS_DAYS]).toEqual([30, 14, 7, 3]);
  });

  it("skips COMPLETED / ARCHIVED — only in-flight statuses are eligible", () => {
    // Rationale: reminders should be actionable. If a project is already
    // marked COMPLETED, the contract wind-down is (or should be) done, and
    // reminders would be noise for the PM inbox.
    expect(PROJECT_STATUSES_ELIGIBLE_FOR_EXPIRY_REMINDER).not.toContain("COMPLETED");
    expect(PROJECT_STATUSES_ELIGIBLE_FOR_EXPIRY_REMINDER).not.toContain("ARCHIVED");
    expect(PROJECT_STATUSES_ELIGIBLE_FOR_EXPIRY_REMINDER).toContain("ACTIVE");
    expect(PROJECT_STATUSES_ELIGIBLE_FOR_EXPIRY_REMINDER).toContain("DRAFT");
  });

  it("uses 'besok' phrasing exclusively at 1 day (guards against 3-day copy leaking)", () => {
    const { title, body } = formatProjectExpiryReminder({
      projectName: "Migrasi Payroll",
      projectCode: "PRJ-2026-0012",
      daysUntilExpiry: 1,
      endDateIso: "2026-08-08",
    });
    expect(title).toContain("berakhir besok");
    expect(title).not.toContain("dalam 1 hari");
    expect(body).toContain("Migrasi Payroll");
    expect(body).toContain("2026-08-08");
  });

  it("uses 'dalam N hari' phrasing at every non-1 threshold", () => {
    for (const days of [3, 7, 14, 30]) {
      const { title } = formatProjectExpiryReminder({
        projectName: "Any",
        projectCode: "PRJ-X",
        daysUntilExpiry: days,
        endDateIso: "2026-01-01",
      });
      expect(title).toContain(`berakhir dalam ${days} hari`);
    }
  });

  it("prefers the auto-generated project number in the title when provided", () => {
    const { title } = formatProjectExpiryReminder({
      projectName: "MediCare Portal",
      projectCode: "PRJ-2026-0004",
      daysUntilExpiry: 7,
      endDateIso: "2026-08-14",
    });
    expect(title).toMatch(/^Kontrak proyek PRJ-2026-0004/);
  });
});
