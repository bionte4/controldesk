import { describe, expect, it } from "vitest";

import {
  deactivateTelegramBotSchema,
  saveTelegramBotSchema,
} from "./telegram-admin";

/**
 * Unit tests for the Telegram admin Zod schemas.
 *
 * We test the SHAPE gate here (what admins can submit); the
 * behavioural gate — "does Telegram accept the token" — lives in
 * `verifyTelegramBotToken` and is exercised in integration.
 */
describe("saveTelegramBotSchema", () => {
  const VALID_TOKEN = "123456789:ABC-DEFghijKLmnop-qrs_tuv_1234567";

  it("accepts a well-formed bot username + token", () => {
    const result = saveTelegramBotSchema.safeParse({
      bot_username: "my_erp_bot",
      bot_token: VALID_TOKEN,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bot_username).toBe("my_erp_bot");
    }
  });

  it("strips a leading @ from the username", () => {
    const result = saveTelegramBotSchema.safeParse({
      bot_username: "@my_erp_bot",
      bot_token: VALID_TOKEN,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bot_username).toBe("my_erp_bot");
    }
  });

  it("rejects username missing the bot suffix", () => {
    const result = saveTelegramBotSchema.safeParse({
      bot_username: "my_erp",
      bot_token: VALID_TOKEN,
    });
    expect(result.success).toBe(false);
  });

  it("rejects username with hyphen (Telegram disallows it)", () => {
    const result = saveTelegramBotSchema.safeParse({
      bot_username: "my-erp-bot",
      bot_token: VALID_TOKEN,
    });
    expect(result.success).toBe(false);
  });

  it("rejects malformed token missing the numeric prefix", () => {
    const result = saveTelegramBotSchema.safeParse({
      bot_username: "my_erp_bot",
      bot_token: "ABC-DEFghijKLmnop-qrs_tuv_1234567",
    });
    expect(result.success).toBe(false);
  });

  it("rejects token missing the colon separator", () => {
    const result = saveTelegramBotSchema.safeParse({
      bot_username: "my_erp_bot",
      bot_token: "123456789ABCDEFghijKLmnop_qrs_tuv_1234567",
    });
    expect(result.success).toBe(false);
  });

  it("rejects token that is too short", () => {
    const result = saveTelegramBotSchema.safeParse({
      bot_username: "my_erp_bot",
      bot_token: "123:abc",
    });
    expect(result.success).toBe(false);
  });
});

describe("deactivateTelegramBotSchema", () => {
  it("accepts an empty object (no client input)", () => {
    const result = deactivateTelegramBotSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("ignores extra fields (Zod strips by default on object schema)", () => {
    const result = deactivateTelegramBotSchema.safeParse({ foo: "bar" });
    expect(result.success).toBe(true);
  });
});
