import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __setTransporterForTests,
  sendEmail,
} from "./mailer";

describe("mailer", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    __setTransporterForTests(null);
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
