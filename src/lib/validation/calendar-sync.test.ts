import { describe, expect, it } from "vitest";

import {
  retryEventSchema,
  runReconciliationSchema,
  skipEventSchema,
} from "./calendar-sync";

describe("calendar-sync validation schemas", () => {
  describe("retryEventSchema", () => {
    it("accepts a valid UUID", () => {
      const parsed = retryEventSchema.safeParse({
        eventId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(parsed.success).toBe(true);
    });
    it("rejects a non-UUID event id", () => {
      const parsed = retryEventSchema.safeParse({ eventId: "not-a-uuid" });
      expect(parsed.success).toBe(false);
    });
    it("rejects a missing event id", () => {
      const parsed = retryEventSchema.safeParse({});
      expect(parsed.success).toBe(false);
    });
  });

  describe("skipEventSchema", () => {
    const validId = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    it("accepts a UUID + a 4-char reason", () => {
      const parsed = skipEventSchema.safeParse({
        eventId: validId,
        reason: "obsolete",
      });
      expect(parsed.success).toBe(true);
    });
    it("rejects a short reason (<4 chars)", () => {
      const parsed = skipEventSchema.safeParse({
        eventId: validId,
        reason: "no",
      });
      expect(parsed.success).toBe(false);
    });
    it("rejects an over-long reason (>500 chars)", () => {
      const parsed = skipEventSchema.safeParse({
        eventId: validId,
        reason: "a".repeat(501),
      });
      expect(parsed.success).toBe(false);
    });
    it("trims whitespace before applying length rules", () => {
      const parsed = skipEventSchema.safeParse({
        eventId: validId,
        reason: "   ok  ", // 2 chars after trim → should fail
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("runReconciliationSchema", () => {
    it("accepts an empty object", () => {
      const parsed = runReconciliationSchema.safeParse({});
      expect(parsed.success).toBe(true);
    });
    it("still passes when unknown keys are present (Zod default strips them)", () => {
      const parsed = runReconciliationSchema.safeParse({ extra: "field" });
      expect(parsed.success).toBe(true);
    });
  });
});
