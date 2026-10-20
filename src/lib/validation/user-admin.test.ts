import { describe, expect, it } from "vitest";

import {
  createUserManuallyFormSchema,
  createUserManuallySchema,
  inviteUserSchema,
} from "./user-admin";

describe("inviteUserSchema", () => {
  it("normalises email to lowercase and defaults role to EMPLOYEE", () => {
    const res = inviteUserSchema.safeParse({
      email: "  Ayu.Setia@Perusahaan.COM ",
      full_name: " Ayu Setia ",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.email).toBe("ayu.setia@perusahaan.com");
      expect(res.data.full_name).toBe("Ayu Setia");
      expect(res.data.role).toBe("EMPLOYEE");
    }
  });

  it("rejects an invalid email", () => {
    const res = inviteUserSchema.safeParse({
      email: "bukan-email",
      full_name: "Ayu Setia",
    });
    expect(res.success).toBe(false);
  });
});

describe("createUserManuallySchema", () => {
  it("accepts auto-generated password mode (password omitted)", () => {
    const res = createUserManuallySchema.safeParse({
      email: "budi@perusahaan.com",
      full_name: "Budi Santoso",
      role: "PM",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.password).toBeUndefined();
      expect(res.data.role).toBe("PM");
    }
  });

  it("defaults role to EMPLOYEE when omitted", () => {
    const res = createUserManuallySchema.safeParse({
      email: "budi@perusahaan.com",
      full_name: "Budi Santoso",
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.role).toBe("EMPLOYEE");
  });

  it("accepts a custom temporary password of at least 12 characters", () => {
    const res = createUserManuallySchema.safeParse({
      email: "budi@perusahaan.com",
      full_name: "Budi Santoso",
      password: "TempPass#2026!",
    });
    expect(res.success).toBe(true);
  });

  it("rejects a custom password shorter than 12 characters", () => {
    const res = createUserManuallySchema.safeParse({
      email: "budi@perusahaan.com",
      full_name: "Budi Santoso",
      password: "pendek123",
    });
    expect(res.success).toBe(false);
  });

  it("rejects unknown roles", () => {
    const res = createUserManuallySchema.safeParse({
      email: "budi@perusahaan.com",
      full_name: "Budi Santoso",
      role: "SUPERUSER",
    });
    expect(res.success).toBe(false);
  });

  it("rejects unknown extra fields", () => {
    const res = createUserManuallySchema.safeParse({
      email: "budi@perusahaan.com",
      full_name: "Budi Santoso",
      tenant_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.success).toBe(false);
  });
});

describe("createUserManuallyFormSchema", () => {
  const base = {
    email: "budi@perusahaan.com",
    full_name: "Budi Santoso",
    role: "EMPLOYEE" as const,
    password: "",
    password_confirmation: "",
  };

  it("accepts auto mode with empty password fields", () => {
    const res = createUserManuallyFormSchema.safeParse({
      ...base,
      password_mode: "auto",
    });
    expect(res.success).toBe(true);
  });

  it("rejects custom mode when confirmation differs", () => {
    const res = createUserManuallyFormSchema.safeParse({
      ...base,
      password_mode: "custom",
      password: "TempPass#2026!",
      password_confirmation: "TempPass#2027!",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(
        res.error.issues.some((i) => i.path[0] === "password_confirmation"),
      ).toBe(true);
    }
  });

  it("rejects custom mode with a short password", () => {
    const res = createUserManuallyFormSchema.safeParse({
      ...base,
      password_mode: "custom",
      password: "pendek123",
      password_confirmation: "pendek123",
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path[0] === "password")).toBe(
        true,
      );
    }
  });
});
