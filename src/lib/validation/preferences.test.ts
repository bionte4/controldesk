import { describe, expect, it } from "vitest";

import {
  restoreDefaultsSchema,
  updatePreferencesSchema,
} from "./preferences";

describe("validation/preferences.updatePreferencesSchema", () => {
  it("accepts a well-formed toggles array", () => {
    const result = updatePreferencesSchema.safeParse({
      toggles: [
        { category: "APPROVALS", channel: "EMAIL", enabled: false },
        { category: "BUDGETS", channel: "TELEGRAM", enabled: true },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty toggles array (no-op save)", () => {
    const result = updatePreferencesSchema.safeParse({ toggles: [] });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown category", () => {
    const result = updatePreferencesSchema.safeParse({
      toggles: [
        { category: "NOT_A_CATEGORY", channel: "EMAIL", enabled: true },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown channel", () => {
    const result = updatePreferencesSchema.safeParse({
      toggles: [
        { category: "APPROVALS", channel: "PUSH_APPLE", enabled: true },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects when `enabled` is not a boolean", () => {
    const result = updatePreferencesSchema.safeParse({
      toggles: [{ category: "APPROVALS", channel: "EMAIL", enabled: "yes" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects payloads exceeding the maximum grid size", () => {
    // 7 categories × 5 channels = 35 legitimate max (PUSH added in
    // migration 0092). 36 must fail.
    const toggles = Array.from({ length: 36 }, () => ({
      category: "APPROVALS" as const,
      channel: "EMAIL" as const,
      enabled: true,
    }));
    const result = updatePreferencesSchema.safeParse({ toggles });
    expect(result.success).toBe(false);
  });
});

describe("validation/preferences.restoreDefaultsSchema", () => {
  it("accepts { confirm: true }", () => {
    const result = restoreDefaultsSchema.safeParse({ confirm: true });
    expect(result.success).toBe(true);
  });

  it("rejects { confirm: false }", () => {
    const result = restoreDefaultsSchema.safeParse({ confirm: false });
    expect(result.success).toBe(false);
  });

  it("rejects an empty payload", () => {
    const result = restoreDefaultsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects extra keys under strict mode", () => {
    const result = restoreDefaultsSchema.safeParse({
      confirm: true,
      extra: "field",
    });
    expect(result.success).toBe(false);
  });
});
