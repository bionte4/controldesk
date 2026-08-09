import { describe, expect, it } from "vitest";

import {
  deactivateWhatsAppConfigSchema,
  saveWhatsAppConfigSchema,
} from "./whatsapp-admin";

/**
 * Unit tests for the multi-provider (FONNTE + TWILIO) WhatsApp admin
 * schema. META_CLOUD stays intentionally rejected — its send adapter
 * is still stubbed with NOT_IMPLEMENTED, so admins picking it in the
 * form would silently produce dead-letter tenants.
 *
 * The schema covers shape validation only — the "do these credentials
 * actually work" gate lives in `verifyWhatsAppCredentials` (Fonnte
 * `/device` or Twilio `/Accounts.json` endpoint) and is exercised at
 * the integration layer.
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

  it("accepts an Indonesian local format (08xxx)", () => {
    // Fonnte routes with countryCode=62 which rewrites a leading 0
    // to 62 — see `whatsapp/client.ts::sendViaFonnte`. The schema
    // must permit the local shape so tenants don't have to
    // pre-normalise.
    const result = saveWhatsAppConfigSchema.safeParse({
      ...VALID_FONNTE,
      phone_number_id: "081234567890",
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

  it("does NOT require account_sid on the Fonnte branch", () => {
    // Fonnte writes NULL for account_sid — the union branch omits
    // the field entirely rather than requiring null.
    const result = saveWhatsAppConfigSchema.safeParse(VALID_FONNTE);
    expect(result.success).toBe(true);
    if (result.success && result.data.provider === "FONNTE") {
      // account_sid is optional on Fonnte and never validated on the
      // wire; the repository layer always sends NULL.
      expect(result.data.account_sid ?? null).toBeNull();
    }
  });
});

describe("saveWhatsAppConfigSchema — TWILIO", () => {
  // Twilio SIDs are `AC` + 32 hex chars. This one is 34 chars total.
  const VALID_SID = "AC" + "0123456789abcdef0123456789abcdef";
  const VALID_TWILIO = {
    provider: "TWILIO" as const,
    phone_number_id: "+14155238886",
    api_token: "your_auth_token_that_is_long_enough",
    account_sid: VALID_SID,
  };

  it("accepts a well-formed Twilio config in E.164 form", () => {
    const result = saveWhatsAppConfigSchema.safeParse(VALID_TWILIO);
    expect(result.success).toBe(true);
  });

  it("accepts phone number with whatsapp: prefix", () => {
    const result = saveWhatsAppConfigSchema.safeParse({
      ...VALID_TWILIO,
      phone_number_id: "whatsapp:+14155238886",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a phone without + prefix (must be strict E.164)", () => {
    // Fonnte is permissive with local formats; Twilio requires E.164
    // with the `+`. This asymmetry is by design — Twilio's API rejects
    // bare local formats with a generic "invalid To" error that's
    // hard to debug, so we surface the shape guard at the form.
    const result = saveWhatsAppConfigSchema.safeParse({
      ...VALID_TWILIO,
      phone_number_id: "14155238886",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an SID that doesn't start with AC", () => {
    const result = saveWhatsAppConfigSchema.safeParse({
      ...VALID_TWILIO,
      account_sid: "SK" + "0123456789abcdef0123456789abcdef",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an SID with the wrong length", () => {
    const result = saveWhatsAppConfigSchema.safeParse({
      ...VALID_TWILIO,
      account_sid: "AC" + "0123456789abcdef", // 18 chars total, not 34
    });
    expect(result.success).toBe(false);
  });

  it("rejects an SID with non-hex characters", () => {
    const result = saveWhatsAppConfigSchema.safeParse({
      ...VALID_TWILIO,
      account_sid: "AC" + "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
    });
    expect(result.success).toBe(false);
  });

  it("rejects Twilio payload missing account_sid", () => {
    const { account_sid: _omit, ...rest } = VALID_TWILIO;
    void _omit;
    const result = saveWhatsAppConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects an auth token that is too short (< 20 chars)", () => {
    const result = saveWhatsAppConfigSchema.safeParse({
      ...VALID_TWILIO,
      api_token: "shortie",
    });
    expect(result.success).toBe(false);
  });
});

describe("saveWhatsAppConfigSchema — provider gate", () => {
  it("rejects META_CLOUD — send adapter still returns NOT_IMPLEMENTED", () => {
    // Meta Cloud stays out of the picker until Phase B lands the
    // Graph API send + template lookup. Legacy META_CLOUD rows still
    // render in the status badge (see hub tile), they just can't be
    // re-saved through this form.
    const result = saveWhatsAppConfigSchema.safeParse({
      provider: "META_CLOUD",
      phone_number_id: "+14155238886",
      api_token: "meta-cloud-token-long-enough-value",
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
