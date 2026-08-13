import { describe, expect, it } from "vitest";

import {
  FEATURE_KEYS,
  FEATURE_REGISTRY,
  defaultFor,
  isKnownFeatureKey,
} from "./feature-flags";

describe("FEATURE_REGISTRY", () => {
  it("has at least the baseline shipped features", () => {
    for (const key of [
      "wbs_gantt",
      "ai_insights",
      "google_calendar_sync",
      "telegram_bot",
      "whatsapp_notifications",
      "bulk_import",
      "advanced_reports",
      "ai_chatbot_tools",
    ]) {
      expect(FEATURE_REGISTRY).toHaveProperty(key);
    }
  });

  it("every entry has label + description + defaultEnabled", () => {
    for (const [key, entry] of Object.entries(FEATURE_REGISTRY)) {
      expect(entry.label, `${key}.label`).toBeTruthy();
      expect(entry.description, `${key}.description`).toBeTruthy();
      expect(typeof entry.defaultEnabled, `${key}.defaultEnabled type`).toBe(
        "boolean",
      );
    }
  });

  it("google_calendar_sync + telegram + whatsapp are off by default (opt-in)", () => {
    expect(FEATURE_REGISTRY.google_calendar_sync.defaultEnabled).toBe(false);
    expect(FEATURE_REGISTRY.telegram_bot.defaultEnabled).toBe(false);
    expect(FEATURE_REGISTRY.whatsapp_notifications.defaultEnabled).toBe(false);
  });

  it("wbs_gantt + ai_insights are on by default (GA)", () => {
    expect(FEATURE_REGISTRY.wbs_gantt.defaultEnabled).toBe(true);
    expect(FEATURE_REGISTRY.ai_insights.defaultEnabled).toBe(true);
  });

  it("ai_chatbot_tools defaults ON — Level 2 was GA before this flag existed and turning it OFF would surprise tenants that already depend on it", () => {
    expect(FEATURE_REGISTRY.ai_chatbot_tools.defaultEnabled).toBe(true);
  });
});

describe("FEATURE_KEYS", () => {
  it("matches the keys of FEATURE_REGISTRY exactly", () => {
    expect(new Set(FEATURE_KEYS)).toEqual(new Set(Object.keys(FEATURE_REGISTRY)));
  });
});

describe("isKnownFeatureKey", () => {
  it.each(FEATURE_KEYS)("returns true for known key %s", (key) => {
    expect(isKnownFeatureKey(key)).toBe(true);
  });

  it.each(["", "unknown_feature", "wbs_ganttt", "WBS_GANTT"])(
    "returns false for unknown key %s",
    (input) => {
      expect(isKnownFeatureKey(input)).toBe(false);
    },
  );
});

describe("defaultFor", () => {
  it.each(FEATURE_KEYS)("returns registry default for %s", (key) => {
    expect(defaultFor(key)).toBe(FEATURE_REGISTRY[key].defaultEnabled);
  });
});
