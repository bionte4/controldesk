import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadTenantSmtpConfigMock } = vi.hoisted(() => ({
  loadTenantSmtpConfigMock: vi.fn(),
}));

vi.mock("@/lib/integrations/smtp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/smtp")>()),
  loadTenantSmtpConfig: loadTenantSmtpConfigMock,
}));

import {
  __setTransporterForTests,
  sendEmail,
} from "./mailer";

describe("mailer", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    __setTransporterForTests(null);
    loadTenantSmtpConfigMock.mockReset();
    loadTenantSmtpConfigMock.mockResolvedValue(null);
  });

  afterEach(() => {
    __setTransporterForTests(null);
    for (const k of Object.keys(process.env)) {
      if (!(k in originalEnv)) delete process.env[k];
    }
    for (const [k, v] of Object.entries(originalEnv)) {
      process.env[k] = v;
    }
  });

  it("returns SKIPPED when SMTP_HOST is missing", async () => {
    delete process.env.SMTP_HOST;
    const res = await sendEmail({ to: "x@example.com", subject: "hi" });
    expect(res.status).toBe("SKIPPED");
    expect(res.provider).toBe("noop");
  });

  it("returns SKIPPED when SMTP_PORT parses to NaN", async () => {
    process.env.SMTP_HOST = "localhost";
    process.env.SMTP_PORT = "not-a-number";
    const res = await sendEmail({ to: "x@example.com", subject: "hi" });
    expect(res.status).toBe("SKIPPED");
  });

  it("SENT status includes provider messageId (injected transporter)", async () => {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1025";
    process.env.SMTP_FROM = "ops@controldesk.test";

    __setTransporterForTests({
      sendMail: async () => ({ messageId: "<abc@stub>" }),
    });

    const res = await sendEmail({
      to: "recipient@example.com",
      subject: "hello",
      text: "world",
    });
    expect(res.status).toBe("SENT");
    expect(res.provider).toBe("smtp");
    expect(res.providerMessageId).toBe("<abc@stub>");
  });

  it("SENT result exposes the actual sender used (env fallback)", async () => {
    // env-global config path — no tenantId. `configSource` should be
    // `env` and `from` should reflect the env `SMTP_FROM`.
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1025";
    process.env.SMTP_FROM = "digest@controldesk.test";

    __setTransporterForTests({
      sendMail: async () => ({ messageId: "<from-check@stub>" }),
    });

    const res = await sendEmail({
      to: "x@example.com",
      subject: "hi",
    });
    expect(res.status).toBe("SENT");
    expect(res.from).toBe("digest@controldesk.test");
    expect(res.configSource).toBe("env");
  });

  it("degrades gracefully when the tenant SMTP loader throws", async () => {
    // Even if the per-tenant loader implodes (bad DB session, etc.),
    // the mailer must fall back to env — never crash a cron.
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1025";
    process.env.SMTP_FROM = "fallback@controldesk.test";

    __setTransporterForTests({
      sendMail: async () => ({ messageId: "<fallback@stub>" }),
    });

    loadTenantSmtpConfigMock.mockRejectedValueOnce(
      new Error("simulated tenant SMTP lookup failure"),
    );

    const res = await sendEmail({
      to: "x@example.com",
      subject: "hi",
      tenantId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe("SENT");
    expect(res.configSource).toBe("env");
  });

  it("returns FAILED with error message when transporter throws", async () => {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1025";

    __setTransporterForTests({
      sendMail: async () => {
        throw new Error("smtp exploded");
      },
    });

    const res = await sendEmail({
      to: "recipient@example.com",
      subject: "boom",
    });
    expect(res.status).toBe("FAILED");
    expect(res.error).toContain("smtp exploded");
  });

  it("joins array recipients with comma", async () => {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = "1025";

    const received: Record<string, unknown>[] = [];
    __setTransporterForTests({
      sendMail: async (opts) => {
        received.push(opts);
        return { messageId: "<m@stub>" };
      },
    });

    await sendEmail({
      to: ["a@x.test", "b@x.test"],
      subject: "hi",
      text: "yo",
    });
    expect(received).toHaveLength(1);
    expect(received[0].to).toBe("a@x.test, b@x.test");
  });
});
