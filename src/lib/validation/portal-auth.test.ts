import { describe, expect, it } from "vitest";

import { portalLoginSchema } from "./portal-auth";

describe("portalLoginSchema", () => {
  it("accepts a valid email + password payload", () => {
    const result = portalLoginSchema.safeParse({
      email: "client@demo.controldesk.app",
      password: "ControlDesk#2026",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("client@demo.controldesk.app");
    }
  });

  it("lowercases + trims the email", () => {
    const result = portalLoginSchema.safeParse({
      email: "  Client@Demo.ControlDesk.APP  ",
      password: "x",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("client@demo.controldesk.app");
    }
  });

  it("rejects a bad email shape", () => {
    const result = portalLoginSchema.safeParse({
      email: "not-an-email",
      password: "x",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty password", () => {
    const result = portalLoginSchema.safeParse({
      email: "client@demo.controldesk.app",
      password: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an oversized password (guardrail)", () => {
    const result = portalLoginSchema.safeParse({
      email: "client@demo.controldesk.app",
      password: "x".repeat(201),
    });
    expect(result.success).toBe(false);
  });
});
