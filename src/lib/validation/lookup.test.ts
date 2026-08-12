import { describe, expect, it } from "vitest";

import {
  LOOKUP_DOMAIN_VALUES,
  createLookupOptionSchema,
  deleteLookupOptionSchema,
  lookupDomainSchema,
  toggleLookupOptionActiveSchema,
  updateLookupOptionSchema,
} from "./lookup";

const VALID_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("lookupDomainSchema", () => {
  it("accepts every declared domain", () => {
    for (const domain of LOOKUP_DOMAIN_VALUES) {
      const parsed = lookupDomainSchema.safeParse(domain);
      expect(parsed.success).toBe(true);
    }
  });

  it("rejects an unknown domain (defensive against typos in callers)", () => {
    expect(lookupDomainSchema.safeParse("unit_pengelola").success).toBe(false);
    expect(lookupDomainSchema.safeParse("").success).toBe(false);
    expect(lookupDomainSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("createLookupOptionSchema", () => {
  it("accepts a minimal valid payload", () => {
    const parsed = createLookupOptionSchema.safeParse({
      domain: "unit_pengaju",
      code: "NOC-JKT",
      label: "NOC Jakarta",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Defaults kick in.
      expect(parsed.data.is_active).toBe(true);
      expect(parsed.data.description).toBeUndefined();
      expect(parsed.data.sort_order).toBeUndefined();
    }
  });

  it("accepts an explicit sort_order + inactive flag", () => {
    const parsed = createLookupOptionSchema.safeParse({
      domain: "area",
      code: "JABODETABEK",
      label: "Jabodetabek",
      sort_order: 10,
      is_active: false,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.sort_order).toBe(10);
      expect(parsed.data.is_active).toBe(false);
    }
  });

  it("rejects a lowercase code", () => {
    const parsed = createLookupOptionSchema.safeParse({
      domain: "area",
      code: "jabodetabek",
      label: "Jabodetabek",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/uppercase/i);
    }
  });

  it("rejects a code starting with a hyphen", () => {
    const parsed = createLookupOptionSchema.safeParse({
      domain: "area",
      code: "-JBD",
      label: "Jabodetabek",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a code with disallowed characters (spaces)", () => {
    const parsed = createLookupOptionSchema.safeParse({
      domain: "area",
      code: "NOC JKT",
      label: "NOC Jakarta",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a blank label", () => {
    const parsed = createLookupOptionSchema.safeParse({
      domain: "area",
      code: "JBD",
      label: "   ",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a code longer than 48 chars", () => {
    const parsed = createLookupOptionSchema.safeParse({
      domain: "area",
      code: "A".repeat(49),
      label: "Long code",
    });
    expect(parsed.success).toBe(false);
  });

  it("normalises an empty-string description to undefined", () => {
    const parsed = createLookupOptionSchema.safeParse({
      domain: "area",
      code: "JBD",
      label: "Jabodetabek",
      description: "   ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.description).toBeUndefined();
    }
  });

  it("rejects an unknown domain", () => {
    const parsed = createLookupOptionSchema.safeParse({
      domain: "unit_pengelola" as never,
      code: "X",
      label: "X",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a sort_order outside 0-9999", () => {
    for (const bad of [-1, 10_000, 3.14]) {
      const parsed = createLookupOptionSchema.safeParse({
        domain: "area",
        code: "JBD",
        label: "Jabodetabek",
        sort_order: bad,
      });
      expect(parsed.success).toBe(false);
    }
  });
});

describe("updateLookupOptionSchema", () => {
  it("requires an id", () => {
    const parsed = updateLookupOptionSchema.safeParse({
      code: "NOC-JKT",
      label: "NOC Jakarta",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a valid update payload", () => {
    const parsed = updateLookupOptionSchema.safeParse({
      id: VALID_UUID,
      code: "NOC-JKT",
      label: "NOC Jakarta (Grand Wijaya)",
    });
    expect(parsed.success).toBe(true);
  });

  it("does not include a domain field (domain is immutable)", () => {
    // Passing an extra domain field should be ignored, not rejected — Zod
    // objects are permissive by default; the test only asserts that
    // parsing succeeds without a domain and no domain leaks into `.data`.
    const parsed = updateLookupOptionSchema.safeParse({
      id: VALID_UUID,
      code: "NOC-JKT",
      label: "NOC Jakarta",
      domain: "unit_pengaju",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(
        (parsed.data as unknown as Record<string, unknown>).domain,
      ).toBeUndefined();
    }
  });
});

describe("toggleLookupOptionActiveSchema", () => {
  it("accepts { id, is_active }", () => {
    expect(
      toggleLookupOptionActiveSchema.safeParse({
        id: VALID_UUID,
        is_active: true,
      }).success,
    ).toBe(true);
    expect(
      toggleLookupOptionActiveSchema.safeParse({
        id: VALID_UUID,
        is_active: false,
      }).success,
    ).toBe(true);
  });

  it("requires is_active", () => {
    expect(
      toggleLookupOptionActiveSchema.safeParse({ id: VALID_UUID }).success,
    ).toBe(false);
  });

  it("requires a boolean is_active (not truthy string)", () => {
    expect(
      toggleLookupOptionActiveSchema.safeParse({
        id: VALID_UUID,
        is_active: "true",
      }).success,
    ).toBe(false);
  });
});

describe("deleteLookupOptionSchema", () => {
  it("accepts a valid id", () => {
    expect(
      deleteLookupOptionSchema.safeParse({ id: VALID_UUID }).success,
    ).toBe(true);
  });

  it("rejects a non-UUID id", () => {
    expect(
      deleteLookupOptionSchema.safeParse({ id: "not-a-uuid" }).success,
    ).toBe(false);
  });
});
