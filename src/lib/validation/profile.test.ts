import { describe, expect, it } from "vitest";

import {
  changePasswordSchema,
  updateProfileSchema,
} from "./profile";

describe("updateProfileSchema", () => {
  it("accepts a minimal valid payload (first name only)", () => {
    const res = updateProfileSchema.safeParse({ first_name: "Budi" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.first_name).toBe("Budi");
      expect(res.data.last_name).toBeUndefined();
      expect(res.data.phone).toBeUndefined();
    }
  });

  it("treats undefined optional fields as absent", () => {
    const res = updateProfileSchema.safeParse({
      first_name: "Budi",
      last_name: undefined,
      phone: undefined,
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.last_name).toBeUndefined();
      expect(res.data.phone).toBeUndefined();
    }
  });

  it("collapses an empty last_name string to undefined", () => {
    // The UI sends undefined for cleared optional fields, but the schema's
    // trim+min(0)+transform path is exercised here defensively.
    const res = updateProfileSchema.safeParse({
      first_name: "Budi",
      last_name: "",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.last_name).toBeUndefined();
  });

  it("rejects a blank first name", () => {
    const res = updateProfileSchema.safeParse({ first_name: "   " });
    expect(res.success).toBe(false);
  });

  it("rejects invalid phone characters", () => {
    const res = updateProfileSchema.safeParse({
      first_name: "Budi",
      phone: "call me!",
    });
    expect(res.success).toBe(false);
  });

  it("accepts Indonesian phone with country code", () => {
    const res = updateProfileSchema.safeParse({
      first_name: "Budi",
      phone: "+62 812-3456-7890",
    });
    expect(res.success).toBe(true);
  });

  it("rejects date_of_birth with age < 17", () => {
    const today = new Date();
    const dob = new Date(
      today.getFullYear() - 10,
      today.getMonth(),
      today.getDate(),
    )
      .toISOString()
      .slice(0, 10);
    const res = updateProfileSchema.safeParse({
      first_name: "Budi",
      date_of_birth: dob,
    });
    expect(res.success).toBe(false);
  });

  it("rejects date_of_birth with age > 90", () => {
    const today = new Date();
    const dob = new Date(
      today.getFullYear() - 95,
      today.getMonth(),
      today.getDate(),
    )
      .toISOString()
      .slice(0, 10);
    const res = updateProfileSchema.safeParse({
      first_name: "Budi",
      date_of_birth: dob,
    });
    expect(res.success).toBe(false);
  });

  it("accepts a valid Indonesian locale", () => {
    const res = updateProfileSchema.safeParse({
      first_name: "Budi",
      preferred_locale: "id",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.preferred_locale).toBe("id");
  });

  it("rejects an unsupported locale", () => {
    const res = updateProfileSchema.safeParse({
      first_name: "Budi",
      preferred_locale: "fr",
    });
    expect(res.success).toBe(false);
  });
});

describe("changePasswordSchema", () => {
  const base = {
    current_password: "oldpass1",
    new_password: "newpass1",
    confirm_password: "newpass1",
  };

  it("accepts a valid password change", () => {
    const res = changePasswordSchema.safeParse(base);
    expect(res.success).toBe(true);
  });

  it("rejects short passwords", () => {
    const res = changePasswordSchema.safeParse({
      ...base,
      new_password: "abc12",
      confirm_password: "abc12",
    });
    expect(res.success).toBe(false);
  });

  it("rejects passwords without digits", () => {
    const res = changePasswordSchema.safeParse({
      ...base,
      new_password: "abcdefgh",
      confirm_password: "abcdefgh",
    });
    expect(res.success).toBe(false);
  });

  it("rejects passwords without letters", () => {
    const res = changePasswordSchema.safeParse({
      ...base,
      new_password: "12345678",
      confirm_password: "12345678",
    });
    expect(res.success).toBe(false);
  });

  it("rejects mismatched confirm_password", () => {
    const res = changePasswordSchema.safeParse({
      ...base,
      confirm_password: "different1",
    });
    expect(res.success).toBe(false);
  });

  it("rejects new_password equal to current_password", () => {
    const res = changePasswordSchema.safeParse({
      current_password: "same-pass1",
      new_password: "same-pass1",
      confirm_password: "same-pass1",
    });
    expect(res.success).toBe(false);
  });
});
