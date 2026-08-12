import { describe, expect, it } from "vitest";

import {
  RETENTION_POLICIES,
  getRetentionPolicy,
  type RetentionTarget,
} from "./config";

describe("retention config", () => {
  it("keeps audit logs for 7 years", () => {
    const policy = getRetentionPolicy("security_audit_logs");
    expect(policy.hard_purge_after_days).toBe(365 * 7);
  });

  it("keeps financial receipts + parents for 10 years", () => {
    for (const target of [
      "cash_advance_settlements_receipts",
      "petty_cash_vouchers_receipts",
      "project_expenses",
      "cash_advances",
    ] as RetentionTarget[]) {
      expect(RETENTION_POLICIES[target].hard_purge_after_days).toBe(365 * 10);
    }
  });

  it("financial parents are archive-eligible at year 2", () => {
    for (const target of [
      "project_expenses",
      "cash_advances",
    ] as RetentionTarget[]) {
      expect(RETENTION_POLICIES[target].archive_after_days).toBe(365 * 2);
    }
  });

  it("purges HR requests after 5 years", () => {
    expect(RETENTION_POLICIES.hr_requests.hard_purge_after_days).toBe(365 * 5);
  });

  it("all policies expose a note", () => {
    for (const target of Object.keys(RETENTION_POLICIES) as RetentionTarget[]) {
      expect(RETENTION_POLICIES[target].note).toBeTruthy();
    }
  });

  it("archive window never exceeds purge window", () => {
    for (const p of Object.values(RETENTION_POLICIES)) {
      if (p.archive_after_days !== null && p.hard_purge_after_days !== null) {
        expect(p.archive_after_days).toBeLessThanOrEqual(p.hard_purge_after_days);
      }
    }
  });
});
