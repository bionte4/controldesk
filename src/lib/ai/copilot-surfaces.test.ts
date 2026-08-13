import { describe, expect, it } from "vitest";

import {
  COPILOT_SURFACES,
  copilotRequestSchema,
  type CopilotContext,
} from "./copilot-surfaces";

describe("COPILOT_SURFACES", () => {
  it("registers exactly the four Level-3 surfaces", () => {
    expect(Object.keys(COPILOT_SURFACES).sort()).toEqual(
      [
        "ca_purpose",
        "expense_description",
        "field_ops_justification",
        "project_description",
      ].sort(),
    );
  });

  it("caps every surface's output tokens under 250 to bound cost per click", () => {
    for (const s of Object.values(COPILOT_SURFACES)) {
      expect(s.maxOutputTokens).toBeGreaterThan(0);
      expect(s.maxOutputTokens).toBeLessThanOrEqual(250);
    }
  });

  it("keeps context whitelists tight — no allowlist over 10 keys", () => {
    for (const s of Object.values(COPILOT_SURFACES)) {
      // Guardrail: a growing whitelist would leak more form data to
      // the model over time. If a surface legitimately needs 10+
      // context keys, split it into two surfaces first.
      expect(s.contextKeys.length).toBeLessThanOrEqual(10);
    }
  });

  it("embeds the tenant name in every system prompt (isolation guardrail)", () => {
    const context: CopilotContext = { amount: 1_000_000 };
    for (const surface of Object.values(COPILOT_SURFACES)) {
      const { system } = surface.buildPrompt({
        tenantName: "Acme Corp",
        locale: "id",
        userInput: "",
        context,
      });
      expect(system).toContain("Acme Corp");
    }
  });

  it("localises the ruleset when the caller passes locale='id'", () => {
    const { system } = COPILOT_SURFACES.ca_purpose.buildPrompt({
      tenantName: "Demo",
      locale: "id",
      userInput: "",
      context: {},
    });
    // A few Indonesian ruleset words we know should be there.
    expect(system).toMatch(/bahasa/i);
    expect(system).toMatch(/pengguna/i);
    // English keywords must NOT bleed in.
    expect(system).not.toContain("professional English");
  });

  it("emits an English ruleset for locale='en'", () => {
    const { system } = COPILOT_SURFACES.ca_purpose.buildPrompt({
      tenantName: "Demo",
      locale: "en",
      userInput: "",
      context: {},
    });
    expect(system).toMatch(/professional English/);
  });

  it("renders the empty-input branch when the user hasn't typed anything", () => {
    const { user } = COPILOT_SURFACES.ca_purpose.buildPrompt({
      tenantName: "Demo",
      locale: "id",
      userInput: "",
      context: { amount: 500_000 },
    });
    expect(user).toMatch(/kosong/);
  });

  it("preserves the user's draft in the user prompt when input is non-empty", () => {
    const draft = "Bayar akomodasi tim survey";
    const { user } = COPILOT_SURFACES.ca_purpose.buildPrompt({
      tenantName: "Demo",
      locale: "id",
      userInput: draft,
      context: {},
    });
    expect(user).toContain(draft);
  });
});

describe("copilotRequestSchema", () => {
  it("accepts a well-formed request", () => {
    const parsed = copilotRequestSchema.parse({
      surface: "ca_purpose",
      input: "Bayar akomodasi tim survey",
      context: { amount: 500_000, project_name: "Alpha" },
    });
    expect(parsed.surface).toBe("ca_purpose");
    expect(parsed.input).toBe("Bayar akomodasi tim survey");
    expect(parsed.context).toEqual({ amount: 500_000, project_name: "Alpha" });
  });

  it("rejects unknown surface ids", () => {
    expect(() =>
      copilotRequestSchema.parse({
        surface: "chatbot",
        input: "hi",
      }),
    ).toThrow();
  });

  it("caps input at 4000 characters", () => {
    const tooLong = "a".repeat(4001);
    expect(() =>
      copilotRequestSchema.parse({
        surface: "ca_purpose",
        input: tooLong,
      }),
    ).toThrow();
  });

  it("defaults context to an empty object when omitted", () => {
    const parsed = copilotRequestSchema.parse({
      surface: "ca_purpose",
      input: "",
    });
    expect(parsed.context).toEqual({});
  });
});
