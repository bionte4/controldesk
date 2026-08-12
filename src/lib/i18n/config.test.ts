import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT,
} from "@/lib/i18n/config";

describe("i18n config", () => {
  it("advertises exactly the locales the app supports", () => {
    expect([...LOCALES].sort()).toEqual(["en", "id"]);
  });

  it("default locale is Indonesian (rules §18)", () => {
    expect(DEFAULT_LOCALE).toBe("id");
  });

  it("each locale has a display label + short code", () => {
    for (const locale of LOCALES) {
      expect(LOCALE_LABELS[locale]).toBeTruthy();
      expect(LOCALE_SHORT[locale]).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("isLocale narrows unknown strings", () => {
    expect(isLocale("id")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(42)).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe("i18n dictionaries — structural parity", () => {
  it("id and en dictionaries share exactly the same key tree", async () => {
    const id = (await import("../../../messages/id.json")).default as unknown;
    const en = (await import("../../../messages/en.json")).default as unknown;

    const idKeys = flattenKeys(id, "");
    const enKeys = flattenKeys(en, "");

    const onlyInId = idKeys.filter((k) => !enKeys.includes(k));
    const onlyInEn = enKeys.filter((k) => !idKeys.includes(k));

    expect(onlyInId).toEqual([]);
    expect(onlyInEn).toEqual([]);
  });
});

function flattenKeys(value: unknown, prefix: string): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    flattenKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}
