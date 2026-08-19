import { describe, expect, it } from "vitest";

import {
  deactivateAiConfigSchema,
  saveAiConfigSchema,
} from "./ai-admin";

/**
 * Unit tests for the per-tenant AI admin schema (rules §15, §17).
 *
 * The schema is a discriminated union keyed on `provider`:
 *   * GOOGLE / OPENAI / ANTHROPIC — require an API key, forbid base_url
 *   * OPENAI_COMPATIBLE           — requires base_url, api_key optional
 *   * DISABLED                    — no auth / model needed
 *
 * These tests lock in the invariants so a config that would poison the
 * `resolveAiModel()` runtime (missing base_url on Ollama, missing key
 * on OpenAI, etc.) is caught at the Server Action boundary.
 */
describe("saveAiConfigSchema — cloud providers (GOOGLE/OPENAI/ANTHROPIC)", () => {
  const CLOUD_PROVIDERS = ["GOOGLE", "OPENAI", "ANTHROPIC"] as const;

  for (const provider of CLOUD_PROVIDERS) {
    it(`accepts a well-formed ${provider} config`, () => {
      const result = saveAiConfigSchema.safeParse({
        provider,
        model_id:
          provider === "GOOGLE"
            ? "gemini-2.5-flash"
            : provider === "OPENAI"
              ? "gpt-4o-mini"
              : "claude-sonnet-5",
        api_key: "test-api-key-value",
        pii_redaction_enabled: true,
      });
      expect(result.success).toBe(true);
    });

    it(`rejects ${provider} without an api_key`, () => {
      const result = saveAiConfigSchema.safeParse({
        provider,
        model_id: "some-model",
        api_key: "",
        pii_redaction_enabled: true,
      });
      expect(result.success).toBe(false);
    });

    it(`rejects ${provider} with a base_url (cloud path must not set one)`, () => {
      const result = saveAiConfigSchema.safeParse({
        provider,
        model_id: "some-model",
        api_key: "key",
        base_url: "http://localhost:11434/v1",
        pii_redaction_enabled: true,
      });
      // The `base_url: z.null().optional()` field rejects a string.
      expect(result.success).toBe(false);
    });
  }

  it("defaults pii_redaction_enabled to true", () => {
    const result = saveAiConfigSchema.safeParse({
      provider: "GOOGLE",
      model_id: "gemini-2.5-flash",
      api_key: "key",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pii_redaction_enabled).toBe(true);
    }
  });
});

describe("saveAiConfigSchema — OPENAI_COMPATIBLE (local LLM / Ollama / LM Studio)", () => {
  it("accepts Ollama-style config without api_key", () => {
    const result = saveAiConfigSchema.safeParse({
      provider: "OPENAI_COMPATIBLE",
      model_id: "llama3.1:70b",
      base_url: "http://localhost:11434/v1",
      pii_redaction_enabled: false,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a config with api_key (Groq / Together AI / Cerebras)", () => {
    const result = saveAiConfigSchema.safeParse({
      provider: "OPENAI_COMPATIBLE",
      model_id: "llama-3.1-70b-versatile",
      api_key: "gsk_test_key_value",
      base_url: "https://api.groq.com/openai/v1",
      pii_redaction_enabled: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects OPENAI_COMPATIBLE without a base_url (Ollama/vLLM need one)", () => {
    const result = saveAiConfigSchema.safeParse({
      provider: "OPENAI_COMPATIBLE",
      model_id: "llama3.1:70b",
      pii_redaction_enabled: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a base_url without http:// or https:// scheme", () => {
    const result = saveAiConfigSchema.safeParse({
      provider: "OPENAI_COMPATIBLE",
      model_id: "llama3.1:70b",
      base_url: "ollama:11434/v1",
      pii_redaction_enabled: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty model_id", () => {
    const result = saveAiConfigSchema.safeParse({
      provider: "OPENAI_COMPATIBLE",
      model_id: "",
      base_url: "http://localhost:11434/v1",
      pii_redaction_enabled: false,
    });
    expect(result.success).toBe(false);
  });
});

describe("saveAiConfigSchema — DISABLED (explicit opt-out)", () => {
  it("accepts a bare DISABLED config", () => {
    const result = saveAiConfigSchema.safeParse({ provider: "DISABLED" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("DISABLED");
      // `model_id` is required non-null in the DB, so the schema
      // defaults to a placeholder that the UI hides.
      expect(result.data.model_id).toBe("disabled");
    }
  });

  it("still allows a daily_token_cap override on DISABLED (no-op but harmless)", () => {
    const result = saveAiConfigSchema.safeParse({
      provider: "DISABLED",
      daily_token_cap: 5000,
    });
    expect(result.success).toBe(true);
  });
});

describe("saveAiConfigSchema — daily_token_cap validation", () => {
  it("accepts an integer cap between 1 and 10_000_000", () => {
    const result = saveAiConfigSchema.safeParse({
      provider: "GOOGLE",
      model_id: "gemini-2.5-flash",
      api_key: "key",
      daily_token_cap: 25_000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative or zero cap (would trap the tenant forever)", () => {
    for (const cap of [0, -1, -100]) {
      const result = saveAiConfigSchema.safeParse({
        provider: "GOOGLE",
        model_id: "gemini-2.5-flash",
        api_key: "key",
        daily_token_cap: cap,
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects a non-integer cap", () => {
    const result = saveAiConfigSchema.safeParse({
      provider: "GOOGLE",
      model_id: "gemini-2.5-flash",
      api_key: "key",
      daily_token_cap: 1000.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unreasonably large cap", () => {
    const result = saveAiConfigSchema.safeParse({
      provider: "GOOGLE",
      model_id: "gemini-2.5-flash",
      api_key: "key",
      daily_token_cap: 999_999_999,
    });
    expect(result.success).toBe(false);
  });

  it("accepts null cap (fall back to env default)", () => {
    const result = saveAiConfigSchema.safeParse({
      provider: "GOOGLE",
      model_id: "gemini-2.5-flash",
      api_key: "key",
      daily_token_cap: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("saveAiConfigSchema — unknown provider", () => {
  it("rejects a provider outside the enum", () => {
    const result = saveAiConfigSchema.safeParse({
      provider: "MISTRAL",
      model_id: "mistral-large",
      api_key: "key",
    });
    expect(result.success).toBe(false);
  });
});

describe("deactivateAiConfigSchema", () => {
  it("accepts an empty object (no client input)", () => {
    const result = deactivateAiConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("saveAiConfigSchema — insight_freshness_min validation (migration 0091)", () => {
  const basePayload = {
    provider: "GOOGLE" as const,
    model_id: "gemini-2.5-flash",
    api_key: "test-key",
  };

  it("defaults to 15 when omitted (legacy behaviour preserved)", () => {
    const result = saveAiConfigSchema.safeParse(basePayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.insight_freshness_min).toBe(15);
    }
  });

  it("accepts the min boundary (5)", () => {
    const result = saveAiConfigSchema.safeParse({
      ...basePayload,
      insight_freshness_min: 5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts the max boundary (1440 = 24h)", () => {
    const result = saveAiConfigSchema.safeParse({
      ...basePayload,
      insight_freshness_min: 1440,
    });
    expect(result.success).toBe(true);
  });

  it("rejects below-minimum values (would spam the LLM every sweep)", () => {
    for (const v of [4, 1, 0, -1]) {
      const result = saveAiConfigSchema.safeParse({
        ...basePayload,
        insight_freshness_min: v,
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects above-maximum values (users should DISABLED provider instead)", () => {
    for (const v of [1441, 10_000]) {
      const result = saveAiConfigSchema.safeParse({
        ...basePayload,
        insight_freshness_min: v,
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects a non-integer value", () => {
    const result = saveAiConfigSchema.safeParse({
      ...basePayload,
      insight_freshness_min: 15.5,
    });
    expect(result.success).toBe(false);
  });

  it("applies the same rule on OPENAI_COMPATIBLE branch", () => {
    const good = saveAiConfigSchema.safeParse({
      provider: "OPENAI_COMPATIBLE",
      model_id: "llama3.1:70b",
      base_url: "http://localhost:11434/v1",
      insight_freshness_min: 30,
    });
    expect(good.success).toBe(true);

    const bad = saveAiConfigSchema.safeParse({
      provider: "OPENAI_COMPATIBLE",
      model_id: "llama3.1:70b",
      base_url: "http://localhost:11434/v1",
      insight_freshness_min: 2,
    });
    expect(bad.success).toBe(false);
  });

  it("applies the same rule on DISABLED branch (setting preserved across swaps)", () => {
    const result = saveAiConfigSchema.safeParse({
      provider: "DISABLED",
      insight_freshness_min: 60,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.insight_freshness_min).toBe(60);
    }
  });
});
