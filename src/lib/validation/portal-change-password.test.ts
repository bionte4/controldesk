import { describe, expect, it } from "vitest";

import { portalChangePasswordSchema } from "./portal-change-password";

const goodNew = "Correct-horse-9";

describe("portalChangePasswordSchema", () => {
  it("accepts a valid payload", () => {
    const result = portalChangePasswordSchema.safeParse({
      current_password: "tempPass1",
      new_password: goodNew,
      confirm_password: goodNew,
    });
    expect(result.success).toBe(true);
  });

  it("rejects when confirm mismatches", () => {
    const result = portalChangePasswordSchema.safeParse({
      current_password: "tempPass1",
      new_password: goodNew,
      confirm_password: `${goodNew}x`,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain("confirm_password");
    }
  });

  it("rejects when new === current", () => {
    const result = portalChangePasswordSchema.safeParse({
      current_password: goodNew,
      new_password: goodNew,
      confirm_password: goodNew,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain("new_password");
    }
  });

  it("rejects passwords under 10 characters", () => {
    const short = "Ab12345";
    const result = portalChangePasswordSchema.safeParse({
      current_password: "tempPass1",
      new_password: short,
      confirm_password: short,
    });
    expect(result.success).toBe(false);
  });

  it("rejects passwords without a digit", () => {
    const noDigit = "Abcdefghijkl";
    const result = portalChangePasswordSchema.safeParse({
      current_password: "tempPass1",
      new_password: noDigit,
      confirm_password: noDigit,
    });
    expect(result.success).toBe(false);
  });

  it("rejects passwords without a letter", () => {
    const noLetter = "1234567890!!";
    const result = portalChangePasswordSchema.safeParse({
      current_password: "tempPass1",
      new_password: noLetter,
      confirm_password: noLetter,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty current_password", () => {
    const result = portalChangePasswordSchema.safeParse({
      current_password: "",
      new_password: goodNew,
      confirm_password: goodNew,
    });
    expect(result.success).toBe(false);
  });
});
