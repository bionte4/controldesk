import { describe, expect, it } from "vitest";

import {
  approveHrRequestSchema,
  cancelHrRequestSchema,
  rejectHrRequestSchema,
  submitHrRequestSchema,
} from "./hris";

const uuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const start = "2026-01-10T09:00:00.000Z";
const end = "2026-01-12T17:00:00.000Z";

describe("submitHrRequestSchema — LEAVE", () => {
  it("accepts a valid annual leave request", () => {
    const parsed = submitHrRequestSchema.safeParse({
      kind: "LEAVE",
      leave_type: "ANNUAL",
      start_at: start,
      end_at: end,
      reason: "Family vacation",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects LEAVE without a leave_type", () => {
    const parsed = submitHrRequestSchema.safeParse({
      kind: "LEAVE",
      start_at: start,
      end_at: end,
      reason: "Vacation",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.includes("leave_type"))).toBe(
        true,
      );
    }
  });

  it("rejects when end_at is not after start_at", () => {
    const parsed = submitHrRequestSchema.safeParse({
      kind: "LEAVE",
      leave_type: "ANNUAL",
      start_at: end,
      end_at: start,
      reason: "Bad range",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("submitHrRequestSchema — OVERTIME", () => {
  it("requires hours_estimate", () => {
    const parsed = submitHrRequestSchema.safeParse({
      kind: "OVERTIME",
      start_at: start,
      end_at: end,
      reason: "Deploy hotfix",
    });
    expect(parsed.success).toBe(false);
  });

  it("caps hours at 24", () => {
    const parsed = submitHrRequestSchema.safeParse({
      kind: "OVERTIME",
      start_at: start,
      end_at: end,
      hours_estimate: 30,
      reason: "Overnight incident",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a valid overtime request", () => {
    const parsed = submitHrRequestSchema.safeParse({
      kind: "OVERTIME",
      start_at: start,
      end_at: end,
      hours_estimate: 5,
      reason: "Client incident",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("submitHrRequestSchema — SICK", () => {
  it("requires a doctor's note (attachment_url)", () => {
    const parsed = submitHrRequestSchema.safeParse({
      kind: "SICK",
      start_at: start,
      end_at: end,
      reason: "Fever",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a sick request with a note URL", () => {
    const parsed = submitHrRequestSchema.safeParse({
      kind: "SICK",
      start_at: start,
      end_at: end,
      reason: "Fever",
      attachment_url: "https://example.com/note.pdf",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("HR approval / reject / cancel schemas", () => {
  it("approve accepts id + optional comment", () => {
    expect(approveHrRequestSchema.safeParse({ id: uuid }).success).toBe(true);
    expect(
      approveHrRequestSchema.safeParse({ id: uuid, comment: "ok" }).success,
    ).toBe(true);
  });

  it("reject requires a reason", () => {
    expect(rejectHrRequestSchema.safeParse({ id: uuid }).success).toBe(false);
    expect(
      rejectHrRequestSchema.safeParse({ id: uuid, reason: "  " }).success,
    ).toBe(false);
    expect(
      rejectHrRequestSchema.safeParse({ id: uuid, reason: "Not enough leave" })
        .success,
    ).toBe(true);
  });

  it("cancel accepts optional reason", () => {
    expect(cancelHrRequestSchema.safeParse({ id: uuid }).success).toBe(true);
  });
});
