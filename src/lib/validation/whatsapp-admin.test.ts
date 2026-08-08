import { describe, expect, it } from "vitest";

import {
  deactivateWhatsAppConfigSchema,
  saveWhatsAppConfigSchema,
} from "./whatsapp-admin";

/**
 * Unit tests for the FONNTE-only WhatsApp admin schema.
 *
 * The schema covers shape validation only — the "does this token
 * actually work" gate lives in `verifyWhatsAppCredentials` (Fonnte
 * `/device` endpoint) and is exercised at the integration layer.
 */
describe("saveWhatsAppConfigSchema — FONNTE", () => {
  const VALID_FONNTE = {
    provider: "FONNTE" as const,
    phone_number_id: "6281234567890",
    api_token: "abcdef1234567890",
  };

  it("accepts a well-formed Fonnte config in E.164 form", () => {
    const result = saveWhatsAppConfigSchema.safeParse(VALID_FONNTE);
    expect(result.success).toBe(true);
  });

  it("accepts a phone number with + prefix", () => {
    const result = saveWhatsAppConfigSchema.safeParse({
      ...VALID_FONNTE,
      phone_number_id: "+6281234567890",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a phone number with whatsapp: prefix", () => {
    const result = saveWhatsAppConfigSchema.safeParse({
      ...VALID_FONNTE,
      phone_number_id: "whatsapp:+6281234567890",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a phone number with letters", () => {
    const result = saveWhatsAppConfigSchema.safeParse({
      ...VALID_FONNTE,
      phone_number_id: "not-a-number",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a token that is too short (< 10 chars)", () => {
    const result = saveWhatsAppConfigSchema.safeParse({
      ...VALID_FONNTE,
      api_token: "abc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a phone number that is too short", () => {
    const result = saveWhatsAppConfigSchema.safeParse({
      ...VALID_FONNTE,
      phone_number_id: "12345",
    });
    expect(result.success).toBe(false);
  });
});

describe("saveWhatsAppConfigSchema — provider gate", () => {
  it("rejects TWILIO — dormant in the current UI", () => {
    const result = saveWhatsAppConfigSchema.safeParse({
      provider: "TWILIO",
      phone_number_id: "6281234567890",
      api_token: "abcdef1234567890",
    });
    expect(result.success).toBe(false);
  });

  it("rejects META_CLOUD — dormant in the current UI", () => {
    const result = saveWhatsAppConfigSchema.safeParse({
      provider: "META_CLOUD",
      phone_number_id: "6281234567890",
      api_token: "abcdef1234567890",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown provider value", () => {
    const result = saveWhatsAppConfigSchema.safeParse({
      provider: "OTHER",
      phone_number_id: "6281234567890",
      api_token: "abcdef1234567890",
    });
    expect(result.success).toBe(false);
  });
});

describe("deactivateWhatsAppConfigSchema", () => {
  it("accepts an empty object (no client input)", () => {
    const result = deactivateWhatsAppConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
