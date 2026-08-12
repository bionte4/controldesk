import { describe, expect, it } from "vitest";

import {
  deactivateSmtpConfigSchema,
  saveSmtpConfigSchema,
} from "./smtp-admin";

/**
 * Unit tests for the per-tenant SMTP admin schema.
 *
 * The schema is intentionally plain (not a discriminated union) —
 * every SMTP-shaped relay uses the same host/port/user/pass/from
 * tuple. Phase B may add API-based adapters (Resend, Postmark JSON,
 * SES SDK), at which point we'll re-shape to a discriminated union.
 */
describe("saveSmtpConfigSchema", () => {
  const VALID = {
    provider: "SMTP" as const,
    host: "smtp.gmail.com",
    port: 587,
    secure: null,
    username: "no-reply@acme.com",
    password: "app-password-value",
    from_address: "no-reply@acme.com",
    from_name: "Acme HR",
    reply_to: "hr@acme.com",
  };

  it("accepts a well-formed SMTP config with auth + display name", () => {
    const result = saveSmtpConfigSchema.safeParse(VALID);
    expect(result.success).toBe(true);
  });

  it("accepts an anonymous relay (no username, no password)", () => {
    // Dev mailpit and internal MTAs on private networks accept mail
    // without AUTH. Both credentials must be absent (or empty).
    const result = saveSmtpConfigSchema.safeParse({
      ...VALID,
      username: "",
      password: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects half-configured auth (username without password)", () => {
    // A half-configured auth pair silently disables AUTH on
    // nodemailer, then produces a confusing "relay access denied"
    // from the SMTP server. Catch it at validation.
    const result = saveSmtpConfigSchema.safeParse({
      ...VALID,
      username: "user@acme.com",
      password: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects half-configured auth (password without username)", () => {
    const result = saveSmtpConfigSchema.safeParse({
      ...VALID,
      username: "",
      password: "some-password",
    });
    expect(result.success).toBe(false);
  });

  it("defaults provider to SMTP when omitted", () => {
    const { provider: _omit, ...rest } = VALID;
    void _omit;
    const result = saveSmtpConfigSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("SMTP");
    }
  });

  it("accepts non-standard ports (mailpit 1025)", () => {
    const result = saveSmtpConfigSchema.safeParse({
      ...VALID,
      port: 1025,
    });
    expect(result.success).toBe(true);
  });

  it("rejects port <= 0", () => {
    const result = saveSmtpConfigSchema.safeParse({ ...VALID, port: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects port > 65535", () => {
    const result = saveSmtpConfigSchema.safeParse({ ...VALID, port: 70000 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer port", () => {
    const result = saveSmtpConfigSchema.safeParse({ ...VALID, port: 587.5 });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid from_address", () => {
    const result = saveSmtpConfigSchema.safeParse({
      ...VALID,
      from_address: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid reply_to (when provided)", () => {
    const result = saveSmtpConfigSchema.safeParse({
      ...VALID,
      reply_to: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty reply_to (fallback to from_address at the mailer)", () => {
    const result = saveSmtpConfigSchema.safeParse({
      ...VALID,
      reply_to: "",
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty from_name (bare mailbox render)", () => {
    const result = saveSmtpConfigSchema.safeParse({
      ...VALID,
      from_name: "",
    });
    expect(result.success).toBe(true);
  });

  it("accepts alternate provider tags (Resend/Postmark/SES/SendGrid)", () => {
    // The mailer only honours SMTP today, but the schema accepts the
    // other values so a Phase B migration can flip live rows without
    // schema churn.
    for (const provider of ["RESEND", "POSTMARK", "SES", "SENDGRID"] as const) {
      const result = saveSmtpConfigSchema.safeParse({
        ...VALID,
        provider,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an unknown provider tag", () => {
    const result = saveSmtpConfigSchema.safeParse({
      ...VALID,
      provider: "MAILGUN",
    });
    expect(result.success).toBe(false);
  });
});

describe("deactivateSmtpConfigSchema", () => {
  it("accepts an empty object (no client input)", () => {
    const result = deactivateSmtpConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
