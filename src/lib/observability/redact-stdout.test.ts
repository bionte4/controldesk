import { describe, expect, it } from "vitest";

import { redactLine } from "./redact-stdout";

describe("redactLine", () => {
  it("scrubs a password field in a Next.js Server Action log line", () => {
    const input =
      '  └─ ƒ signInWithPassword({"email":"user@example.com","password":"Sup3rSecret!"}, {}) in 815ms src/app/(auth)/actions.ts';
    const out = redactLine(input);
    expect(out).toContain('"password":"[REDACTED]"');
    expect(out).not.toContain("Sup3rSecret");
    // Keep the email — needed for auth-flow debugging, low-severity
    // in dev, already visible in the request line above.
    expect(out).toContain('"email":"user@example.com"');
  });

  it("is case-insensitive on the key name", () => {
    expect(redactLine('{"Password":"foo"}')).toContain(
      '"Password":"[REDACTED]"',
    );
    expect(redactLine('{"PASSWORD":"foo"}')).toContain(
      '"PASSWORD":"[REDACTED]"',
    );
  });

  it("scrubs API keys and secrets in common naming variants", () => {
    const tries = [
      '{"apiKey":"sk-abc"}',
      '{"api_key":"sk-abc"}',
      '{"api-key":"sk-abc"}',
      '{"secret":"topsecret"}',
      '{"client_secret":"cs_123"}',
      '{"service_role_key":"sr_key"}',
      '{"access_token":"at_1"}',
      '{"refresh_token":"rt_1"}',
      '{"id_token":"it_1"}',
    ];
    for (const t of tries) {
      const out = redactLine(t);
      expect(out).toContain("[REDACTED]");
      expect(out).not.toMatch(/sk-abc|topsecret|cs_123|sr_key|[air]t_1/);
    }
  });

  it("scrubs Bearer tokens in header dumps", () => {
    const input =
      'authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def';
    const out = redactLine(input);
    expect(out).toBe("authorization: Bearer [REDACTED]");
  });

  it("leaves unrelated JSON keys intact", () => {
    const input = '{"userId":"abc","tenantId":"xyz","name":"John Doe"}';
    expect(redactLine(input)).toBe(input);
  });

  it("handles escaped quotes inside the sensitive value", () => {
    const input = '{"password":"he said \\"boo\\""}';
    const out = redactLine(input);
    expect(out).toBe('{"password":"[REDACTED]"}');
  });

  it("is idempotent — running twice does not corrupt output", () => {
    const once = redactLine('{"password":"secret"}');
    const twice = redactLine(once);
    expect(twice).toBe(once);
    expect(twice).toBe('{"password":"[REDACTED]"}');
  });

  it("redacts every occurrence in one line, not just the first", () => {
    const input =
      '  └─ ƒ myAction({"password":"a"}, {"apiKey":"b"}, {"password":"c"}) in 10ms';
    const out = redactLine(input);
    expect(out).not.toMatch(/"password":"[abc]"/);
    expect(out).not.toMatch(/"apiKey":"b"/);
    expect(out.match(/\[REDACTED\]/g)?.length).toBe(3);
  });

  it("does not touch strings that only mention the key name in prose", () => {
    // No colon/value shape — pure prose mentions must not be
    // rewritten (would over-redact log messages that talk about
    // credential handling without embedding one).
    const input = "user updated password successfully";
    expect(redactLine(input)).toBe(input);
  });
});
