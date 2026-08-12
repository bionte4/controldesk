/**
 * Unit tests for the approval-thresholds Zod schema (Option B).
 *
 * The schema is the sole boundary between the Admin UI form and the
 * Server Action — it must:
 *   1. Coerce numeric strings + `null` correctly (form fields carry
 *      strings by default; blank → NULL means "fall back to global
 *      default in `mergeThresholds()`").
 *   2. Reject negative numbers + non-integer settlement-SLA values.
 *   3. Enforce the DB-side ordered CHECK constraint at the app layer
 *      so users see the failure before the RPC roundtrip.
 */

import { describe, expect, it } from "vitest";

import {
  resetApprovalThresholdSchema,
  upsertApprovalThresholdSchema,
} from "./approval-thresholds";

describe("upsertApprovalThresholdSchema — value coercion", () => {
  it("coerces numeric strings to integers", () => {
    const parsed = upsertApprovalThresholdSchema.parse({
      kind: "EXPENSE",
      pm_threshold: "5000000",
      director_threshold: "50000000",
    });
    expect(parsed.pm_threshold).toBe(5_000_000);
    expect(parsed.director_threshold).toBe(50_000_000);
  });

  it("passes through native numbers unchanged", () => {
    const parsed = upsertApprovalThresholdSchema.parse({
      kind: "BUDGET",
      director_threshold: 42_000_000,
    });
    expect(parsed.director_threshold).toBe(42_000_000);
  });

  it("blank string maps to null (clear override → use global default)", () => {
    const parsed = upsertApprovalThresholdSchema.parse({
      kind: "EXPENSE",
      pm_threshold: "",
      director_threshold: 50_000_000,
    });
    expect(parsed.pm_threshold).toBeNull();
    expect(parsed.director_threshold).toBe(50_000_000);
  });

  it("explicit null is accepted (form control might send null directly)", () => {
    const parsed = upsertApprovalThresholdSchema.parse({
      kind: "EXPENSE",
      pm_threshold: null,
      director_threshold: null,
    });
    expect(parsed.pm_threshold).toBeNull();
    expect(parsed.director_threshold).toBeNull();
  });

  it("rounds fractional IDR to integer (guards against 1.5 rp bugs)", () => {
    const parsed = upsertApprovalThresholdSchema.parse({
      kind: "EXPENSE",
      pm_threshold: 5_000_000.7,
    });
    expect(parsed.pm_threshold).toBe(5_000_001);
  });
});

describe("upsertApprovalThresholdSchema — rejection cases", () => {
  it("rejects negative IDR", () => {
    const r = upsertApprovalThresholdSchema.safeParse({
      kind: "EXPENSE",
      pm_threshold: -1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-finite numbers", () => {
    const r = upsertApprovalThresholdSchema.safeParse({
      kind: "EXPENSE",
      pm_threshold: "not-a-number",
    });
    expect(r.success).toBe(false);
  });

  it("rejects fractional settlement_sla_days (must be whole day)", () => {
    const r = upsertApprovalThresholdSchema.safeParse({
      kind: "CASH_ADVANCE_FIELD_OPS",
      settlement_sla_days: 5.5,
    });
    expect(r.success).toBe(false);
  });

  it("rejects settlement_sla_days below 1 or above 365", () => {
    for (const bad of [0, -1, 366]) {
      const r = upsertApprovalThresholdSchema.safeParse({
        kind: "CASH_ADVANCE_FIELD_OPS",
        settlement_sla_days: bad,
      });
      expect(r.success, `sla=${bad} should fail`).toBe(false);
    }
  });

  it("rejects unknown kinds (guards against typos + attacker enum expansion)", () => {
    const r = upsertApprovalThresholdSchema.safeParse({
      kind: "UNKNOWN",
      pm_threshold: 1,
    });
    expect(r.success).toBe(false);
  });
});

describe("upsertApprovalThresholdSchema — ordered CHECK enforcement", () => {
  // Mirrors `approval_thresholds_ordered_ck` from migration 0024. The UI
  // must fail-fast so the admin sees the violation on submit instead of
  // getting a Postgres error 200ms later.

  it("rejects PM > Director", () => {
    const r = upsertApprovalThresholdSchema.safeParse({
      kind: "EXPENSE",
      pm_threshold: 60_000_000,
      director_threshold: 50_000_000,
    });
    expect(r.success).toBe(false);
  });

  it("rejects Supervisor > PM", () => {
    const r = upsertApprovalThresholdSchema.safeParse({
      kind: "CASH_ADVANCE_FIELD_OPS",
      supervisor_threshold: 10_000_000,
      pm_threshold: 5_000_000,
    });
    expect(r.success).toBe(false);
  });

  it("rejects PM > OM (Field Ops-specific escalation)", () => {
    const r = upsertApprovalThresholdSchema.safeParse({
      kind: "CASH_ADVANCE_FIELD_OPS",
      pm_threshold: 30_000_000,
      om_threshold: 20_000_000,
    });
    expect(r.success).toBe(false);
  });

  it("rejects OM > Director", () => {
    const r = upsertApprovalThresholdSchema.safeParse({
      kind: "CASH_ADVANCE_FIELD_OPS",
      om_threshold: 60_000_000,
      director_threshold: 50_000_000,
    });
    expect(r.success).toBe(false);
  });

  it("accepts an ascending ladder", () => {
    const r = upsertApprovalThresholdSchema.safeParse({
      kind: "CASH_ADVANCE_FIELD_OPS",
      pm_threshold: 5_000_000,
      om_threshold: 20_000_000,
      director_threshold: 50_000_000,
    });
    expect(r.success).toBe(true);
  });

  it("skips ordering guard when a rung is null (partial override is legal)", () => {
    // If only PM is set and OM/Director are null, the constraint only
    // checks defined pairs — the DB CHECK behaves the same way.
    const r = upsertApprovalThresholdSchema.safeParse({
      kind: "EXPENSE",
      pm_threshold: 5_000_000,
    });
    expect(r.success).toBe(true);
  });
});

describe("resetApprovalThresholdSchema", () => {
  it("requires a valid kind", () => {
    expect(
      resetApprovalThresholdSchema.safeParse({ kind: "EXPENSE" }).success,
    ).toBe(true);
    expect(
      resetApprovalThresholdSchema.safeParse({ kind: "NOT_A_KIND" }).success,
    ).toBe(false);
    expect(
      resetApprovalThresholdSchema.safeParse({}).success,
    ).toBe(false);
  });
});
